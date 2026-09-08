"""Training pipeline for all three EventNexus AI models (PDF §3.5):

  1. attendance_model  — attendance prediction, trained on historical
     registration/attendance data of past events (HistGradientBoosting).
  2. cf_models         — collaborative filtering recommender: implicit
     user x event matrix from tickets, item-item cosine similarity in a
     truncated-SVD latent space (NearestNeighbors for retrieval).
  3. intent_model      — rule-based + ML hybrid chatbot classifier:
     TF-IDF (word + char n-grams) -> LinearSVC, trained on a static seed
     corpus PLUS every (message, intent) pair the app confirmed via its
     deterministic regex cascade (self-improving over time).
  4. match_model       — collaboration-match classifier: pair of events ->
     probability the two organizations would co-host them. Trained on REAL
     decisions (accepted suggestions = positive, declined = negative, plus
     mutual co-host pairs), RandomForest over structural features +
     TF-IDF content cosine. Inference happens in /collaboration-match.

Everything persists to MODELS_DIR as joblib artifacts. Any model that
can't be trained (empty DB) is skipped — inference then reports
"unavailable" and the Node backend falls back to its heuristics.
"""

import os
import json
from datetime import datetime, timezone

import joblib
import numpy as np
from dotenv import load_dotenv

from features import FEATURE_NAMES, PAIR_FEATURE_NAMES, build_rows, build_pair_rows, cosine_texts, event_text
import db as data

load_dotenv()

MODELS_DIR = os.getenv("MODELS_DIR", "./models")
os.makedirs(MODELS_DIR, exist_ok=True)

ATTENDANCE_PATH = os.path.join(MODELS_DIR, "attendance.joblib")
CF_PATH = os.path.join(MODELS_DIR, "cf.joblib")
INTENT_PATH = os.path.join(MODELS_DIR, "intent.joblib")
MATCH_PATH = os.path.join(MODELS_DIR, "collaboration_match.joblib")
META_PATH = os.path.join(MODELS_DIR, "meta.json")

MIN_ATTENDANCE_SAMPLES = 5
MIN_CF_USERS = 2
MIN_INTENT_SAMPLES_PER_CLASS = 1
# The collaboration classifier needs BOTH outcome classes; with fewer real
# positive decisions its labels don't generalize — skip instead of fitting
# noise (Node keeps its heuristic until real decisions accumulate).
MIN_MATCH_POSITIVES = 8

# Static seed corpus: covers the closed intent set even before the app has
# accumulated its own labeled queries. Mirrors the backend's INTENTS list.
SEED_CORPUS = [
    ("recommend", "recommend events for me"),
    ("recommend", "what should I attend this weekend"),
    ("recommend", "suggest something for me"),
    ("recommend", "top picks for me"),
    ("recommend", "best events for me"),
    ("near_me", "find events near me"),
    ("near_me", "what is nearby"),
    ("near_me", "events close to me"),
    ("near_me", "what is around me"),
    ("my_tickets", "show my tickets"),
    ("my_tickets", "my bookings"),
    ("my_tickets", "my registrations"),
    ("my_tickets", "list my tickets"),
    ("pricing", "any free events"),
    ("pricing", "how much is the ticket"),
    ("pricing", "is it free"),
    ("pricing", "ticket price"),
    ("pricing", "what does it cost"),
    ("pricing", "is there any cost"),
    ("organizer", "who organized this"),
    ("organizer", "who is hosting"),
    ("organizer", "hosted by whom"),
    ("upcoming_events", "what events are coming up"),
    ("upcoming_events", "any upcoming events"),
    ("upcoming_events", "list events"),
    ("upcoming_events", "what is happening soon"),
    ("upcoming_events", "any new events"),
    ("venue", "where is the event"),
    ("venue", "what is the venue"),
    ("venue", "where is it held"),
    ("schedule", "when is the event"),
    ("schedule", "what time does it start"),
    ("schedule", "event schedule"),
    ("schedule", "what date is it"),
    ("registration_status", "am I registered"),
    ("registration_status", "my registration status"),
    ("registration_status", "did I register"),
    ("popular_events", "what is trending"),
    ("popular_events", "most popular events"),
    ("popular_events", "top events"),
    ("capacity", "how many spots are left"),
    ("capacity", "is it sold out"),
    ("capacity", "event capacity"),
    ("capacity", "are there seats left"),
    ("cancellation", "cancel my registration"),
    ("cancellation", "how do I refund"),
    ("cancellation", "unregister me"),
    ("greeting", "hi"),
    ("greeting", "hello"),
    ("greeting", "hey there"),
    ("greeting", "what can you do"),
    ("categories", "what categories are there"),
    ("categories", "filter by category"),
    ("categories", "what event types exist"),
    ("event_count", "how many events are there total"),
    ("event_count", "how many events do you have"),
    ("event_count", "total number of events"),
    ("event_count", "count all events"),
    ("event_count", "how many events are there in all"),
    ("event_count", "how many events are coming up"),
    ("event_count", "how many events this week"),
    ("event_count", "how many events are live"),
    ("create_event", "I want to create an event"),
    ("create_event", "how do I create an event"),
    ("create_event", "I want to host a workshop"),
    ("create_event", "help me set up a new event"),
    ("create_event", "I'd like to organize a meetup"),
    ("create_event", "how can I publish an event"),
    ("create_event", "let's plan a conference"),
    ("create_event", "add a new event"),
]


def _drop_stale(path, name):
    """A skipped model must not keep serving stale predictions."""
    if os.path.exists(path):
        try:
            os.remove(path)
        except OSError as e:
            print(f"[train] {name}: failed to remove stale {path}: {e}")
            return
        print(f"[train] {name}: removed stale model {path}")


def _record_meta(model_name, trained, samples=0):
    meta = {"trainedAt": datetime.now(timezone.utc).isoformat(), "trained": trained, "samples": samples}
    try:
        if os.path.exists(META_PATH):
            with open(META_PATH, "r", encoding="utf-8") as fh:
                existing = json.load(fh)
        else:
            existing = {}
    except (json.JSONDecodeError, OSError):
        existing = {}
    models = existing.setdefault("models", {})
    models[model_name] = meta
    existing["models"] = models
    # Atomic write via temp file
    tmp_path = META_PATH + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as fh:
        json.dump(existing, fh, indent=2)
    os.replace(tmp_path, META_PATH)
    return meta


def train_attendance():
    """Regression model: event features -> final attendance count."""
    from sklearn.ensemble import HistGradientBoostingRegressor

    events = data.load_past_events()
    X, ids = build_rows(events)
    if X.shape[0] < MIN_ATTENDANCE_SAMPLES:
        print(f"[train] attendance skipped: {X.shape[0]} samples < {MIN_ATTENDANCE_SAMPLES}")
        _drop_stale(ATTENDANCE_PATH, "attendance")
        return _record_meta("attendance", False)

    # Build y aligned with ids order from build_rows (which filters)
    id_to_event = {str(e["_id"]): e for e in events}
    y_list = []
    for eid in ids:
        ev = id_to_event.get(eid)
        if ev is None:
            continue
        try:
            y_list.append(float(ev.get("registered", 0)))
        except (ValueError, TypeError):
            y_list.append(0.0)
    y = np.asarray(y_list, dtype=float)
    if y.shape[0] != X.shape[0]:
        print(f"[train] attendance skipped: y/X mismatch {y.shape[0]} vs {X.shape[0]}")
        _drop_stale(ATTENDANCE_PATH, "attendance")
        return _record_meta("attendance", False)

    model = HistGradientBoostingRegressor(
        max_iter=300, learning_rate=0.08, max_depth=4, random_state=42
    )
    model.fit(X, y)
    joblib.dump({"model": model, "feature_names": FEATURE_NAMES}, ATTENDANCE_PATH)
    meta = _record_meta("attendance", True, samples=int(X.shape[0]))
    print(f"[train] attendance: {X.shape[0]} samples -> {ATTENDANCE_PATH}")
    return meta


def train_cf():
    """Collaborative filtering over the implicit user x event matrix."""
    from sklearn.decomposition import TruncatedSVD
    from sklearn.neighbors import NearestNeighbors
    from sklearn.preprocessing import normalize
    from scipy.sparse import csr_matrix

    tickets = data.load_tickets()
    interactions = [(str(t.get("attendee")), str(t.get("event"))) for t in tickets if t.get("attendee") and t.get("event")]
    if len(interactions) < 2:
        print(f"[train] cf skipped: {len(interactions)} interactions")
        _drop_stale(CF_PATH, "cf")
        return _record_meta("cf", False)

    users = sorted({u for u, _ in interactions})
    events = sorted({e for _, e in interactions})
    uid = {u: i for i, u in enumerate(users)}
    eid = {e: i for i, e in enumerate(events)}

    rows, cols, vals = [], [], []
    for u, e in interactions:
        rows.append(uid[u])
        cols.append(eid[e])
        vals.append(1.0)
    matrix = csr_matrix((vals, (rows, cols)), shape=(len(users), len(events)))

    n_components = min(20, len(users) - 1, len(events) - 1)
    if n_components < 2:
        print(f"[train] cf skipped: insufficient components {n_components}")
        _drop_stale(CF_PATH, "cf")
        return _record_meta("cf", False)
    svd = TruncatedSVD(n_components=n_components, random_state=42)
    user_latent = normalize(svd.fit_transform(matrix))
    event_latent = normalize(svd.components_.T)
    nn = NearestNeighbors(n_neighbors=min(20, len(events)), metric="cosine", algorithm="brute")
    nn.fit(event_latent)

    joblib.dump(
        {
            "users": users,
            "events": events,
            "uid": uid,
            "eid": eid,
            "matrix": matrix,
            "user_latent": user_latent,
            "event_latent": event_latent,
            "nn": nn,
        },
        CF_PATH,
    )
    meta = _record_meta("cf", True, samples=len(interactions))
    print(f"[train] cf: {len(users)} users, {len(events)} events -> {CF_PATH}")
    return meta


def train_intent():
    """TF-IDF + LinearSVC intent classifier (seed corpus + app chat log)."""
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.pipeline import FeatureUnion, Pipeline
    from sklearn.svm import LinearSVC

    samples = list(SEED_CORPUS)
    samples += [(c.get("intent"), c.get("message")) for c in data.load_chat_log() if c.get("intent") and c.get("message")]

    texts = [s[1] for s in samples]
    labels = [s[0] for s in samples]
    if len(set(labels)) < 2 or len(texts) < 4:
        print("[train] intent skipped: not enough labeled samples")
        _drop_stale(INTENT_PATH, "intent")
        return _record_meta("intent", False)

    counts = {label: labels.count(label) for label in set(labels)}
    if any(c < MIN_INTENT_SAMPLES_PER_CLASS for c in counts.values()):
        print(f"[train] intent skipped: under-represented classes {counts}")
        _drop_stale(INTENT_PATH, "intent")
        return _record_meta("intent", False)

    pipe = Pipeline(
        [
            (
                "tfidf",
                FeatureUnion(
                    [
                        # Word n-grams (1-2) catch the core vocabulary.
                        (
                            "word",
                            TfidfVectorizer(
                                ngram_range=(1, 2),
                                analyzer="word",
                                stop_words="english",
                                min_df=1,
                                sublinear_tf=True,
                            ),
                        ),
                        # Char n-grams (3-6) catch typos, informal spelling and
                        # telegraphic queries ("free evts?", "nearby?") that
                        # share no exact words with the training corpus.
                        (
                            "char",
                            TfidfVectorizer(
                                ngram_range=(3, 6),
                                analyzer="char_wb",
                                min_df=1,
                                sublinear_tf=True,
                            ),
                        ),
                    ],
                    transformer_weights={"word": 1.0, "char": 0.6},
                ),
            ),
            ("clf", LinearSVC(class_weight="balanced", random_state=42, max_iter=5000)),
        ]
    )
    pipe.fit(texts, labels)
    joblib.dump(pipe, INTENT_PATH)
    meta = _record_meta("intent", True, samples=len(texts))
    print(f"[train] intent: {len(texts)} samples, {len(set(labels))} classes -> {INTENT_PATH}")
    return meta


def train_match():
    """RandomForest classifier over event-pair features -> co-host likelihood.

    Trained on REAL collaboration decisions: accepted suggestions and
    current mutual co-hosts (positive), declined suggestions (negative).
    The TF-IDF vectorizer for content similarity is fitted here on the full
    event corpus and persisted with the model, so inference (/collaboration-
    match) transforms text with the exact same vocabulary.
    """
    from sklearn.ensemble import RandomForestClassifier
    from sklearn.feature_extraction.text import TfidfVectorizer

    pairs, labels = data.load_collab_pairs()
    n_pos = sum(1 for y in labels if y == 1)
    n_neg = len(labels) - n_pos
    if n_pos < MIN_MATCH_POSITIVES or n_neg < 1:
        print(
            f"[train] collaboration_match skipped: {n_pos} positives / {n_neg} negatives "
            f"(min {MIN_MATCH_POSITIVES} positives)"
        )
        _drop_stale(MATCH_PATH, "collaboration_match")
        return _record_meta("collaboration_match", False, samples=len(labels))

    # Fit TF-IDF on every event's text (both sides of each pair) so the
    # inverted vocabulary is stable and richer than the pairs alone.
    corpus = []
    for a, b in pairs:
        corpus.append(event_text(a))
        corpus.append(event_text(b))
    vectorizer = TfidfVectorizer(
        ngram_range=(1, 2),
        analyzer="word",
        stop_words="english",
        min_df=1,
        sublinear_tf=True,
    )
    try:
        vectorizer.fit(corpus)
    except ValueError as e:
        print(f"[train] collaboration_match skipped: vectorizer {e}")
        _drop_stale(MATCH_PATH, "collaboration_match")
        return _record_meta("collaboration_match", False, samples=len(labels))

    X_rows, pair_ids = build_pair_rows(
        [{"id": f"{i}", "event_a": a, "event_b": b} for i, (a, b) in enumerate(pairs)]
    )
    if X_rows.shape[0] != len(labels):
        print(f"[train] collaboration_match skipped: {X_rows.shape[0]} rows vs {len(labels)} labels")
        _drop_stale(MATCH_PATH, "collaboration_match")
        return _record_meta("collaboration_match", False, samples=len(labels))

    # Fill the text-similarity column with the fitted vectorizer.
    for i, (a, b) in enumerate(pairs):
        X_rows[i, 7] = cosine_texts(vectorizer, event_text(a), event_text(b))

    model = RandomForestClassifier(
        n_estimators=300,
        max_depth=6,
        min_samples_leaf=2,
        class_weight="balanced",
        random_state=42,
        n_jobs=-1,
    )
    model.fit(X_rows, labels)

    joblib.dump(
        {
            "model": model,
            "vectorizer": vectorizer,
            "feature_names": PAIR_FEATURE_NAMES,
        },
        MATCH_PATH,
    )
    meta = _record_meta("collaboration_match", True, samples=len(labels))
    print(
        f"[train] collaboration_match: {len(labels)} pairs "
        f"({n_pos} pos / {n_neg} neg) -> {MATCH_PATH}"
    )
    return meta


def train_all():
    results = {}
    for name, fn in [
        ("attendance", train_attendance),
        ("cf", train_cf),
        ("intent", train_intent),
        ("collaboration_match", train_match),
    ]:
        try:
            results[name] = fn()
        except Exception as e:
            print(f"[train] {name} failed: {e}")
            _drop_stale({"attendance": ATTENDANCE_PATH, "cf": CF_PATH, "intent": INTENT_PATH, "collaboration_match": MATCH_PATH}[name], name)
            results[name] = _record_meta(name, False)
    results["trainedAt"] = datetime.now(timezone.utc).isoformat()
    return results


if __name__ == "__main__":
    print(train_all())
