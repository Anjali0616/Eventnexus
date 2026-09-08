"""EventNexus AI service (FastAPI).

The ML brain for the EventNexus stack, per the project report (PDF §3.5):
AI deployed through a mixture of TensorFlow.js / Node.js inference and
Python ML packages (Scikit-learn) — the Node backend orchestrates, this
service owns the trained models.

Endpoints
---------
GET  /health                model availability + service status
POST /predict-attendance    batch attendance forecast for events
POST /recommendations       collaborative-filtering ranking for a user
POST /classify-intent       ML intent classification (hybrid chatbot)
POST /parse                 intent (ML) + slots (rules) in one call — fast,
                             non-LLM; used internally as /understand's
                             fallback and directly for automated relabeling
POST /understand            LLM-first: intent + every slot in one call,
                             reading the actual conversation — the
                             backend's PRIMARY NLU entry point
POST /generate              generic Groq/Gemini call (prompt in, reply out)
POST /log-intent            label (message, intent) pairs for retraining
POST /train                 retrain all models from MongoDB
POST /collaboration-match   batch co-host likelihood for event pairs —
                            the advanced half of the AI collaboration
                            suggestions (Node falls back to its heuristic
                            scorer when this model is absent)
"""

import os
import json
import re

import joblib
import numpy as np
from bson import ObjectId
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field
import threading

import db as data
from features import build_rows, build_pair_rows, cosine_texts, event_text
from llm import generate_reply
from nlu import extract_slots
import train as training

load_dotenv()

app = FastAPI(title="EventNexus AI Service", version="1.0.0")

_attendance = None
_cf = None
_intent = None
_match = None
_train_lock = threading.Lock()
_model_lock = threading.Lock()

# Closed intent set shared with the backend chatbot; used to validate
# labels an admin assigns in the training-data console.
KNOWN_INTENTS = {
    "recommend", "near_me", "my_tickets", "pricing", "organizer",
    "upcoming_events", "venue", "schedule", "registration_status",
    "popular_events", "capacity", "cancellation", "greeting", "categories",
    "event_count", "create_event", "join_event", "fallback",
}


class AttendanceRequest(BaseModel):
    events: list[dict] = Field(..., max_length=1000)


class RecommendationsRequest(BaseModel):
    user_id: str = Field(..., min_length=1, max_length=100)
    organization_id: str | None = Field(None, max_length=100)


class ClassifyRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)


class ParseRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)


class UnderstandRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    history: list[dict] | None = Field(None, max_length=20)


class GenerateRequest(BaseModel):
    system_prompt: str = Field(..., max_length=5000)
    user_prompt: str = Field(..., max_length=5000)
    history: list[dict] | None = Field(None, max_length=20)


class LogIntentRequest(BaseModel):
    message: str = Field(..., min_length=1, max_length=2000)
    intent: str = Field(..., min_length=1, max_length=50)


class PatchChatlogRequest(BaseModel):
    intent: str = Field(..., min_length=1, max_length=50)


class CollabMatchRequest(BaseModel):
    pairs: list[dict] = Field(..., max_length=200)


def _load_models():
    global _attendance, _cf, _intent, _match
    with _model_lock:
        try:
            _attendance = joblib.load(training.ATTENDANCE_PATH) if os.path.exists(training.ATTENDANCE_PATH) else None
        except Exception as e:
            print(f"[load] attendance model failed: {e}")
            _attendance = None
        try:
            _cf = joblib.load(training.CF_PATH) if os.path.exists(training.CF_PATH) else None
        except Exception as e:
            print(f"[load] cf model failed: {e}")
            _cf = None
        try:
            _intent = joblib.load(training.INTENT_PATH) if os.path.exists(training.INTENT_PATH) else None
        except Exception as e:
            print(f"[load] intent model failed: {e}")
            _intent = None
        try:
            _match = joblib.load(training.MATCH_PATH) if os.path.exists(training.MATCH_PATH) else None
        except Exception as e:
            print(f"[load] match model failed: {e}")
            _match = None


@app.on_event("startup")
def _startup():
    # Auto-train on startup when any model is missing (cold start). Models
    # already present are left untouched to keep boot fast; retrain via /train.
    try:
        missing = [
            name
            for name, path in [
                ("attendance", training.ATTENDANCE_PATH),
                ("cf", training.CF_PATH),
                ("intent", training.INTENT_PATH),
                ("collaboration_match", training.MATCH_PATH),
            ]
            if not os.path.exists(path)
        ]
        if missing:
            print(f"[startup] missing models: {missing} -> training")
            try:
                training.train_all()
            except Exception as e:
                print(f"[startup] training failed: {e}")
        _load_models()
    except Exception as e:
        print(f"[startup] failed: {e}")


@app.get("/health")
def health():
    models = {
        "attendance": _attendance is not None,
        "cf": _cf is not None,
        "intent": _intent is not None,
        "collaboration": _match is not None,
    }
    all_ready = all(models.values())
    return {
        "status": "ok" if all_ready else "degraded",
        "models": models,
    }


@app.post("/train")
def retrain():
    if not _train_lock.acquire(blocking=False):
        raise HTTPException(status_code=429, detail="Training already in progress")
    try:
        results = training.train_all()
        _load_models()
        return results
    except Exception as e:
        print(f"[train] failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        _train_lock.release()


def _read_meta():
    try:
        with open(training.META_PATH) as fh:
            return json.load(fh)
    except (OSError, json.JSONDecodeError):
        return {"models": {}}


@app.get("/stats")
def stats():
    """Model metadata + training-data counts + intent distribution — powers
    the admin training console."""
    meta = _read_meta()
    events = list(data.get_db().events.find({}, {"status": 1}))
    chatlog = data.load_chat_log()
    distribution = {}
    for c in chatlog:
        intent = c.get("intent")
        distribution[intent] = distribution.get(intent, 0) + 1

    return {
        "models": meta.get("models", {}),
        "data": {
            "events": len(events),
            "pastEvents": sum(1 for e in events if e.get("status") == "Past"),
            "upcomingEvents": sum(1 for e in events if e.get("status") in ("Upcoming", "Live")),
            "tickets": data.get_db().tickets.count_documents({}),
            "chatlog": len(chatlog),
            "collabPairs": len(data.load_collab_pairs()[0]),
        },
        "intentDistribution": distribution,
    }


@app.get("/chatlog")
def list_chatlog(limit: int = 50, offset: int = 0, intent: str | None = None, search: str | None = None):
    """Labeled (message -> intent) training samples, newest first."""
    limit = max(1, min(limit, 200))
    offset = max(0, offset)
    query = {}
    if intent:
        query["intent"] = intent
    if search:
        # Limit regex length to avoid ReDoS
        safe_search = search[:100]
        query["message"] = {"$regex": re.escape(safe_search), "$options": "i"}
    cursor = (
        data.get_db().chatlog.find(query)
        .sort("_id", -1)
        .skip(offset)
        .limit(limit)
    )
    def _fmt_date(v):
        if not v:
            return None
        if hasattr(v, "isoformat"):
            try:
                return v.isoformat()
            except Exception:
                return str(v)
        return str(v)
    return {
        "total": data.get_db().chatlog.count_documents(query),
        "samples": [
            {
                "id": str(s["_id"]),
                "message": s.get("message", ""),
                "intent": s.get("intent", ""),
                "createdAt": _fmt_date(s.get("createdAt")),
            }
            for s in cursor
        ],
    }


@app.patch("/chatlog/{sample_id}")
def patch_chatlog(sample_id: str, req: PatchChatlogRequest):
    """Fix a mislabeled training sample; takes effect on next /train."""
    if req.intent not in KNOWN_INTENTS:
        raise HTTPException(status_code=400, detail=f"intent must be one of: {sorted(KNOWN_INTENTS)}")
    try:
        _id = ObjectId(sample_id)
    except Exception:
        raise HTTPException(status_code=400, detail="invalid sample id")
    result = data.get_db().chatlog.update_one({"_id": _id}, {"$set": {"intent": req.intent}})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="sample not found")
    return {"ok": True}


@app.delete("/chatlog/{sample_id}")
def delete_chatlog(sample_id: str):
    """Remove a training sample (noise, PII, duplicates)."""
    try:
        _id = ObjectId(sample_id)
    except Exception:
        raise HTTPException(status_code=400, detail="invalid sample id")
    result = data.get_db().chatlog.delete_one({"_id": _id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="sample not found")
    return {"ok": True}


@app.post("/predict-attendance")
def predict_attendance(req: AttendanceRequest):
    """Batch forecast: returns one prediction per event, clipped to [0, capacity]."""
    if _attendance is None:
        raise HTTPException(status_code=503, detail="Attendance model not ready")
    try:
        model = _attendance["model"]
        X, ids = build_rows(req.events)
        if X.shape[0] == 0:
            return {"predictions": []}
        preds = model.predict(X)
        capacity_by_id = {}
        for e in req.events:
            _id = e.get("_id")
            if _id is None:
                continue
            cap = e.get("capacity")
            try:
                cap_num = float(cap) if cap is not None else None
                if cap_num is not None and cap_num <= 0:
                    cap_num = None
            except (ValueError, TypeError):
                cap_num = None
            capacity_by_id[str(_id)] = cap_num
        out = []
        for i, eid in enumerate(ids):
            cap = capacity_by_id.get(eid)
            if cap is not None:
                clipped = float(np.clip(preds[i], 0, cap))
            else:
                clipped = float(max(0, preds[i]))
            out.append({"event_id": eid, "predicted": round(clipped)})
        return {"predictions": out}
    except HTTPException:
        raise
    except Exception as e:
        print(f"[predict] failed: {e}")
        raise HTTPException(status_code=500, detail="Prediction failed")


@app.post("/collaboration-match")
def collaboration_match(req: CollabMatchRequest):
    """Batch co-host likelihood for event pairs.

    The ML half of AI collaboration suggestions: each pair gets a calibrated-
    by-training probability that the two organizations would co-host those
    events together (RandomForest over structural features + TF-IDF content
    cosine). Returns matches in input order; when the model is absent (cold
    start — not enough real accept/decline decisions yet), returns an empty
    list and the Node backend uses its deterministic scorer instead.
    """
    if _match is None:
        return {"matches": []}
    model, vectorizer = _match["model"], _match["vectorizer"]

    X, ids = build_pair_rows(req.pairs)
    if X.shape[0] == 0:
        return {"matches": []}

    # build_pair_rows drops malformed pairs, so X is aligned with `ids`, not
    # with req.pairs — map each pair id to its row index for the text fill.
    row_index = {pid: i for i, pid in enumerate(ids)}
    for pair in req.pairs:
        pid = pair.get("id") or pair.get("pair_id")
        idx = row_index.get(pid)
        if idx is None:
            continue
        a, b = pair.get("event_a"), pair.get("event_b")
        if not a or not b:
            continue
        X[idx, 7] = cosine_texts(vectorizer, event_text(a), event_text(b))

    probs = model.predict_proba(X)
    pos_col = list(model.classes_).index(1)
    return {
        "matches": [
            {
                "id": ids[i],
                "score": round(float(probs[i][pos_col]), 4),
                "source": "ml",
            }
            for i in range(X.shape[0])
            if ids[i]
        ]
    }


@app.post("/recommendations")
def recommendations(req: RecommendationsRequest):
    """Collaborative-filtering ranking for one user.

    Returns has_cf=false on cold start (user unknown to the model), so the
    Node backend can fall back to its deterministic scorer.
    """
    if _cf is None:
        return {"has_cf": False, "recommendations": []}

    uid = str(req.user_id)
    if uid not in _cf["uid"]:
        return {"has_cf": False, "recommendations": []}

    user_idx = _cf["uid"][uid]
    user_vec = _cf["user_latent"][user_idx : user_idx + 1]
    distances, indices = _cf["nn"].kneighbors(user_vec)

    candidates = {str(e.get("_id")): e for e in data.load_upcoming_events(req.organization_id)}

    # Exclude events the user already interacted with (matrix value > 0).
    attended = set(
        e
        for e, v in zip(_cf["events"], np.asarray(_cf["matrix"][user_idx].todense()).ravel())
        if v > 0
    )

    scored = []
    for dist, idx in zip(distances[0], indices[0]):
        event_id = _cf["events"][int(idx)]
        if event_id in attended or event_id not in candidates:
            continue
        score = float(1.0 - dist)
        if score <= 0:
            continue
        scored.append({"event_id": event_id, "score": round(score, 4)})

    scored.sort(key=lambda s: s["score"], reverse=True)
    return {"has_cf": True, "recommendations": scored[:30]}


@app.post("/classify-intent")
def classify_intent(req: ClassifyRequest):
    """ML half of the hybrid chatbot: predict the closed intent set."""
    if _intent is None:
        return {"intent": None, "score": None}
    pipe = _intent
    text = (req.message or "").strip().lower()
    if not text:
        return {"intent": None, "score": None}
    try:
        dec = pipe.decision_function([text])
        # Handle both single-output (1D) and multi-output (2D) cases
        scores = dec[0] if hasattr(dec[0], "__len__") else dec
        if not hasattr(scores, "__len__"):
            # Binary case with single score
            idx = 0 if scores < 0 else 1
            # Map to class
            if len(pipe.classes_) == 2:
                return {"intent": pipe.classes_[idx] if idx < len(pipe.classes_) else pipe.classes_[0], "score": float(scores)}
            return {"intent": pipe.classes_[0], "score": float(scores)}
        idx = int(np.argmax(scores))
        return {"intent": pipe.classes_[idx], "score": float(scores[idx])}
    except Exception as e:
        print(f"[classify] failed: {e}")
        return {"intent": None, "score": None}


@app.post("/parse")
def parse(req: ParseRequest):
    """Unified NLU call: ML intent classification plus rule-based slot
    extraction (quantity/time-scope/price preference — see nlu.py for why
    those are rules, not a second model) in a single round trip, so the
    backend has one place to ask "what does this message mean" instead of
    juggling separate classify + regex logic across two languages."""
    text = (req.message or "").strip()
    classification = classify_intent(ClassifyRequest(message=text))
    return {
        "intent": classification["intent"],
        "score": classification["score"],
        "slots": extract_slots(text),
    }


def _extract_json(text: str) -> dict | None:
    """LLMs routinely wrap JSON in ```json fences or add a stray sentence
    before/after it — grab the first {...} block rather than requiring an
    exact match."""
    if not text:
        return None
    # Strip markdown fences first
    cleaned = re.sub(r"```(?:json)?", "", text)
    match = re.search(r"\{.*?\}", cleaned, re.S)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return None


def _normalize_slots(parsed: dict) -> dict:
    """Never trust LLM output verbatim into the response — clamp every
    field to its actual valid range so a hallucinated value (a made-up
    string, an out-of-range number) can't reach the backend as if it were
    a confidently-detected slot."""
    quantity = parsed.get("quantity")
    time_scope = parsed.get("time_scope")
    price_pref = parsed.get("price_pref")
    count = parsed.get("count")
    return {
        "quantity": quantity if quantity in ("one", "many") else None,
        "time_scope": time_scope if time_scope in ("past", "upcoming") else None,
        "price_pref": price_pref if price_pref in ("free", "paid") else None,
        "count": count if isinstance(count, int) and 1 <= count <= 50 else None,
    }


def _sanitize_history(history: list[dict] | None) -> list[dict] | None:
    if not history:
        return None
    # Limit to last 10 turns, truncate long contents, and validate roles
    sanitized = []
    for turn in history[-10:]:
        if not isinstance(turn, dict):
            continue
        role = turn.get("role")
        if role not in ("user", "assistant", "system"):
            continue
        content = str(turn.get("content", ""))[:2000]
        if not content.strip():
            continue
        sanitized.append({"role": role, "content": content})
    return sanitized if sanitized else None

@app.post("/understand")
def understand(req: UnderstandRequest):
    """LLM-first understanding: ONE call reads the message plus conversation
    history and returns intent + every slot together, instead of trying to
    anticipate every possible phrasing with more regex (a losing game — the
    English language has more phrasings than anyone can enumerate). This is
    the backend's primary NLU entry point; /parse's rule-based logic is used
    here only as the fallback when the LLM itself returns nothing usable
    (no API keys configured, both providers down, or a malformed response),
    so understanding still degrades gracefully rather than failing outright.
    """
    text = (req.message or "").strip()
    if not text:
        return {"intent": None, "slots": _normalize_slots({}), "source": None}

    system_prompt = (
        "You are the natural-language understanding layer for an event-management chatbot. "
        "Be very tolerant of typos, informal spelling, and missing punctuation (e.g. 'recomend', 'evnet', 'capcity', 'neer me', 'hii', 'plz'). "
        "Read the user's LATEST message together with the conversation history and reply with ONLY a single-line "
        "JSON object — no markdown fences, no explanation, no extra keys — with exactly these keys:\n"
        f'"intent": one of {sorted(KNOWN_INTENTS)},\n'
        '"quantity": "one" if they want ONE specific event, "many" if they want a list, else null,\n'
        '"time_scope": "past" if asking about past/concluded/finished events, "upcoming" if asking about '
        "upcoming/future events, else null,\n"
        '"price_pref": "free", "paid", or null,\n'
        '"count": an integer 1-50 if they asked for a specific number of results (e.g. "10 events"), else null\n\n'
        "CRITICAL — determinism and history:\n"
        "- Your JSON must be valid and minimal: single line, double-quoted keys/strings, null without quotes.\n"
        "- Resolve short follow-ups using the history — e.g. after the bot lists upcoming events, a reply of "
        '"just 1" means quantity="one" for the SAME intent (usually upcoming_events); "how about paid ones" means price_pref="paid" for the same time_scope '
        "as before; 'that one', 'first', 'second', 'it', '2' refer to the last listed events by position (1st/2nd). "
        "- Never invent slots: if not mentioned and not inferable from history, use null. Never hallucinate counts or preferences.\n"
        "- Use intent 'greeting' ONLY for an actual greeting or small talk with recognizable words "
        "('hi', 'hello', 'hey', 'thanks', 'how are you', 'what can you do') — tolerate minor typos ('hii', 'helo') as greeting too. "
        "Use intent 'create_event' for any request to "
        "CREATE, HOST, PLAN, ORGANIZE, or PUBLISH a new event ('I want to host a workshop', 'how do I create an "
        "event', 'set up a new meetup') — but NOT a request to browse/list/recommend/count existing events, which "
        "belong to their own intents even if the word 'event' appears alongside a similar verb. Use intent "
        "'join_event' for any request to JOIN, REGISTER, SIGN UP, ENROLL, or BOOK an existing event "
        "('join Tech Conference', 'register me for the AI workshop', 'sign up for that event', 'I want to attend'). "
        "Use intent 'fallback' for EVERYTHING else that isn't genuinely one of the other labels — meta questions about the "
        "bot itself ('are you an AI?'), requests to DO something the bot can't do here that ISN'T event creation/joining "
        "(edit/delete an existing event, change account settings, issue refunds), AND unclear/nonsensical/"
        "unparseable text (random characters, gibberish, a message with no discernible words or intent). Never "
        "default confusing input to 'greeting' just because nothing else fits — 'fallback' triggers a real, "
        "tailored LLM answer downstream, while 'greeting' always returns the exact same canned reply, so "
        "misclassifying unclear messages as 'greeting' makes every unclear message look identical."
    )
    safe_history = _sanitize_history(req.history)
    reply = generate_reply(system_prompt, text, safe_history)
    parsed = _extract_json(reply) if reply else None
    if parsed and parsed.get("intent") in KNOWN_INTENTS:
        return {"intent": parsed["intent"], "slots": _normalize_slots(parsed), "source": "llm"}

    # LLM unavailable or returned something unusable — deterministic fallback.
    # History-aware: short follow-ups like "just 1" or "paid ones" inherit prior context.
    classification = classify_intent(ClassifyRequest(message=text))
    base_slots = extract_slots(text)
    # Try to enrich slots from history when current message is a short follow-up
    try:
        if safe_history:
            last_user = next((h for h in reversed(safe_history) if h.get("role") == "user"), None)
            last_assistant = next((h for h in reversed(safe_history) if h.get("role") == "assistant"), None)
            has_listing = last_assistant and ("|" in last_assistant.get("content","") or "There are" in last_assistant.get("content","") or "coming up" in last_assistant.get("content","").lower())
            is_short = text.strip().lower() in ("just 1", "just one", "one", "1", "single", "first", "1st", "second", "2nd", "third", "3rd", "that one", "this one", "it") or re.match(r"^\s*(just\s+)?(one|1|single)\s*\.?\s*$", text, re.I) or re.match(r"^\s*\d{1,2}\s*$", text.strip())
            if is_short and has_listing and last_user:
                prev_slots = extract_slots(last_user.get("content",""))
                # Inherit price/time if missing
                if not base_slots.get("price_pref") and prev_slots.get("price_pref"):
                    base_slots["price_pref"] = prev_slots["price_pref"]
                if not base_slots.get("time_scope") and prev_slots.get("time_scope"):
                    base_slots["time_scope"] = prev_slots["time_scope"]
                # Bare quantifier -> quantity one
                if not base_slots.get("quantity") and re.search(r"\b(one|1|single|first|1st|that one|this one|it)\b", text, re.I):
                    base_slots["quantity"] = "one"
                # If intent was fallback but history had a real intent, inherit it
                if not classification["intent"] and last_user:
                    prev_intent = classify_intent(ClassifyRequest(message=last_user.get("content",""))).get("intent")
                    if prev_intent in KNOWN_INTENTS and prev_intent != "fallback":
                        classification["intent"] = prev_intent
    except Exception:
        pass
    return {"intent": classification["intent"], "slots": _normalize_slots(base_slots), "source": "rules"}


@app.post("/generate")
def generate(req: GenerateRequest):
    """Generic Groq/Gemini call — this service's one LLM entry point (see
    llm.py). The backend builds the system/user prompt (it owns the
    grounded-data formatting that must never be paraphrased away — see the
    long comment in chatbotController.js about why grounded facts are
    returned verbatim, never LLM-rewritten); this just executes the call so
    the actual API keys and HTTP/retry logic for Groq and Gemini live in
    exactly one place instead of being duplicated in Node."""
    safe_history = _sanitize_history(req.history)
    if not req.system_prompt.strip() or not req.user_prompt.strip():
        raise HTTPException(status_code=400, detail="system_prompt and user_prompt required")
    reply = generate_reply(req.system_prompt[:5000], req.user_prompt[:5000], safe_history)
    if reply is None:
        raise HTTPException(status_code=503, detail="LLM unavailable")
    return {"reply": reply}


@app.post("/log-intent")
def log_intent(req: LogIntentRequest):
    """Store a regex-confirmed (message, intent) label for retraining."""
    message = (req.message or "").strip().lower()
    if not message or not req.intent:
        raise HTTPException(status_code=400, detail="message and intent required")
    if req.intent not in KNOWN_INTENTS:
        raise HTTPException(status_code=400, detail=f"intent must be one of: {sorted(KNOWN_INTENTS)}")
    if len(message) > 2000:
        raise HTTPException(status_code=400, detail="message too long")
    data.insert_chat_log(message, req.intent)
    return {"ok": True}
