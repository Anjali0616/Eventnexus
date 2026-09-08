// Thin HTTP client for the Python AI service (ai-service/, FastAPI).
// Every call is best-effort: a failure (service down, timeout, no model)
// returns null so callers fall back to deterministic Node heuristics —
// the AI service augments accuracy, it never blocks the app.
//
// Config: AI_SERVICE_URL (default http://localhost:8000).

import { generateReply as generateReplyLocal } from "./aiProvider";

const AI_BASE: string = process.env.AI_SERVICE_URL || "http://localhost:8000";

export const call = async (path: string, body: any, timeoutMs: number, method: string = "POST"): Promise<any | null> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const isBodyless = method === "GET" || method === "HEAD";
  try {
    const res: any = await fetch(`${AI_BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      ...(isBodyless ? {} : { body: JSON.stringify(body) }),
      signal: controller.signal as any,
    });
    if (!res.ok) return null;
    return await res.json();
  } catch (error: any) {
    console.error(`[ai-service] ${path} failed: ${error.message}`);
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

// Batch attendance forecast. Returns [{ event_id, predicted }] or null.
export const predictAttendance = async (events: any[], timeoutMs: number = 2000): Promise<any | null> => {
  const data: any = await call("/predict-attendance", { events }, timeoutMs);
  return data?.predictions || null;
};

// Collaborative-filtering ranking for a user.
// Returns { has_cf, recommendations: [{ event_id, score }] } or null.
export const recommend = async (userId: any, organizationId: any, timeoutMs: number = 2500): Promise<any | null> => {
  const data: any = await call(
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
export const classifyIntent = async (message: string, timeoutMs: number = 1500): Promise<any | null> => {
  const data: any = await call("/classify-intent", { message }, timeoutMs);
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
export const parse = async (message: string, timeoutMs: number = 1500): Promise<any | null> => {
  const data: any = await call("/parse", { message }, timeoutMs);
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
export const understand = async (message: string, history: any[] = [], timeoutMs: number = 8000): Promise<any | null> => {
  // keep payload small for speed
  const trimmedHistory = Array.isArray(history) ? history.slice(-8) : [];
  const data: any = await call("/understand", { message, history: trimmedHistory }, timeoutMs);
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
export const generate = async (systemPrompt: string, userPrompt: string, history: any[] = [], timeoutMs: number = 10000): Promise<string | null> => {
  const trimmedHistory = Array.isArray(history) ? history.slice(-6) : [];
  const data: any = await call(
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
export const collaborationMatch = async (pairs: any[], timeoutMs: number = 3000): Promise<any | null> => {
  const data: any = await call("/collaboration-match", { pairs }, timeoutMs);
  if (!data?.matches) return null;
  return data.matches;
};

let _healthCache: any | null = null;
let _healthCacheAt: number = 0;
const HEALTH_TTL_MS: number = 15000;
// Service + model health. Cached 15s to avoid hammering AI service on every
// popular_events/capacity query (was called inline without cache).
export const health = async (timeoutMs: number = 1500): Promise<any | null> => {
  if (_healthCache && Date.now() - _healthCacheAt < HEALTH_TTL_MS) return _healthCache;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res: any = await fetch(`${AI_BASE}/health`, { signal: controller.signal as any });
    if (!res.ok) return null;
    const data: any = await res.json();
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
export const getStats = async (timeoutMs: number = 2000): Promise<any | null> => {
  const data: any = await call("/stats", {}, timeoutMs, "GET");
  return data ?? null;
};

// Trigger full retraining of all models; returns per-model results.
export const retrain = async (timeoutMs: number = 120000): Promise<any | null> => {
  const data: any = await call("/train", {}, timeoutMs);
  return data ?? null;
};

// Labeled (message -> intent) training samples, newest first.
export const listChatlog = async ({ limit = 50, offset = 0, intent, search }: { limit?: number; offset?: number; intent?: string; search?: string } = {}, timeoutMs: number = 3000): Promise<any | null> => {
  const qs = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (intent) qs.set("intent", intent);
  if (search) qs.set("search", search);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res: any = await fetch(`${AI_BASE}/chatlog?${qs}`, { signal: controller.signal as any });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
};

// Fix a mislabeled sample's intent (takes effect on next retrain).
export const patchChatlog = async (sampleId: string | any, intent: string, timeoutMs: number = 3000): Promise<any | null> => {
  return call(`/chatlog/${sampleId}`, { intent }, timeoutMs, "PATCH");
};

// Remove a noisy/duplicate training sample (takes effect on next retrain).
export const deleteChatlog = async (sampleId: string | any, timeoutMs: number = 3000): Promise<any | null> => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res: any = await fetch(`${AI_BASE}/chatlog/${sampleId}`, { method: "DELETE", signal: controller.signal as any });
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
export const logIntent = (message: string, intent: string): void => {
  fetch(`${AI_BASE}/log-intent`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, intent }),
  }).catch(() => {});
};

export default {
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
