const Event = require("../models/Event");
const Ticket = require("../models/Ticket");
const { haversineKm, hasValidCoords } = require("../utils/geo");
const predictAttendance = require("../utils/predictAttendance");
const { scoreEvents } = require("../utils/recommendationEngine");
const ai = require("../utils/aiClient");

const INTENTS = [
  "recommend",
  "near_me",
  "my_tickets",
  "pricing",
  "organizer",
  "upcoming_events",
  "venue",
  "schedule",
  "registration_status",
  "popular_events",
  "capacity",
  "cancellation",
  "greeting",
  "categories",
  "event_count",
  "create_event",
  "join_event",
  "fallback",
];

// Event detail pages live at /event/:id (public) — the landing spot that
// works for every role, signed in or not. Grounded replies link real events
// so the attendee can jump straight to the page instead of copying the name.
const eventLink = (event) => `[${event.title}](/event/${event._id})`;

const matchIntent = (message) => {
  const m = message.toLowerCase().trim();
  // Join / register intent must be checked very early: "join this event",
  // "register me for Tech Conference", "sign me up" — attendee's primary
  // action. Must not be swallowed by upcoming_events or capacity regexes.
  if (/\b(join|register|sign\s*up|enroll|attend|book)(\s+(me|for|this|the|an))?.{0,20}\bevents?\b/i.test(m) ||
      /\bjoin\b/i.test(m) && /\bevent\b/i.test(m)) {
    return "join_event";
  }
  // Creation must be checked early: "new event", "host an event", "plan a
  // session" all collide with upcoming_events/categories regexes below, and
  // the action (open the guided creation flow) is very different from a
  // browse query.
  if (
    /(\bcreate\b|\bhost\b|\bplan\b|\borganiz\w*|\bmake\b|\bset up\b|\bschedule\b|\bnew\b|\badd\b|\bpublish\b|\bannounce\b|\blatt\b).{0,25}\bevents?\b/i.test(m) &&
    !/\b(what|list|show|any|find|how many|tell|recommend|suggest|trending|popular|top)\b/.test(m)
  ) {
    return "create_event";
  }
  if (/(\brecommend\b|\bsuggest\b|what should i (attend|go to)|what.*should.*attend|pick.*for me|top picks|best.*for me|recommendations)/.test(m)) return "recommend";
  if (/\b(near me|nearby|close to me|around me|closest|near by)\b/.test(m)) return "near_me";
  if (/\b(my ticket|my tickets|my registration|my registrations|my bookings|my booking|how many tickets|how many registrations)\b/.test(m)) return "my_tickets";
  // Checked before "capacity" (which also matches "available") and before
  // "upcoming_events" so "any free events?" doesn't get swallowed by the
  // more generic "what events are there" match.
  // Tightened: "how much" alone is too generic — require price/cost context
  if (/(\bfree\b|no cost|complimentary|\bticket price\b|is it free|paid event)/.test(m) || /\b(how much|what.*cost|what.*price).{0,12}\b(price|cost|ticket|pay|free|paid)\b/.test(m) || /\b(price|cost)\b/.test(m) && /\bevents?\b/.test(m)) return "pricing";
  if (/(who\b.{0,15}\b(organiz|host|run)|organizer of|host of|hosted by)/.test(m)) return "organizer";
  // Counting questions ("how many events are there total?") must not fall
  // through to the generic upcoming-events list — checked before
  // upcoming_events so "how many events are coming up?" also lands here.
  if (/(\bhow many\b|\btotal\b|\bcount\b|number of).{0,25}\bevents?\b/.test(m) && !/\bvenues?\b|\btickets?\b|\busers?\b|\bspeakers?\b|\bcategories?\b/.test(m)) return "event_count";
  if (
    /(this week|\bupcoming\b|latest event|latest events|\bnew event\b|\bnew events\b|any event|any events|list events|what.*events|find events|show events|events happening|what's on|whats on|any updates)/.test(m)
  )
    return "upcoming_events";
  // Cancellation must be before schedule/capacity/venue — "when can I cancel?" etc
  if (/\b(cancel|refund|unregister)\b/.test(m)) return "cancellation";
  // Venue: require event context, not bare "where is my ticket"
  if (/\bvenue\b|\baddress\b|held at|taking place/.test(m) || (/\bwhere is\b/.test(m) && /\bevents?\b/.test(m)) || (/\blocation\b/.test(m) && /\bevents?\b/.test(m))) return "venue";
  // Schedule: require event context, not bare time/date
  if (/\bschedule\b/.test(m) && /\bevents?\b/.test(m) || /when is.*\bevents?\b/.test(m) || /\b(starts? at|start time)\b/.test(m) && /\bevents?\b/.test(m) || /\bevent\b.{0,12}\b(date|time|when)\b/.test(m)) return "schedule";
  if (/(registration status|am i registered|did i register|my status)/.test(m)) return "registration_status";
  if (/(\bpopular\b|\btrending\b|\bbest\b|\btop\b|\bhot\b|highest)/.test(m) && /\bevents?\b/.test(m)) return "popular_events";
  if (/\bcapacity\b|spots left|how many seats|how many people|sold out/.test(m) || (/\b(full|available)\b/.test(m) && /\b(spots?|seats?|capacity|tickets?)\b/.test(m))) return "capacity";
  // Word-boundaried so "hi" doesn't match inside unrelated words like
  // "this", "which", or "anything" and hijack their real intent.
  if (/\b(hi|hello|hey|howdy|yo|help|what can you do|what do you do)\b/.test(m)) return "greeting";
  if (/(\bcategory\b|\bcategories\b|\btype\b|\bkind\b|\bsort\b|\bfilter\b)/.test(m)) return "categories";
  return "fallback";
};

// PRIMARY understanding step: one LLM call (ai-service's /understand, Gemini
// primary/Groq fallback) reads the message + conversation history and
// returns intent AND every slot (quantity/time-scope/price/count) together.
// This replaced an earlier design that tried to catch each new phrasing
// ("one event" vs "latest event" vs a bare follow-up like "just 1") with
// more regex — a game that's never actually won, since there's always
// another way to phrase a request. Real language understanding is what an
// LLM is for; regex/ML (matchIntent + the local wants*/price* functions
// below) are kept ONLY as the offline fallback for when the AI service
// itself is unreachable, same "augments, never blocks" pattern as every
// other AI integration in this app — never as the primary path anymore.
const isShortFollowUp = (msg) => {
  const m = msg.trim().toLowerCase();
  if (!m) return false;
  // Bare quantifier / ordinal follow-ups after a list, e.g. "just 1", "one", "first", "2"
  if (/^\s*(just\s+)?(one|1|single|first|1st|second|2nd|third|3rd|that one|this one|it)\s*\.?\s*$/i.test(msg)) return true;
  if (/^\s*\d{1,2}\s*$/.test(m) && parseInt(m, 10) >= 1 && parseInt(m, 10) <= 20) return true;
  // Short price follow-up like "how about paid ones" or "free ones"
  if (m.split(/\s+/).length <= 5 && /\b(paid|free)\b/.test(m) && /\b(ones?|events?)\b/.test(m)) return true;
  return false;
};

const understandMessage = async (message, history) => {
  const understood = await ai.understand(message, history);
  if (understood?.intent && INTENTS.includes(understood.intent)) {
    return { intent: understood.intent, slots: understood.slots, source: understood.source };
  }
  // AI service unreachable (or returned something unusable) — local rules.
  // History-aware fallback: short follow-ups like "just 1" or "that one"
  // inherit the previous intent/slots instead of falling through to "fallback"
  // and losing quantity/price/time context.
  let intent = matchIntent(message);
  let slots = {
    quantity: wantsSingle(message) ? "one" : null,
    time_scope: wantsPast(message) ? "past" : null,
    price_pref: pricePreference(message),
    count: extractCount(message),
  };
  if (Array.isArray(history) && history.length) {
    const lastUser = [...history].reverse().find((h) => h.role === "user" && typeof h.content === "string");
    const lastAssistant = [...history].reverse().find((h) => h.role === "assistant" && typeof h.content === "string");
    const histText = `${lastUser?.content || ""} ${lastAssistant?.content || ""}`.toLowerCase();
    const hasPriorEventListing = /there are|coming up|events\?|predicted|registered|\| event \|/i.test(lastAssistant?.content || "");
    if (isShortFollowUp(message) && lastUser) {
      const prevIntent = matchIntent(lastUser.content);
      if (prevIntent !== "fallback" && intent === "fallback") intent = prevIntent;
      // Inherit quantity: bare "just 1" / "first" => one
      if (!slots.quantity && /^\s*(just\s+)?(one|1|single)\b|\bfirst\b|\b1st\b|\bthat one\b|\bthis one\b|\bit\b/i.test(message) && hasPriorEventListing) {
        slots.quantity = "one";
      }
      // Inherit numeric count: bare number "2" after list will be handled by ordinal resolver, not needed here
      // Inherit time_scope from previous user query if current has none and history had past
      if (!slots.time_scope && wantsPast(lastUser.content) && hasPriorEventListing) {
        slots.time_scope = "past";
      }
      // Inherit price pref if previous query had it and current is bare quantifier (e.g. "just 1" after "any free events?")
      if (!slots.price_pref && hasPriorEventListing) {
        const prevPrice = pricePreference(lastUser.content);
        if (prevPrice) slots.price_pref = prevPrice;
      }
    }
  }
  return { intent, slots, source: "rules" };
};

// Absolute last resort when neither the regex cascade nor LLM intent
// classification finds a match: a grounded free-form answer, strictly
// limited to the real upcoming-event data injected below, so the model has
// no room to invent event names, dates, or prices.
const answerFreeform = async (req, message, history) => {
  const isolatedFilter = getIsolatedActiveFilter(req, new Date());
  const events = await Event.find(isolatedFilter)
    .sort({ date: 1 })
    .limit(10)
    .lean();

  const context = events.length
    ? events
        .map(
          (e) =>
            `- "${e.title}" (${e.category}, ${e.type}) on ${new Date(e.date).toDateString()} at ${e.venue}, price: ${formatEventPrice(e.price)}, ${e.registered}/${e.capacity} registered — event page: /event/${e._id}`
        )
        .join("\n")
    : "No upcoming events right now.";

  const systemPrompt =
    "You are EventBot, a precise AI assistant for EventNexus. Your answers MUST be grounded ONLY in the DB data below — never invent, hallucinate, or rephrase facts. " +
    "Rules:\n" +
    "1. Use ONLY the events listed under 'Upcoming events' — never invent names, dates, prices, venues, or counts. If the list is empty, say 'No upcoming events right now.'\n" +
    "2. When you mention an event, include its markdown link EXACTLY as shown (e.g. [Title](/event/ID)). Do not alter titles or IDs.\n" +
    "3. Be precise with numbers: use exact prices (format: Free or Rs. X), dates as given, registered/capacity as listed. Never round or estimate.\n" +
    "4. For 2+ events, present as a markdown GFM table: | Event | Date | Venue | Price | Fill | with header separator. For a single event, use a concise card: **Title link**, date, venue, category, price, capacity. Never use plain comma lists for events.\n" +
    "5. Be concise (1-3 sentences plus table when listing), friendly, and deterministic — same question with same DB data must produce same answer.\n" +
    "6. If asked whether you're AI: yes, say so plainly — you're an AI assistant.\n" +
    "7. If asked to DO an action you can't do (edit/delete event, change account, refunds): say so honestly and point to the correct place (Organizer dashboard, My Tickets, etc.). You can only look things up.\n" +
    "8. If you cannot answer from the data, say you're not sure and suggest what you can help with (recommend, upcoming, tickets, pricing, capacity, venue, schedule).\n\nUpcoming events (ground truth, use only these):\n" +
    context;

  return ai.generate(systemPrompt, message, history);
};

// NPR is the app's default currency (see models/Event.js); mirrors
// frontend/lib/price.ts's formatting since the backend can't import it.
const formatEventPrice = (price) => {
  if (!price || !price.amount) return "Free";
  const currency = (price.currency || "NPR").toUpperCase();
  if (currency === "NPR") return `Rs. ${price.amount.toLocaleString("en-US")}`;
  return `${currency} ${price.amount}`;
};

// Resolves the event a free-text message is actually about (e.g. "how many
// spots left for Tech Conference?") when the caller didn't supply an
// eventId from page context. Deterministic word-overlap scoring — never an
// LLM guess — and deliberately returns null instead of picking when two
// events match about equally well, so the bot asks for clarification rather
// than confidently answering about the wrong event. Tenant-scoped: never
// returns Draft or other-org events. Includes co-hosted events for tenant.
const resolveEventFromMessage = async (message, req) => {
  const hasTenantOrg = !!req.user?.organization && !(req.user.role === "admin" && !req.user.organization);
  const filter = hasTenantOrg
    ? { $or: [{ organization: req.user.organization }, { coHostOrganizations: req.user.organization }] }
    : { status: { $ne: "Draft" } };
  const events = await Event.find(filter).select("_id title organization status coHostOrganizations").limit(120).lean();
  if (!events.length) return null;

  const m = message.toLowerCase();
  const scored = events
    .map((e) => {
      const title = e.title.toLowerCase();
      if (m.includes(title)) return { event: e, score: 1 };
      const words = title.split(/\s+/).filter((w) => w.length > 2);
      if (!words.length) return { event: e, score: 0 };
      const matched = words.filter((w) => m.includes(w)).length;
      return { event: e, score: matched / words.length };
    })
    .filter((s) => s.score >= 0.6)
    .sort((a, b) => b.score - a.score);

  if (!scored.length) return null;
  if (scored.length > 1 && scored[0].score - scored[1].score < 0.2) return null; // ambiguous — don't guess
  return scored[0].event;
};

// Shared by every intent that needs a specific event: prefer the page-context
// eventId, fall back to resolving one from the message text, and never
// silently guess — callers get null and ask the user to clarify. Enforces
// tenant isolation on eventId path (IDOR guard).
const resolveEvent = async (eventId, message, req) => {
  if (eventId) {
    const tenantScope = getTenantScope(req);
    // For tenant users, require same org or co-host; for public, block Draft
    if (tenantScope.organization) {
      const doc = await Event.findById(eventId).lean();
      if (!doc) return null;
      const orgId = String(req.user.organization);
      const docOrg = String(doc.organization || "");
      const isCoHost = Array.isArray(doc.coHostOrganizations) && doc.coHostOrganizations.some((o) => String(o) === orgId);
      if (docOrg !== orgId && !isCoHost) return null;
      if (doc.status === "Draft" && docOrg !== orgId && !isCoHost) return null;
    } else if (tenantScope.status && tenantScope.status.$ne === "Draft") {
      const doc = await Event.findById(eventId).lean();
      if (doc && doc.status === "Draft") return null;
    }
    return Event.findById(eventId).populate("organizer", "name").lean();
  }
  // Handle ordinal / pronoun follow-ups like "that one", "first", "2" by mapping to recent candidates
  if (ORDINAL_RE.test(message.trim()) && message.trim().split(/\s+/).length <= 5) {
    const candidates = await getCandidateEvents(req, 5);
    const ordinalMatch = resolveOrdinal(message, candidates);
    if (ordinalMatch) return Event.findById(ordinalMatch._id).populate("organizer", "name").lean();
  }
  const fromText = await resolveEventFromMessage(message, req);
  return fromText ? Event.findById(fromText._id).populate("organizer", "name").lean() : null;
};

const NEED_EVENT_HINT =
  'Which event do you mean? Try naming it — e.g. "how many spots left for Tech Conference?" — or open the event page first.';

const getCandidateEvents = async (req, limit = 3) => {
  try {
    const filter = getIsolatedActiveFilter(req, new Date());
    const events = await Event.find(filter).select("_id title date").sort({ date: 1 }).limit(limit).lean();
    return events;
  } catch {
    return [];
  }
};
const formatCandidateHint = async (req, baseHint = NEED_EVENT_HINT) => {
  const candidates = await getCandidateEvents(req, 3);
  if (!candidates.length) return baseHint;
  const list = candidates.map((e, i) => `${i + 1}. [${e.title}](/event/${e._id})`).join("  ");
  return `${baseHint}\n\nDid you mean: ${list}\nReply with the name or number.`;
};
// Ordinal / pronoun handling: "that one", "first", "second", "it"
const ORDINAL_RE = /\b(first|1st|second|2nd|third|3rd|last|that one|this one|it)\b/i;
const resolveOrdinal = (message, candidates) => {
  const m = message.toLowerCase().trim();
  if (!candidates || !candidates.length) return null;
  if (/\bfirst\b|\b1st\b/.test(m) || /^that one$/i.test(m) || /\bthis one\b/.test(m)) return candidates[0];
  if (/\bsecond\b|\b2nd\b/.test(m)) return candidates[1] || null;
  if (/\bthird\b|\b3rd\b/.test(m)) return candidates[2] || null;
  if (/\blast\b/.test(m)) return candidates[candidates.length - 1];
  if (/^\s*it\s*\??\s*$/i.test(m) || /\bit\b/.test(m) && m.split(/\s+/).length <= 4) return candidates[0];
  // numeric reply "2" after a list
  const num = /^\s*(\d)\s*$/.exec(m);
  if (num) {
    const idx = parseInt(num[1], 10) - 1;
    if (idx >= 0 && idx < candidates.length) return candidates[idx];
  }
  return null;
};

const shortDate = (d) =>
  new Date(d).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

const distanceLabel = (km) =>
  km < 1 ? `${Math.round(km * 1000)}m` : `${km.toFixed(1)} km`;

// Events the user can still act on. Live events are kept even when their
// stored date has passed midnight (a festival seeded "today" is still very
// much happening) — a plain `date >= now` filter would silently drop them
// and produce wrong answers ("any free events?" omitting the live paid one).
const activeFilter = (tenantScope, now) => ({
  ...tenantScope,
  status: { $in: ["Upcoming", "Live"] },
  $or: [{ status: "Live" }, { date: { $gte: now } }],
});

// --- Local slot-extraction fallbacks ---
// These mirror ai-service/nlu.py's extract_price_preference /
// extract_time_scope / extract_quantity exactly. The Python service is now
// the canonical NLU layer for this (a single `/parse` call there returns
// intent + all three slots together — see ai.parse() in utils/aiClient.js),
// but the app must keep working with zero functionality loss when that
// service is down/unreachable/untrained, matching every other AI
// integration in this codebase (aiClient.js's own header comment: "the AI
// service augments accuracy, it never blocks the app"). query() below only
// calls these when ai.parse() returned null.

// "free" / "paid" mention in the ask → filter the reply to that price
// class ("anything free nearby?" must not list paid events). Handles negation
// ("not free", "don't show paid") and mutual exclusion.
const pricePreference = (message) => {
  const m = message.toLowerCase();
  const hasFree = /\bfree\b|no cost|complimentary|\bfreebies\b/.test(m);
  const hasPaid = /\bpaid\b|\bpay\b|\bcosts?\b|\bprice\b/.test(m);
  const hasNegFree = /\b(not|no|don't|dont|without|except|exclude|only)\b[^.]{0,12}\bfree\b/i.test(m) || /\bfree\b[^.]{0,12}\b(not|no)\b/i.test(m);
  const hasNegPaid = /\b(not|no|don't|dont|without|except|exclude|only)\b[^.]{0,12}\bpaid\b/i.test(m);
  if (hasFree && hasPaid) {
    if (hasNegFree && !hasNegPaid) return "paid";
    if (hasNegPaid && !hasNegFree) return "free";
    // "free or paid" ambiguous — return null to trigger clarifying question
    if (/\b(free or paid|paid or free|free and paid)\b/.test(m)) return null;
    // Prefer the one without negation
    if (hasNegFree) return "paid";
    if (hasNegPaid) return "free";
    return null;
  }
  if (hasFree && hasNegFree) return null; // "not free" without paid alternative → ask clarification
  if (hasFree) return "free";
  if (hasPaid && !hasNegPaid) return "paid";
  if (hasPaid && hasNegPaid) return null;
  return null;
};

// "past free events", "how many events have finished" — without this, any
// question about history silently got answered against the Upcoming/Live
// window instead (activeFilter), which reads as "none exist" even when
// plenty of past events do.
const wantsPast = (message) =>
  /\b(past|done|finished|ended|previous|concluded|already happened|has happened|have happened)\b/i.test(message);

// "tell me about one upcoming event" was landing in upcoming_events and
// dumping the full 8-row table anyway — nothing distinguished "one" from
// "all of them". A quantifier has to sit adjacent to "event" to count (so
// "what events are coming up" doesn't trip it), but adjacency is loose —
// "tell me about one 1 upcoming event" has a stray "1" between the
// quantifier and "event" that a strict `quantifier + event` regex misses
// entirely, so this checks for a singular quantifier ANYWHERE in the
// message plus a genuinely singular "event" mention (never "events"),
// rather than requiring the two to be next to each other.
const SINGLE_QUANTIFIER_RE = /\b(one|1|single|only one|just one|latest|next|nearest|newest|soonest)\b/i;
const wantsSingle = (message) => {
  const hasSingularEvent = /\bevent\b(?!s)/i.test(message);
  if (!hasSingularEvent) return false;
  const hasPluralEvents = /\bevents\b/i.test(message);
  if (hasPluralEvents && !SINGLE_QUANTIFIER_RE.test(message)) return false;
  return SINGLE_QUANTIFIER_RE.test(message);
};

// Mirrors ai-service/nlu.py's extract_count — now requires explicit events context
// to avoid picking street numbers, years, or prices (e.g. "42 Main St" → not a count).
const COUNT_RE = /\b(\d{1,2})\b\s*(events?|tickets?|results?)?\b/i;
const COUNT_CONTEXT_RE = /\b(top|show|list|give\s+me|only|just)\s+(\d{1,2})\b/i;
const extractCount = (message) => {
  const m = message.toLowerCase();
  // Prefer explicit "... 5 events" or "top 5"
  let match = /\b(\d{1,2})\s+events?\b/i.exec(message);
  if (match) {
    const n = parseInt(match[1], 10);
    if (n >= 1 && n <= 50) return n;
  }
  match = COUNT_CONTEXT_RE.exec(message);
  if (match) {
    const n = parseInt(match[2], 10);
    if (n >= 1 && n <= 50) return n;
  }
  // Fallback: bare number only if message is short and clearly a count request
  if (/^(show|list|give|top)\s+\d{1,2}$/i.test(m.trim())) {
    const mm = /\b(\d{1,2})\b/.exec(m);
    if (mm) {
      const n = parseInt(mm[1], 10);
      if (n >= 1 && n <= 50) return n;
    }
  }
  return null;
};

// TENANT ISOLATION: crucial chatbot data is isolated per organization.
// Public Discover browsing (eventController.getAllEvents) is global, but the
// chatbot deals with *crucial* data — capacity, pricing, venue coords,
// organizer contacts, attendance forecasts, ticket counts — which must never
// leak across tenants.  We therefore scope every chatbot Event query to the
// caller's own organization.  Users without an organization (or system admin)
// fall back to the public non-draft universe, which is the only safe cross-
// tenant view. Co-hosted events are included via an explicit $or handled in
// activeFilter.
const getTenantScope = (req) => {
  const orgId = req.user?.organization;
  if (!req.user) return { status: { $ne: "Draft" } };
  if (req.user.role === "admin" && !orgId) return {};
  if (!orgId) return { status: { $ne: "Draft" } };
  // Strict isolation: own organization only (co-host inclusion handled separately where needed)
  return { organization: orgId };
};
// Helper that builds an *isolated* active filter (Upcoming/Live) without leaking cross-tenant $or
const getIsolatedActiveFilter = (req, now) => {
  const tenant = getTenantScope(req);
  const hasTenantOrg = !!req.user?.organization && !(req.user.role === "admin" && !req.user.organization);
  if (hasTenantOrg) {
    // Tenant has org: $and tenant + active status + date rule, plus co-host $or is handled as extra branch
    return {
      $and: [
        { $or: [{ organization: req.user.organization }, { coHostOrganizations: req.user.organization }] },
        { status: { $in: ["Upcoming", "Live"] } },
        { $or: [{ status: "Live" }, { date: { $gte: now } }] },
      ],
    };
  }
  return activeFilter(tenant, now);
};
// Generic tenant-isolated filter (includes co-host) for non-active queries (Past, categories, counts)
const getTenantIsolatedFilter = (req, extra = {}) => {
  const hasTenantOrg = !!req.user?.organization && !(req.user.role === "admin" && !req.user.organization);
  if (hasTenantOrg) {
    return {
      $and: [
        { $or: [{ organization: req.user.organization }, { coHostOrganizations: req.user.organization }] },
        extra,
      ],
    };
  }
  return { ...getTenantScope(req), ...extra };
};

const buildGroundedReply = async (req, intent, eventId, message, slots) => {
  const now = new Date();

  if (intent === "greeting") {
    return "Hi! I'm EventBot 👋 — I can recommend events for you, find free vs. paid events, check capacity, venues, schedules, your tickets, or what's trending. Tap a suggestion below or ask me anything!";
  }

  if (intent === "create_event") {
    const isOrganizer =
      req.user && ["organizer", "admin", "org_admin"].includes(req.user.role);
    if (!isOrganizer) {
      return "Only organizers can create events on EventNexus 🎟️ — if you're an organizer, sign in with your organizer account and ask me again. Attendees can register for any event from its detail page.";
    }
    return (
      "I can't create events inside the chat anymore, but it takes under a minute yourself ✨ — open **My Events**, tap **New Event**, and the guided wizard walks you through title, schedule, venue, capacity, pricing and publishing. " +
      "Come back any time to ask me about events, pricing, capacity or what's trending."
    );
  }

  if (intent === "recommend") {
    const { hasLocation, recommendations } = await scoreEvents({
      attendee: req.user._id,
      organization: req.user.organization,
      location: req.user.location,
      userInterests: req.user.interests || [],
      limit: 5,
      withReasons: true,
    });
    if (!recommendations.length) {
      return "I don't have enough signal yet to recommend events 🎯 — register for an event or two and I'll learn your interests. Meanwhile, try: _What events are coming up?_";
    }
    let reply = "🎯 Here are my top picks for you:\n\n| # | Event | Why | When |";
    reply += "\n|---|-------|-----|------|";
    recommendations.forEach(({ event, distanceKm, reason }, i) => {
      reply += `\n| ${i + 1} | ${eventLink(event)} | ${reason}${distanceKm != null ? ` · ${distanceLabel(distanceKm)} away` : ""} | ${shortDate(event.date)} |`;
    });
    reply += `\n\n_Ranked from real registration data${hasLocation ? " and your location" : ""} — open any link to see details._`;
    return reply;
  }

  if (intent === "my_tickets") {
    const tickets = await Ticket.find({ attendee: req.user._id })
      .populate("event", "title date venue type category price")
      .sort({ createdAt: -1 })
      .limit(10).lean();

    if (!tickets.length) {
      return "You don't have any tickets yet 🎫 — browse the Discover page to find and register for events!";
    }

    const upcoming = tickets.filter((t) => t.event && new Date(t.event.date) > now);

    let reply = `You have ${tickets.length} ticket${tickets.length === 1 ? "" : "s"}:\n\n| Event | Date | Status |`;
    reply += "\n|-------|------|--------|";
    tickets.forEach((t) => {
      const e = t.event;
      const statusEmoji = t.status === "checked-in" ? "✅ Checked in" : t.status === "cancelled" ? "❌ Cancelled" : "🎫 Valid";
      const dateStr = e ? shortDate(e.date) : "—";
      reply += `\n| ${e ? eventLink(e) : "Unknown event"} | ${dateStr} | ${statusEmoji} |`;
    });

    if (upcoming.length > 0) {
      reply += `\n\nYou have **${upcoming.length} upcoming** event${upcoming.length === 1 ? "" : "s"} to attend.`;
    }
    return reply;
  }

  if (intent === "near_me") {
    if (!hasValidCoords(req.user.location)) {
      return "I don't have your location yet 📍 — go to Settings to enable location sharing, then I can find events closest to you!";
    }
    const pref = slots.price_pref;
    const events = await Event.find(getIsolatedActiveFilter(req, now)).select("title venue date category type price registered capacity coordinates organizer").populate("organizer", "name").lean();

    const nearby = events
      .map((e) => ({
        title: e.title,
        venue: e.venue,
        km: haversineKm(req.user.location, e.coordinates),
        date: e.date,
        category: e.category,
        price: e.price?.amount ?? 0,
        id: e._id,
      }))
      .filter((e) => e.km != null)
      .filter((e) => (pref === "free" ? e.price === 0 : pref === "paid" ? e.price > 0 : true))
      .sort((a, b) => a.km - b.km)
      .slice(0, 5);

    if (!nearby.length) {
      const hint = pref === "free" ? "free " : pref === "paid" ? "paid " : "";
      return `I couldn't find any ${hint}events with location data near you. Try checking back later or browse all events on the Discover page.`;
    }

    const heading = pref === "free" ? "📍 Free events sorted by distance from you:" : "📍 Events sorted by distance from you:";
    let reply = `${heading}\n\n`;
    nearby.forEach((e) => {
      reply += `• **${e.title}** at ${e.venue} — ${distanceLabel(e.km)} (${e.category}) — [view](/event/${e.id})\n`;
    });
    const closest = nearby[0];
    reply += `\nThe closest is **${closest.title}** just ${distanceLabel(closest.km)} away!`;
    return reply;
  }

  if (intent === "upcoming_events") {
    const pref = slots.price_pref;
    const single = slots.quantity === "one";
    const past = slots.time_scope === "past";
    // An explicit "10 events" overrides the default page size; single-event
    // requests ignore it (asking for "one" already answered the question).
    const limit = single ? 1 : Math.min(Math.max(slots.count || 8, 1), 20);
    const baseScope = past ? getTenantIsolatedFilter(req, { status: "Past" }) : getIsolatedActiveFilter(req, now);
    // Precision fix: price preference must be applied BEFORE limit at DB level.
    // Previously we fetched `limit` upcoming events then JS-filtered by price,
    // so "any free events?" could return 0 rows when the first 8 upcoming
    // events happened to be paid but free events existed further out — a
    // hallucination-by-omission that looks like missing DB data. Now the
    // filter is part of the query, so counts and tables are exact.
    let scope = baseScope;
    if (pref === "free") {
      scope = { $and: [baseScope, { $or: [{ "price.amount": 0 }, { "price.amount": { $exists: false } }, { price: { $exists: false } }] }] };
    } else if (pref === "paid") {
      scope = { $and: [baseScope, { "price.amount": { $gt: 0 } }] };
    }

    const events = await Event.find(scope)
      .sort({ date: past ? -1 : 1 })
      .limit(limit)
      .populate("organizer", "name")
      .lean();

    // Events are already price-filtered at DB level; keepJS filter as safety net only
    const filtered = events;

    if (!filtered.length) {
      const hint = pref === "free" ? "free " : pref === "paid" ? "paid " : "";
      return past
        ? `No ${hint}past events found.`
        : `No ${hint}upcoming events found for your organization right now. Check back soon for new events!`;
    }

    if (single) {
      const e = filtered[0];
      const pct = Math.round((e.registered / e.capacity) * 100);
      const desc = e.description ? `${e.description.slice(0, 220)}${e.description.length > 220 ? "…" : ""}\n\n` : "";
      return (
        `📅 Here's one ${past ? "past" : "upcoming"} event:\n\n**${eventLink(e)}**\n${desc}` +
        `🗓️ ${shortDate(e.date)} · 📍 ${e.venue} · 🏷️ ${e.category}\n` +
        `💰 ${formatEventPrice(e.price)} · 👥 ${e.registered}/${e.capacity} registered (${pct}% full)`
      );
    }

    const noun = pref === "free" ? "free event" : pref === "paid" ? "paid event" : "event";
    const plural = filtered.length === 1 ? "is 1 " + noun : `are ${filtered.length} ${noun}s`;
    let reply = `📅 There ${plural} ${past ? "in the past" : "coming up"}:\n\n| Event | Date | Venue | Price | Fill |`;
    reply += "\n|-------|------|-------|-------|------|";
    filtered.forEach((e) => {
      const pct = Math.round((e.registered / e.capacity) * 100);
      reply += `\n| ${eventLink(e)} | ${shortDate(e.date)} | ${e.venue} | ${formatEventPrice(e.price)} | ${pct}% |`;
    });
    return reply;
  }

  if (intent === "event_count") {
    const [total, upcoming, past] = await Promise.all([
      Event.countDocuments(getTenantIsolatedFilter(req, {})),
      Event.countDocuments(getIsolatedActiveFilter(req, now)),
      Event.countDocuments(getTenantIsolatedFilter(req, { status: "Past" })),
    ]);
    const plural = (n, noun) => (n === 1 ? `is 1 ${noun}` : `are ${n} ${noun}s`);
    if (/(coming up|upcoming|this week|up next)/.test(message.toLowerCase())) {
      return `📅 There ${plural(upcoming, "event")} coming up — want me to list them?`;
    }
    return `📊 There ${plural(total, "event")} in total — ${upcoming} upcoming/live and ${past} past. Want me to list the upcoming ones?`;
  }

  if (intent === "popular_events") {
    const events = await Event.find(getIsolatedActiveFilter(req, now))
      .sort({ registered: -1 })
      .limit(5)
      .lean();

    if (!events.length) {
      return "No events found at the moment.";
    }

    const canPredict = !!(await ai.health())?.attendance;
    let predictions = {};
    if (canPredict) {
      try {
        const predArray = await predictAttendance.batch(events);
        events.forEach((e, i) => {
          const v = predArray[i];
          predictions[String(e._id)] = typeof v === "object" ? v.predicted ?? v : v;
        });
      } catch {}
    }
    let reply = "🔥 Most popular events right now:\n\n| Event | Registered |";
    reply += canPredict ? " Predicted | Fill |" : " Fill |";
    reply += canPredict ? "\n|-------|------------|-----------|------|" : "\n|-------|------------|------|";
    for (const e of events) {
      const pct = Math.round((e.registered / e.capacity) * 100);
      const row = `\n| ${eventLink(e)} | ${e.registered}/${e.capacity} |`;
      const pred = predictions[String(e._id)];
      reply += canPredict ? `${row} ~${pred ?? "?"} | ${pct}% |` : `${row} ${pct}% |`;
    }
    return reply;
  }

  if (intent === "pricing") {
    const event = await resolveEvent(eventId, message, req);
    if (event) {
      const priceLabel = formatEventPrice(event.price);
      return event.price?.amount > 0
        ? `💰 **${event.title}** costs ${priceLabel} per ticket — [view event](/event/${event._id}). You can pay securely by card at checkout.`
        : `🎉 **${event.title}** is free — no payment needed, just register — [view event](/event/${event._id}).`;
    }
    // Generic price question without event — ask for clarification instead of dumping 12 events
    const isGenericPrice = /\b(how much|cost|price|pricing)\b/i.test(message) && !slots.price_pref && !/\bfree\b|\bpaid\b/i.test(message);
    if (isGenericPrice) {
      return await formatCandidateHint(req, 'Which event\'s price would you like to know?');
    }

    const past = slots.time_scope === "past";
    const scope = past ? getTenantIsolatedFilter(req, { status: "Past" }) : getIsolatedActiveFilter(req, now);
    const freeHeading = past ? "Past free events" : "Free events";
    const paidHeading = past ? "Past paid events" : "Paid events";
    const noneMsg = (kind) => `No ${kind} events ${past ? "in the past" : "right now"}.`;

    const [free, paid] = await Promise.all([
      Event.find({ $and: [scope, { "price.amount": 0 }] })
        .select("title date price venue").sort({ date: past ? -1 : 1 })
        .limit(6).lean(),
      Event.find({ $and: [scope, { "price.amount": { $gt: 0 } }] })
        .select("title date price venue").sort({ date: past ? -1 : 1 })
        .limit(6).lean(),
    ]);

    const pref = slots.price_pref;
    // "any free events?" wants free ones; "what's paid?" wants paid ones. Only
    // a generic ask ("how much are tickets?") lists both sides.
    if (pref === "free") {
      if (!free.length) return noneMsg("free");
      return `🎉 **${freeHeading}:**\n\n${free.map((e) => `• ${eventLink(e)} — ${shortDate(e.date)}`).join("\n")}`;
    }
    if (pref === "paid") {
      if (!paid.length) return past ? "No paid events in the past." : "No paid events right now — everything upcoming is free!";
      return `💰 **${paidHeading}:**\n\n| Event | Price | Date |\n|-------|-------|------|\n${paid
        .map((e) => `| ${eventLink(e)} | ${formatEventPrice(e.price)} | ${shortDate(e.date)} |`)
        .join("\n")}`;
    }

    if (!free.length && !paid.length) {
      return past ? "No past events to price — none have concluded yet." : "There are no upcoming events to price right now. Check back soon!";
    }

    let reply = "";
    if (free.length) {
      reply += `🎉 **${freeHeading}:**\n\n${free.map((e) => `• ${eventLink(e)} — ${shortDate(e.date)}`).join("\n")}`;
    } else {
      reply += noneMsg("free");
    }
    if (paid.length) {
      reply += `\n\n💰 **${paidHeading}:**\n\n| Event | Price | Date |`;
      reply += "\n|-------|-------|------|";
      paid.forEach((e) => {
        reply += `\n| ${eventLink(e)} | ${formatEventPrice(e.price)} | ${shortDate(e.date)} |`;
      });
    }
    return reply;
  }

  if (intent === "organizer") {
    const event = await resolveEvent(eventId, message, req);
    if (!event) return await formatCandidateHint(req);
    const organizerName = (typeof event.organizer === "object" && event.organizer?.name) || "the event organizer";
    return `**${event.title}** is organized by ${organizerName} — [view event](/event/${event._id}).`;
  }

  if (intent === "capacity") {
    const event = await resolveEvent(eventId, message, req);
    if (!event) return await formatCandidateHint(req);
    const available = event.capacity - event.registered;
    const pct = Math.round((event.registered / event.capacity) * 100);
    const view = ` — [view event](/event/${event._id})`;
    if (available <= 0) {
      return `🚫 **${event.title}** is fully booked (${event.registered}/${event.capacity}). Check back in case a spot opens up from a cancellation.${view}`;
    }
    const canPredict = !!(await ai.health())?.attendance;
    const forecast = canPredict ? ` Based on current trends, we expect ${await predictAttendance(event)} total attendees.` : "";
    return `**${event.title}** has ${event.registered}/${event.capacity} registered (${pct}% full) — there ${available === 1 ? "is" : "are"} **${available}** spot${available === 1 ? "" : "s"} left.${forecast}${view}`;
  }

  if (intent === "cancellation") {
    const event = await resolveEvent(eventId, message, req);
    if (!event) {
      // List user's cancellable tickets as disambiguation
      const myTickets = await Ticket.find({ attendee: req.user._id, status: { $ne: "cancelled" } }).populate("event", "title").limit(5).lean();
      if (myTickets.length) {
        const list = myTickets.map((t, i) => `${i + 1}. [${t.event?.title || "Event"}](/event/${t.event?._id || t.event})`).join("  ");
        return `Which registration would you like to cancel?\n\nYou have: ${list}\n\nReply with the event name, or open My Tickets to cancel directly.`;
      }
      return await formatCandidateHint(req, 'Which event would you like to cancel?');
    }
    const ticket = await Ticket.findOne({ event: event._id, attendee: req.user._id }).lean();
    if (!ticket) {
      return `You are not registered for **${event.title}**, so there is nothing to cancel. — [view event](/event/${event._id})`;
    }
    if (ticket.status === "cancelled") {
      return `Your registration for **${event.title}** is already cancelled.`;
    }
    if (ticket.status === "checked-in") {
      return `This ticket for **${event.title}** is already checked in, so it can no longer be cancelled.`;
    }
    // Matches ticketController.cancelTicket's own rule exactly — the bot
    // must never tell a paid-ticket holder "it's instant" when the actual
    // endpoint would reject the request.
    if (ticket.payment?.status === "paid") {
      return `**${event.title}** was a paid registration, so it can't be self-cancelled online — contact the organizer to arrange a refund. — [view event](/event/${event._id})`;
    }
    return `You're registered for **${event.title}** (status: ${ticket.status}). Go to My Tickets and tap Cancel to self-cancel — it's instant and frees your spot for someone else. — [view event](/event/${event._id})`;
  }

  if (intent === "join_event") {
    // Attendee wants to join/register — guide them with precise, actionable next step.
    // Never auto-register via bot without explicit event context; always require confirmation or link.
    const event = await resolveEvent(eventId, message, req);
    if (!event) {
      return (
        'Which event would you like to join? Try `Join Tech Conference` or open the event page first, ' +
        'then say `join this event`. You can also browse at [Discover](/events) — open any event and tap **Join Event**.'
      );
    }
    // Check current registration
    const existing = await Ticket.findOne({ event: event._id, attendee: req.user._id, status: { $ne: "cancelled" } }).lean();
    if (existing) {
      return `You're already registered for **${event.title}** (status: ${existing.status}) — [view ticket](/my-tickets) or [event](/event/${event._id}).`;
    }
    if (event.status === "Draft") {
      return `**${event.title}** isn't open for registration yet — it's still in draft. Check back once it's published. — [view event](/event/${event._id})`;
    }
    if (new Date(event.date) <= new Date()) {
      return `**${event.title}** has already started and registration is closed. — [view event](/event/${event._id})`;
    }
    if (event.registered >= event.capacity) {
      return `**${event.title}** is fully booked (${event.registered}/${event.capacity}). You can check back for cancellations. — [view event](/event/${event._id})`;
    }
    const priceLabel = formatEventPrice(event.price);
    if (event.price?.amount > 0) {
      return `Great — to join **${event.title}** (${priceLabel}) open the event page and choose your payment: eSewa (NPR) or card. [Join now](/event/${event._id}) — it takes 30 seconds and your QR ticket is instant.`;
    }
    return `You're one tap away from joining **${event.title}** (Free). Open [the event page](/event/${event._id}) and tap **Join Event** — I'll be here if you need help!`;
  }

  if (intent === "categories") {
    const categories = await Event.distinct("category", getTenantIsolatedFilter(req, { status: { $in: ["Upcoming", "Live"] } }));
    if (!categories.length) return "No categories found.";
    return `🏷️ Available event categories: ${categories.join(", ")}. You can filter by category on the Discover page, or ask me to _recommend_ events for you.`;
  }

  if (["venue", "schedule", "registration_status"].includes(intent)) {
    const event = await resolveEvent(eventId, message, req);
    if (!event) return await formatCandidateHint(req);

    if (intent === "venue") {
      const hasCoords = hasValidCoords(event.coordinates);
      let reply = `📍 **${event.title}** is at ${event.venue}.`;
      if (hasCoords) {
        reply += ` Coordinates: ${event.coordinates.lat.toFixed(4)}, ${event.coordinates.lng.toFixed(4)}.`;
        if (hasValidCoords(req.user.location)) {
          const dist = haversineKm(req.user.location, event.coordinates);
          reply += ` It's ${distanceLabel(dist)} from your location.`;
        }
      }
      return `${reply} — [view event](/event/${event._id})`;
    }

    if (intent === "schedule") {
      const d = new Date(event.date);
      return `🗓️ **${event.title}** is scheduled for ${d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })} at ${d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}. — [view event](/event/${event._id})`;
    }

    const ticket = await Ticket.findOne({ event: event._id, attendee: req.user._id }).lean();
    if (!ticket) {
      return `You are not registered for **${event.title}** yet — [view event](/event/${event._id}). Would you like to register?`;
    }
    const statusEmoji = ticket.status === "checked-in" ? "✅ Checked in" : ticket.status === "cancelled" ? "❌ Cancelled" : "🎫 Valid";
    return `You're registered for **${event.title}** (status: ${ticket.status}) ${statusEmoji}. Your ticket ID: ${ticket._id.toString().slice(-6).toUpperCase()}. — [view event](/event/${event._id})`;
  }

  return "I'm not sure how to help with that yet 🤔 Here's what I can do:\n\n• 🎯 **Recommend events** for you\n• 📍 Find events **near you**\n• 🎫 Show your **tickets**\n• 📅 List **upcoming** events\n• 💰 Check **free vs. paid** pricing\n• 👥 Check event **capacity**\n• 🔥 Find **popular/trending** events\n• 🗺️ Tell you about **venue and schedule**\n• ✅ Check your **registration status**\n\nWhat would you like to know?";
};

// Context-aware follow-up chips attached to every bot reply — the frontend
// renders them under the message so each answer naturally invites the next
// question ("show me these" → "what's free?" → "what's near me?"). The
// array is short and static per intent: these are conversation prompts,
// not live data, so there's nothing to go stale.
const FOLLOW_UP_SUGGESTIONS = {
  recommend: ["📅 What events are coming up?", "🔥 What's trending?", "💰 Any free events?"],
  near_me: ["📅 What events are coming up?", "🎯 Recommend events for me"],
  my_tickets: ["📅 What events are coming up?", "💰 Any free events?"],
  pricing: ["🎯 Recommend events for me", "📅 What events are coming up?", "🔥 What's trending?"],
  organizer: ["🎯 Recommend events for me", "📍 What's near me?"],
  upcoming_events: ["🔥 What's trending?", "💰 Any free events?", "📍 What's near me?"],
  event_count: ["📅 List the upcoming events", "🔥 What's trending?"],
  popular_events: ["📅 What events are coming up?", "💰 Any free events?"],
  venue: ["🗓️ What's the schedule?", "📅 What events are coming up?"],
  schedule: ["📍 Where is it?", "🎯 Recommend events for me"],
  capacity: ["💰 What's the price?", "🗓️ What's the schedule?"],
  registration_status: ["🎫 Show my tickets", "📅 What events are coming up?"],
  cancellation: ["🎫 Show my tickets", "📅 What events are coming up?"],
  categories: ["📅 What events are coming up?", "💰 Any free events?"],
  create_event: ["📅 What events are coming up?", "🎯 Recommend events for me"],
  greeting: ["📅 What events are coming up?", "💰 Any free events?", "🔥 What's trending?"],
  join_event: ["🎫 Show my tickets", "📅 What events are coming up?", "💰 Any free events?"],
  fallback: ["📅 What events are coming up?", "🎯 Recommend events for me", "💰 Any free events?"],
};

// Once an intent + slots are known (from understandMessage — the LLM in
// the normal case), the reply is always the grounded, DB-computed fact
// string returned verbatim — no LLM rephrasing step. An earlier version
// ran every grounded reply through the LLM to "sound more natural," but a
// small instant-tier model paraphrasing a multi-fact sentence (e.g. "these
// events are free, these are paid, these cost X") would routinely drop or
// garble facts, or shuffle a price onto the wrong event's name — same
// question, different (and sometimes wrong) answer on repeat asks.
// Grounded replies are already written as complete, friendly sentences
// with light emoji, so nothing is lost by returning them directly; what's
// gained is that every answer is exactly reproducible from the database.
// The LLM's job is understanding the question (via /understand) and
// explaining recommendations from the engine's own factors — never
// rewriting an already-correct grounded fact. The one exception is
// answerFreeform below: when intent is genuinely 'fallback' (nothing in
// the closed intent set fits — including meta/capability questions), the
// LLM DOES generate the final answer, strictly grounded in injected event
// data with an explicit fact sheet about the bot's own identity/limits.
const query = async (req, res) => {
  try {
    const { message, eventId, history } = req.body;
    if (!message) {
      return res.status(400).json({ message: "message is required" });
    }

    // Last ~8 turns give the LLM conversational context without bloating
    // the prompt (and its latency) with the whole transcript.
    const context = Array.isArray(history)
      ? history
          .filter((h) => h && typeof h.content === "string")
          .slice(-8)
          .map((h) => ({ role: h.role === "assistant" ? "assistant" : "user", content: h.content }))
      : [];

    const { intent, slots, source } = await understandMessage(message, context);

    // Only rule-confirmed labels are ground truth for retraining — an LLM
    // guess is a good enough answer to act on, but not something to teach
    // the ML classifier to imitate (it might itself be wrong in a way the
    // grounded reply below doesn't surface).
    if (source === "rules" && matchIntent(message) === intent) {
      ai.logIntent(message, intent);
    }

    let reply = await buildGroundedReply(req, intent, eventId, message, slots);

    if (intent === "fallback") {
      const freeform = await answerFreeform(req, message, context);
      if (freeform) reply = freeform;
    }

    // Interactive follow-up chips — event-aware when we just resolved an event
    let quickReplies = FOLLOW_UP_SUGGESTIONS[intent] ?? FOLLOW_UP_SUGGESTIONS.fallback;
    // If buildGroundedReply found an event, offer event-specific next steps
    // We try to peek the last resolved event title from reply's markdown link
    const eventLinkMatch = reply && reply.match(/\[([^\]]+)\]\(\/event\/([a-f0-9]{24})\)/);
    if (eventLinkMatch) {
      const evTitle = eventLinkMatch[1];
      if (intent === "pricing") quickReplies = [`📍 Where is ${evTitle}?`, `👥 How many spots left for ${evTitle}?`, `🗓️ Schedule for ${evTitle}?`];
      else if (intent === "venue") quickReplies = [`🗓️ Schedule for ${evTitle}?`, `💰 Price for ${evTitle}?`, `👥 Capacity for ${evTitle}?`];
      else if (intent === "capacity") quickReplies = [`💰 Price for ${evTitle}?`, `📍 Where is ${evTitle}?`, `🎫 Join ${evTitle}`];
      else if (intent === "schedule") quickReplies = [`📍 Where is ${evTitle}?`, `👥 Capacity for ${evTitle}?`, `🎫 Join ${evTitle}`];
    }

    res.json({ intent, reply, quickReplies });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

// Suggested prompt chips shown when the chat opens — dynamic where possible
// (nearby events only if location is on, tickets only if they exist,
// categories pulled from the DB), always falling back to static staples so
// the panel never opens empty.
const getSuggestions = async (req, res) => {
  try {
    const now = new Date();
    const [ticketCount, upcoming, categories] = await Promise.all([
      Ticket.countDocuments({ attendee: req.user._id }),
      Event.countDocuments(getIsolatedActiveFilter(req, now)),
      Event.distinct("category", getTenantIsolatedFilter(req, { status: { $in: ["Upcoming", "Live"] } })),
    ]);

    const suggestions = ["🎯 Recommend events for me"];
    if (ticketCount > 0) suggestions.push("🎫 Show my tickets");
    if (hasValidCoords(req.user.location)) suggestions.push("📍 What's near me?");
    if (upcoming > 0) suggestions.push("📅 What events are coming up?");
    suggestions.push("💰 Any free events?");
    if (upcoming > 0) suggestions.push("🔥 What's trending?");
    if (categories.length) suggestions.push(`🏷️ Categories: ${categories.slice(0, 3).join(", ")}`);
    suggestions.push("ℹ️ What can you do?");

    res.json({ suggestions: suggestions.slice(0, 8) });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

module.exports = { query, getSuggestions };