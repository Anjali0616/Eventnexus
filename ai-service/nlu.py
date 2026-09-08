"""Rule-based slot extraction for the chatbot's NLU layer.

Intent classification alone can't express modifiers like "just one event"
vs. "list events", or "past" vs. "upcoming" — a flat intent label is a
single value from a closed set, not a set of independent parameters. These
are slot-filling questions, not classification questions: adding them as
new *intents* (e.g. `upcoming_events_single`) would pollute the taxonomy
with what's really a quantity modifier on an existing intent, and adding
them as a second ML output head isn't justified either — there's no
training-data ambiguity here for a model to resolve (a message either
contains a singular quantifier next to "event" or it doesn't), so a small
deterministic extractor is both the simplest and the most reliable choice.

This was previously duplicated as three separate regex helpers inside the
Node backend (chatbotController.js). Centralizing it here means the backend
calls one `/parse` endpoint for both intent (ML) and slots (rules) instead
of re-implementing NLU logic in two languages; Node keeps its own copies
only as an offline fallback for when this service is unreachable.
"""

import re

_SINGLE_QUANTIFIER_RE = re.compile(r"\b(one|1|single|only one|just one|latest|next|nearest|newest|soonest)\b", re.I)
_SINGULAR_EVENT_RE = re.compile(r"\bevent\b(?!s)", re.I)
_PLURAL_EVENTS_RE = re.compile(r"\bevents\b", re.I)

_PAST_RE = re.compile(
    r"\b(past|done|finished|ended|previous|concluded|already happened|has happened|have happened)\b",
    re.I,
)

_FREE_RE = re.compile(r"\bfree\b|\bno cost\b|complimentary|\bfreebies\b", re.I)
_PAID_RE = re.compile(r"\bpaid\b|\bpay\b|\bcosts?\b|\bprice\b", re.I)

# An explicit number ("10 events", "top 5", "show 3") — distinct from the
# binary quantity slot above (one vs. many): this is how MANY to return
# when the caller wants more or fewer than the default list size. Capped
# at 1-50 so a stray number that isn't a count request (a year in an event
# name, a venue's street number) doesn't get misread as one.
_COUNT_RE = re.compile(r"\b(\d{1,2})\b")


def extract_quantity(message: str) -> str | None:
    """"one" when the message asks about a single event, else None (list).

    Requires a genuinely singular "event" mention (never "events") plus a
    singular quantifier ANYWHERE in the message — not adjacent to "event" —
    since real messages routinely put other words between them ("tell me
    about one 1 upcoming event").
    """
    if not _SINGULAR_EVENT_RE.search(message):
        return None
    has_quantifier = bool(_SINGLE_QUANTIFIER_RE.search(message))
    if _PLURAL_EVENTS_RE.search(message) and not has_quantifier:
        return None
    return "one" if has_quantifier else None


_UPCOMING_RE = re.compile(r"\b(upcoming|future|next|soon|forthcoming)\b", re.I)

def extract_time_scope(message: str) -> str | None:
    if _PAST_RE.search(message):
        return "past"
    if _UPCOMING_RE.search(message):
        return "upcoming"
    return None


def extract_price_preference(message: str) -> str | None:
    if _FREE_RE.search(message):
        return "free"
    if _PAID_RE.search(message):
        return "paid"
    return None


def extract_count(message: str) -> int | None:
    m = _COUNT_RE.search(message)
    if not m:
        return None
    n = int(m.group(1))
    return n if 1 <= n <= 50 else None


def extract_slots(message: str) -> dict:
    return {
        "quantity": extract_quantity(message),
        "time_scope": extract_time_scope(message),
        "price_pref": extract_price_preference(message),
        "count": extract_count(message),
    }
