// AI collaboration suggestion engine.
//
// Two-tier scoring:
//   1. Deterministic heuristic — every event-pair is scored on category,
//      format, date proximity, venue proximity, audience size, content and
//      tags; pairs that clear a low pre-bar (ML_PRE_THRESHOLD) are batched
//      and sent to the AI service.
//   2. Advanced ML — ai-service's /collaboration-match endpoint runs its
//      RandomForest (structural features + TF-IDF content cosine, trained
//      on real co-host accept/decline decisions) over the batch and returns
//      a co-host probability per pair. The final score blends ML (55%) with
//      the heuristic (45%); when the service or model is unavailable the
//      heuristic score stands alone (scoreSource "heuristic").
//
// A natural-language rationale is attached to every suggestion, written by
// the LLM when reachable (8s cap), otherwise assembled from the matched
// factors. Nothing here is blocking or user-facing-critical: every failure
// degrades to the deterministic path and the controller skips pairs it
// already knows about.

import Event from "../models/Event";
import CollaborationSuggestion from "../models/CollaborationSuggestion";
import { haversineKm, hasValidCoords } from "./geo";

// Minimum overall score for a pair to become a suggestion.
export const SUGGESTION_THRESHOLD: number = 60;
// Pairs below this heuristic score are never even offered to the ML model —
// they have nothing in common on the deterministic dimensions, so the batch
// sent to the AI service stays small.
export const ML_PRE_THRESHOLD: number = 40;
// Don't flood the queue: cap new suggestions created per scan.
export const MAX_NEW_SUGGESTIONS_PER_SCAN: number = 20;
// The ML batch is bounded independently — pairs are collected up to twice
// the suggestion cap, so the AI service call stays small even when most
// candidates will fall below the final threshold.
export const MAX_ML_CANDIDATES: number = MAX_NEW_SUGGESTIONS_PER_SCAN * 2;

// --- Text overlap ------------------------------------------------------------

// Word-level tokens from a piece of text; content overlap is computed on
// these so "AI Workshop" and "workshop ai" still match.
export const tokenize = (text: string = ""): Set<string> =>
  new Set(
    String(text)
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w: string) => w.length > 2)
  );

// Jaccard similarity of two token sets, 0..1.
export const jaccard = (a: Set<string>, b: Set<string>): number => {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
};

// All the free-text "content" of an event: title, description, highlights,
// agenda titles/descriptions, speaker names/roles, requirements.
export const eventContentTokens = (event: any): Set<string> => {
  const parts: any[] = [
    event.title,
    event.description,
    ...(event.highlights || []),
    ...(event.agenda || []).flatMap((a: any) => [a.title, a.description]),
    ...(event.speakers || []).flatMap((s: any) => [s.name, s.role]),
    event.requirements,
  ];
  return tokenize(parts.join(" "));
};

// --- Dimension scorers -------------------------------------------------------

// Each dimension returns { score: 0..1, detail: string, weight } so the UI
// can show exactly why the pair matched.

// Every scorer carries a stable machine-readable `factor` key alongside its
// human `detail`. The key is what gets persisted on the suggestion
// (matchedFactors[].factor, which the schema marks required) so the UI can
// group/icon/filter by dimension instead of pattern-matching prose. It was
// previously never set — `evaluatePair` read `d.factor` which no scorer
// returned, so every stored factor had factor: "". That went unnoticed
// because the engine writes via findOneAndUpdate, which skips validators by
// default, so the required-field violation never raised.
export const scoreCategory = (a: any, b: any): { factor: string; score: number; detail: string; weight: number } => ({
  factor: "category",
  score: a.category?.trim().toLowerCase() === b.category?.trim().toLowerCase() ? 1 : 0,
  detail: a.category
    ? `${a.category}${a.category === b.category ? "" : ` vs ${b.category}`}`
    : "",
  weight: 0.18,
});

export const scoreType = (a: any, b: any): { factor: string; score: number; detail: string; weight: number } => ({
  factor: "format",
  score: a.type === b.type ? 1 : 0,
  detail: `${a.type}${a.type === b.type ? "" : ` vs ${b.type}`}`,
  weight: 0.1,
});

// Closer dates = stronger. Linear decay: same day scores 1, 60+ days apart
// scores 0. (The comment here used to claim it halved every 30 days, which
// described neither this formula nor the intended behaviour.)
export const scoreDateProximity = (a: any, b: any): { factor: string; score: number; detail: string; weight: number } => {
  const diff = Math.abs(new Date(a.date).getTime() - new Date(b.date).getTime()) / (1000 * 60 * 60 * 24);
  return {
    factor: "date",
    score: Math.max(0, 1 - diff / 60),
    detail: diff < 1
      ? "Same day"
      : `${Math.round(diff)} day${Math.round(diff) === 1 ? "" : "s"} apart`,
    weight: 0.15,
  };
};

// Same venue → 1; same city → 1; same region (geo within 100 km) → 0.7;
// same country → 0.35.
//
// Venue and city are compared as separate signals. They used to be collapsed
// into `orgA?.city || a.venue`, which compared one org's CITY against the
// other's VENUE whenever either lacked a city — an apples-to-oranges match
// that could only ever produce a false negative, and mislabelled a genuine
// same-venue pair as "Same city: <venue string>".
export const scoreVenueProximity = (a: any, b: any, orgA: any, orgB: any): { factor: string; score: number; detail: string; weight: number } => {
  const base = { factor: "location", weight: 0.18 };
  const venueA = (a.venue || "").toLowerCase().trim();
  const venueB = (b.venue || "").toLowerCase().trim();
  if (venueA && venueA === venueB) {
    return { ...base, score: 1, detail: `Same venue: ${a.venue}` };
  }
  const cityA = (orgA?.city || "").toLowerCase().trim();
  const cityB = (orgB?.city || "").toLowerCase().trim();
  if (cityA && cityB && cityA === cityB) {
    return { ...base, score: 1, detail: `Same city: ${orgA.city}` };
  }
  if (hasValidCoords(a.coordinates) && hasValidCoords(b.coordinates)) {
    const km = haversineKm(a.coordinates, b.coordinates);
    if (km != null && km <= 100) {
      return { ...base, score: 0.7, detail: `${Math.round(km)} km apart` };
    }
  }
  const countryA = (orgA?.country || "").toLowerCase().trim();
  const countryB = (orgB?.country || "").toLowerCase().trim();
  if (countryA && countryB && countryA === countryB) {
    return { ...base, score: 0.35, detail: `Same country: ${orgA.country}` };
  }
  return { ...base, score: 0.1, detail: "Different locations" };
};

// Similar event scale → better co-branding fit. Log-scale ratio so a 500 vs
// 800 attendee pair scores almost as high as an exact match.
export const scoreAudienceSize = (a: any, b: any): { factor: string; score: number; detail: string; weight: number } => {
  const ratio = Math.log2(Math.max(1, a.capacity) / Math.max(1, b.capacity));
  return {
    factor: "audience",
    score: Math.max(0, 1 - Math.abs(ratio) / 3),
    detail: `${a.capacity} vs ${b.capacity} capacity`,
    weight: 0.12,
  };
};

export const scoreContent = (a: any, b: any): { factor: string; score: number; detail: string; weight: number } => {
  const overlap = jaccard(eventContentTokens(a), eventContentTokens(b));
  return {
    factor: "content",
    score: overlap,
    detail: overlap > 0 ? `Content overlap: ${Math.round(overlap * 100)}%` : "Unrelated content",
    weight: 0.17,
  };
};

export const scoreTags = (a: any, b: any): { factor: string; score: number; detail: string; weight: number } => {
  const tagsA = new Set<string>((a.tags || []).map((t: string) => t.toLowerCase()));
  const tagsB = new Set<string>((b.tags || []).map((t: string) => t.toLowerCase()));
  const overlap = jaccard(tagsA, tagsB);
  return {
    factor: "tags",
    score: overlap,
    detail: overlap > 0 ? `${Math.round(overlap * 100)}% tag overlap` : "No shared tags",
    weight: 0.1,
  };
};

// --- Pair evaluation ---------------------------------------------------------

export const evaluatePair = (eventA: any, eventB: any, orgA: any, orgB: any): { score: number; matchedFactors: any[] } => {
  const dimensions: any[] = [
    scoreCategory(eventA, eventB),
    scoreType(eventA, eventB),
    scoreDateProximity(eventA, eventB),
    scoreVenueProximity(eventA, eventB, orgA, orgB),
    scoreAudienceSize(eventA, eventB),
    scoreContent(eventA, eventB),
    scoreTags(eventA, eventB),
  ];
  const totalWeight = dimensions.reduce((sum: number, d: any) => sum + d.weight, 0);
  const score = Math.round(
    (dimensions.reduce((sum: number, d: any) => sum + d.score * d.weight, 0) / totalWeight) * 100
  );
  // Strongest contributor first, so the UI's truncated factor list ("show
  // the top 3") shows the reasons that actually drove the score rather than
  // whichever dimensions happen to be declared first.
  const matchedFactors = dimensions
    .filter((d: any) => d.score > 0.2)
    .sort((x: any, y: any) => y.score * y.weight - x.score * x.weight)
    .map((d: any) => ({
      factor: d.factor,
      detail: d.detail,
      weight: d.weight,
      // Normalised 0-100 contribution of this dimension to the final score,
      // so the UI can show *how much* each reason mattered instead of
      // implying every listed factor weighed the same.
      contribution: Math.round(((d.score * d.weight) / totalWeight) * 100),
    }));
  return { score, matchedFactors };
};

// Build the heuristic rationale from the matched factors (used when the LLM
// is unreachable, or as context for it).
export const heuristicRationale = (eventA: any, eventB: any, orgA: any, orgB: any, matchedFactors: any[]): string => {
  const orgNameA = orgA?.name || "the first organization";
  const orgNameB = orgB?.name || "the second organization";
  const facts = matchedFactors.map((f: any) => f.detail).filter(Boolean).slice(0, 4);
  return `${orgNameA} and ${orgNameB} are running strongly compatible events: ${
    facts.length > 0 ? facts.join("; ").toLowerCase() : "their formats and audiences align"
  }. Co-hosting would merge your promotion, audience lists, and venue logistics while sharing check-in and analytics on both events.`;
};

// LLM-written rationale, best-effort: a slow or missing AI service falls
// back to the template above (never blocks the scan).
export const aiRationale = async (eventA: any, eventB: any, orgA: any, orgB: any, matchedFactors: any[]): Promise<string | null> => {
  const { generate } = await import("./aiClient");
  const facts = matchedFactors.map((f: any) => f.detail).filter(Boolean).join(", ");
  const systemPrompt =
    "You write concise, professional event-planning partnership rationales. " +
    "2-3 sentences max, no markdown, no filler.";
  const userPrompt = [
    `Organization A: ${orgA?.name || "unknown"} — event "${eventA.title}" (${eventA.category}, ${eventA.type}, ${eventA.capacity} capacity, ${eventA.venue}).`,
    `Organization B: ${orgB?.name || "unknown"} — event "${eventB.title}" (${eventB.category}, ${eventB.type}, ${eventB.capacity} capacity, ${eventB.venue}).`,
    `Matched factors: ${facts || "none specific"}.`,
    "Explain why co-hosting these two events is mutually beneficial (audiences, promotion, logistics, operations).",
  ].join("\n");
  const reply: string | null = await Promise.race([
    generate(systemPrompt, userPrompt),
    new Promise<string | null>((resolve) => setTimeout(() => resolve(null), 8000)),
  ]);
  return reply ? reply.trim() : null;
};

// The AI service's pair-feature builder consumes plain event dicts with
// org city/country embedded (features.py build_pair_row). Lean Mongo docs
// are serialized into that shape here — dates become ISO strings via JSON.
export const serializeEventForAI = (event: any, orgDoc: any): any => ({
  title: event.title,
  description: event.description,
  date: event.date,
  venue: event.venue,
  coordinates:
    event.coordinates?.lat != null ? { lat: event.coordinates.lat, lng: event.coordinates.lng } : undefined,
  type: event.type,
  category: event.category,
  capacity: event.capacity,
  registered: event.registered,
  tags: event.tags,
  highlights: event.highlights,
  agenda: event.agenda,
  speakers: event.speakers,
  org: { city: orgDoc?.city, country: orgDoc?.country },
});

// --- Main scan ---------------------------------------------------------------

// Find and store collaboration suggestions between the given organization's
// non-past events and everyone else's non-past events. Skips: same-org
// pairs, already-co-hosting pairs, existing suggestions for the pair, and
// pairs scoring below the threshold. Returns the newly created suggestions
// (populated) plus a summary.
export const scanForSuggestions = async (organizationId: any, { limit = MAX_NEW_SUGGESTIONS_PER_SCAN }: { limit?: number } = {}): Promise<{ created: any[]; skipped: number }> => {
  if (!organizationId) return { created: [], skipped: 0 };

  const org: any = await (require("../models/Organization") as any).findById(organizationId).lean();
  if (!org) return { created: [], skipped: 0 };

  const candidateEvents: any[] = await (Event as any).find({
    organization: organizationId,
    status: { $nin: ["Past", "Draft"] },
  })
    .select("title description date venue coordinates type category capacity status tags highlights agenda speakers requirements coHostOrganizations organization")
    .lean();

  if (candidateEvents.length === 0) return { created: [], skipped: 0 };

  const partnerEvents: any[] = await (Event as any).find({
    organization: { $ne: organizationId },
    status: { $nin: ["Past", "Draft"] },
  })
    .select("title description date venue coordinates type category capacity status tags highlights agenda speakers requirements coHostOrganizations organization")
    .lean();

  // Cache partner orgs so venue/country matching doesn't re-query per pair.
  const orgCache = new Map<string, any>();
  const getOrg = async (id: any): Promise<any> => {
    if (!id) return null;
    if (!orgCache.has(String(id))) {
      orgCache.set(String(id), await (require("../models/Organization") as any).findById(id).lean());
    }
    return orgCache.get(String(id));
  };

  // Pairs we've already suggested (any outcome) — don't re-offer them.
  const ids = candidateEvents.map((e: any) => e._id);
  const partnerIds = partnerEvents.map((e: any) => e._id);
  const existing: any[] = await (CollaborationSuggestion as any).find({
    $or: [{ eventA: { $in: ids }, eventB: { $in: partnerIds } }, { eventA: { $in: partnerIds }, eventB: { $in: ids } }],
  })
    .select("eventA eventB")
    .lean();
  const seenPair = new Set(existing.map((s: any) => [String(s.eventA), String(s.eventB)].sort().join("|")));

  const created: any[] = [];
  let skipped = 0;
  // Candidates that passed the deterministic pre-filter, batched for one
  // AI-service call (its collaboration-match model refines their scores).
  const mlCandidates: any[] = [];

  for (const myEvent of candidateEvents) {
    if (created.length + mlCandidates.length >= MAX_ML_CANDIDATES) break;
    for (const other of partnerEvents) {
      if (created.length + mlCandidates.length >= MAX_ML_CANDIDATES) break;
      const pairKey = [String(myEvent._id), String(other._id)].sort().join("|");
      if (seenPair.has(pairKey)) {
        skipped += 1;
        continue;
      }
      // Already co-hosting on either event → nothing to suggest.
      const otherOrgOnMine = (myEvent.coHostOrganizations || []).some(
        (id: any) => String(id) === String(other.organization)
      );
      const myOrgOnTheirs = (other.coHostOrganizations || []).some(
        (id: any) => String(id) === String(myEvent.organization)
      );
      if (otherOrgOnMine || myOrgOnTheirs) {
        skipped += 1;
        continue;
      }

      const otherOrg: any = await getOrg(other.organization);
      const { score, matchedFactors } = evaluatePair(myEvent, other, org, otherOrg);
      if (score < ML_PRE_THRESHOLD) {
        skipped += 1;
        continue;
      }

      mlCandidates.push({
        id: pairKey,
        event_a: serializeEventForAI(myEvent, org),
        event_b: serializeEventForAI(other, otherOrg),
        heuristic: score,
        matchedFactors,
        pair: { myEvent, other, org, otherOrg },
      });
    }
  }

  // One batch call to the advanced AI service: its collaboration-match model
  // (RandomForest over structural features + TF-IDF content similarity,
  // trained on real accept/decline co-hosting decisions) returns a co-host
  // probability per pair. Best-effort — an unreachable service or missing
  // model leaves mlScores empty and the heuristic score stands.
  const { collaborationMatch } = await import("./aiClient");
  const matches: any[] = (await collaborationMatch(
    mlCandidates.map((c: any) => ({ id: c.id, event_a: c.event_a, event_b: c.event_b }))
  )) || [];
  const mlScores = new Map(matches.map((m: any) => [String(m.id), m]));

  for (const c of mlCandidates) {
    if (created.length >= limit) break;

    const ml: any = mlScores.get(c.id);
    const scoreSource: string = ml?.score != null ? "ml" : "heuristic";
    // Blend the learned model with the deterministic scorer: the ML
    // probability (0..1) drives most of the final score, the heuristic
    // keeps it anchored to the visible matched factors the UI displays.
    const score: number = ml?.score != null
      ? Math.round(0.55 * ml.score * 100 + 0.45 * c.heuristic)
      : c.heuristic;
    if (score < SUGGESTION_THRESHOLD) {
      skipped += 1;
      continue;
    }

    const { myEvent, other, org: myOrg, otherOrg } = c.pair;
    const aiText: string | null = await aiRationale(myEvent, other, myOrg, otherOrg, c.matchedFactors);
    const rationale: string = aiText || heuristicRationale(myEvent, other, myOrg, otherOrg, c.matchedFactors);

    try {
      const suggestion: any = await (CollaborationSuggestion as any).findOneAndUpdate(
        { eventA: { $in: [myEvent._id, other._id] }, eventB: { $in: [myEvent._id, other._id] } },
        {
          $setOnInsert: {
            eventA: myEvent._id,
            eventB: other._id,
            orgA: myEvent.organization,
            orgB: other.organization,
            score,
            scoreSource,
            matchedFactors: c.matchedFactors,
            rationale,
            rationaleSource: aiText ? "ai" : "heuristic",
          },
        },
        { upsert: true, new: true }
      );
      if (String(suggestion.orgA) === String(myEvent.organization)) {
        created.push(suggestion._id);
      }
    } catch (error: any) {
      // Unique-index race between parallel scans — the pair is either
      // already suggested or created by the other scan; skip quietly.
      skipped += 1;
    }
  }

  const suggestions: any[] = await (CollaborationSuggestion as any).find({ _id: { $in: created } })
    .populate("eventA", "title date venue category type status capacity organization")
    .populate("eventB", "title date venue category type status capacity organization")
    .populate("orgA", "name city country status")
    .populate("orgB", "name city country status")
    .lean();

  return { created: suggestions, skipped };
};

export default {
  scanForSuggestions,
  evaluatePair,
  SUGGESTION_THRESHOLD,
  MAX_NEW_SUGGESTIONS_PER_SCAN,
};
