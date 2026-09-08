// Thin HTTP client for the Python AI service (ai-service/, FastAPI).
// Every call is best-effort: a failure (service down, timeout, no model)
// returns null so callers fall back to deterministic Node heuristics —
// the AI service augments accuracy, it never blocks the app.
//
// Config: AI_SERVICE_URL (default http://localhost:8000).

const { generateReply: generateReplyLocal } = require("./aiProvider");

const AI_BASE = process.env.AI_SERVICE_URL || "http://localhost:8000";

const call = async (path, body, timeoutMs, method = "POST") => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const isBodyless = method === "GET" || method === "HEAD";
  try {
    const res = await fetch(`${AI_BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(isBodyless ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (error) {
    console.error(`[ai-service] ${path} failed: ${error.message}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

// Batch attendance forecast. Returns [{ event_id, predicted }] or null.
const predictAttendance = async (events, timeoutMs = 2000) => {
  const data = await call("/predict-attendance", { events }, timeoutMs);
  return data?.predictions || null;
};

// Collaborative-filtering ranking for a user.
// Returns { has_cf, recommendations: [{ event_id, score }] } or null.
const recommend = async (userId, organizationId, timeoutMs = 2500) => {
  const data = await call(
    "/recommendations",
    { user_id: userId, organization_id: organizationId },
    timeoutMs
  );
  if (!data) return null;
  return { has_cf: !!data.has_cf, recommendations: data.recommendations || [] };
};

// ML intent classification. Returns { intent, score } or null.
// LinearSVC margins are uncalibrated; accept only confidently-argmax picks
// (score >= -0.5) so weak guesses fall through to the LLM classifier.
const classifyIntent = async (message, timeoutMs = 1500) => {
  const data = await call("/classify-intent", { message }, timeoutMs);
  if (!data?.intent || data.score == null || data.score < -0.5) return null;
  return data;
};

// Unified NLU call: ML intent classification + rule-based slot extraction
// (quantity/time-scope/price preference — see ai-service/nlu.py) in one
// round trip. Returns { intent: string|null, slots: {...} } — intent is
// null (not just low-confidence-dropped) when the service can't classify,
// so callers can fall back to their own logic per-field independently.
// Slots are always returned as an object (defaulting every field to null)
// so callers never need to null-check the slots container itself, only
// individual fields.
const parse = async (message, timeoutMs = 1500) => {
  const data = await call("/parse", { message }, timeoutMs);
  if (!data) return null;
  const confidentIntent = data.intent && data.score != null && data.score >= -0.5 ? data.intent : null;
  return {
    intent: confidentIntent,
    slots: { quantity: null, time_scope: null, price_pref: null, count: null, ...(data.slots || {}) },
  };
};

// LLM-first understanding: ONE call reads the message + conversation history
// and returns intent + every slot together (see ai-service/app.py's
// /understand — the LLM is asked directly, not pattern-matched against).
// Optimized for speed: 8s timeout with fast fallback to regex — user expects <2s,
// not 45s. History is capped to 8 turns to keep prompt small.
const understand = async (message, history = [], timeoutMs = 8000) => {
  // keep payload small for speed
  const trimmedHistory = Array.isArray(history) ? history.slice(-8) : [];
  const data = await call("/understand", { message, history: trimmedHistory }, timeoutMs);
  if (!data?.intent) return null;
  return {
    intent: data.intent,
    slots: { quantity: null, time_scope: null, price_pref: null, count: null, ...(data.slots || {}) },
    source: data.source || null,
  };
};

// Generic LLM call: the AI service's Groq/Gemini calls (see ai-service/llm.py)
// are now the primary implementation — this is the one place Node asks an
// LLM for anything (chatbot intent-classification fallback, chatbot
// free-form last-resort answers, recommendation "why" text). The caller
// builds the prompt; this just gets it answered.
//
// Unlike every other function here, a failed/unreachable AI service does
// NOT return null — it falls back to calling Groq/Gemini directly from
// Node (utils/aiProvider.js), so an LLM-dependent feature still works even
// if the Python service itself is down. Timeout trimmed to 10s for speed
// (was 45s) — fallback to local LLM still happens fast.
const generate = async (systemPrompt, userPrompt, history = [], timeoutMs = 10000) => {
  const trimmedHistory = Array.isArray(history) ? history.slice(-6) : [];
  const data = await call(
    "/generate",
    { system_prompt: systemPrompt, user_prompt: userPrompt, history: trimmedHistory },
    timeoutMs
  );
  if (data?.reply) return data.reply;
  return generateReplyLocal(systemPrompt, userPrompt, trimmedHistory);
};

// ML co-host likelihood for event pairs (the "advanced AI" half of the
// collaboration suggestions — ai-service's collaboration_match model, see
// train.py). Each input pair: { id, event_a, event_b } where the events
// carry the fields the pair-feature builder needs (title, description,
// date, venue, coordinates, type, category, capacity, registered, tags,
// highlights, agenda, speakers, and an embedded org: { city, country }).
// Returns [{ id, score (0..1), source }] in input order, or null when the
// service/model is unavailable — the caller (collaborationEngine) then
// falls back to its deterministic scorer.
const collaborationMatch = async (pairs, timeoutMs = 3000) => {
  const data = await call("/collaboration-match", { pairs }, timeoutMs);
  if (!data?.matches) return null;
  return data.matches;
};

let _healthCache = null;
let _healthCacheAt = 0;
const HEALTH_TTL_MS = 15000;
// Service + model health. Cached 15s to avoid hammering AI service on every
// popular_events/capacity query (was called inline without cache).
const health = async (timeoutMs = 1500) => {
  if (_healthCache && Date.now() - _healthCacheAt < HEALTH_TTL_MS) return _healthCache;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${AI_BASE}/health`, { signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();
    const models = data?.models || {};
    const result = {
      online: true,
      attendance: !!models.attendance,
      cf: !!models.cf,
      intent: !!models.intent,
      collaboration: !!models.collaboration,
    };
    _healthCache = result;
    _healthCacheAt = Date.now();
    return result;
  } catch {
    return _healthCache || null;
  } finally {
    clearTimeout(timeout);
  }
};

// --- Admin console endpoints (backend proxies to the AI service) ---

// Model metadata + training-data stats for the admin console.
const getStats = async (timeoutMs = 2000) => {
  const data = await call("/stats", {}, timeoutMs, "GET");
  return data ?? null;
};

// Trigger full retraining of all models; returns per-model results.
const retrain = async (timeoutMs = 120000) => {
  const data = await call("/train", {}, timeoutMs);
  return data ?? null;
};

// Labeled (message -> intent) training samples, newest first.
const listChatlog = async ({ limit = 50, offset = 0, intent, search } = {}, timeoutMs = 3000) => {
  const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (intent) qs.set("intent", intent);
  if (search) qs.set("search", search);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${AI_BASE}/chatlog?${qs}`, { signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

// Fix a mislabeled sample's intent (takes effect on next retrain).
const patchChatlog = async (sampleId, intent, timeoutMs = 3000) => {
  return call(`/chatlog/${sampleId}`, { intent }, timeoutMs, "PATCH");
};

// Remove a noisy/duplicate training sample (takes effect on next retrain).
const deleteChatlog = async (sampleId, timeoutMs = 3000) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${AI_BASE}/chatlog/${sampleId}`, { method: "DELETE", signal: controller.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

// Fire-and-forget: label a regex-confirmed (message, intent) pair so the
// classifier self-improves on retrain. Never throws.
const logIntent = (message, intent) => {
  fetch(`${AI_BASE}/log-intent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, intent }),
  }).catch(() => {});
};

module.exports = {
  predictAttendance,
  recommend,
  classifyIntent,
  parse,
  understand,
  generate,
  collaborationMatch,
  logIntent,
  health,
  getStats,
  retrain,
  listChatlog,
  patchChatlog,
  deleteChatlog,
};
