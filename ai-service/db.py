"""MongoDB access for the AI service.

The service reads the EventNexus database directly (pymongo) so models are
trained on the same history the app actually produced — no data plumbing
through Node. Collection names mirror backend/src/models/*.js.

Collections used:
  - events:   Event documents (training target + candidate pool)
  - tickets:  attendee x event interactions (collaborative filtering)
  - users:    attendee profiles (location, name)
  - chatlog:  labeled (message -> intent) pairs (hybrid chatbot classifier)
"""

import os

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv()

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017/eventnexus")

_client = None


import threading
_db_lock = threading.Lock()

def get_db():
    global _client
    if _client is None:
        with _db_lock:
            if _client is None:
                _client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=3000, maxPoolSize=20, connectTimeoutMS=3000, socketTimeoutMS=10000)
    return _client.eventnexus


def load_past_events():
    """Events that already happened, with their final attendance."""
    return list(
        get_db().events.find(
            {"status": "Past", "registered": {"$gte": 0}},
            {"title": 1, "category": 1, "type": 1, "capacity": 1, "registered": 1,
             "createdAt": 1, "date": 1, "organization": 1},
        )
    )


def load_upcoming_events(organization_id=None):
    """Candidate pool for recommendations / predictions.

    Live events stay candidates even when their stored date has passed
    midnight (a festival seeded "today" is still happening) — a plain
    `date >= now` filter would silently drop them.
    """
    query = {
        "status": {"$in": ["Upcoming", "Live"]},
        "$or": [{"status": "Live"}, {"date": {"$gte": __now_iso()}}],
    }
    if organization_id:
        try:
            query["organization"] = _oid(organization_id)
        except Exception:
            from fastapi import HTTPException
            raise HTTPException(status_code=400, detail="Invalid organization_id")
    return list(
        get_db().events.find(
            query,
            {"title": 1, "category": 1, "type": 1, "capacity": 1, "registered": 1,
             "createdAt": 1, "date": 1, "organization": 1, "coordinates": 1},
        )
    )


def load_tickets():
    """All attendee x event interactions (implicit feedback from bookings)."""
    return list(
        get_db().tickets.find(
            {"status": {"$ne": "cancelled"}},
            {"attendee": 1, "event": 1, "status": 1, "createdAt": 1},
        )
    )


def load_chat_log():
    """Labeled (message, intent) pairs accumulated by the app."""
    return list(get_db().chatlog.find({}, {"message": 1, "intent": 1}))


def load_orgs():
    """Organization documents, for pair features (city/country signals)."""
    return list(get_db().organizations.find({}, {"name": 1, "city": 1, "country": 1}))


def load_collab_pairs():
    """Labeled event pairs for the collaboration-match classifier.

    Ground truth from two real signals:
      - positives: suggestions both admins ACCEPTED (resolvedOutcome
        "co-hosted") — the outcomes that actually became co-hostings — plus
        event pairs currently bound as MUTUAL co-hosts in the events
        collection (each org on the other event's coHostOrganizations).
      - negatives: suggestions where at least one side DECLINED
        (resolvedOutcome "rejected").

    Returns (pairs, labels): pairs is a list of (event_a, event_b) dicts
    (org city/country attached under "org"), labels is 1/0 in the same order.
    """
    db = get_db()
    events_by_id = {
        str(e["_id"]): e
        for e in db.events.find(
            {},
            {
                "title": 1, "description": 1, "date": 1, "venue": 1, "coordinates": 1,
                "type": 1, "category": 1, "capacity": 1, "registered": 1,
                "tags": 1, "highlights": 1, "agenda": 1, "speakers": 1,
                "organization": 1, "coHostOrganizations": 1,
            },
        )
    }
    orgs_by_id = {str(o["_id"]): o for o in load_orgs()}

    def attach(e):
        out = dict(e)
        org = orgs_by_id.get(str(e.get("organization") or "")) or {}
        out["org"] = {"city": org.get("city"), "country": org.get("country")}
        return out

    pairs, labels = [], []
    seen = set()

    # Accepted collaboration suggestions (real positive decisions).
    for s in db.collaborationsuggestions.find(
        {"resolvedOutcome": {"$in": ["co-hosted", "rejected"]}},
        {"eventA": 1, "eventB": 1, "resolvedOutcome": 1},
    ):
        e1, e2 = events_by_id.get(str(s.get("eventA"))), events_by_id.get(str(s.get("eventB")))
        if not e1 or not e2:
            continue
        key = "-".join(sorted([str(e1.get("_id")), str(e2.get("_id"))]))
        if key in seen:
            continue
        seen.add(key)
        pairs.append((attach(e1), attach(e2)))
        labels.append(1 if s.get("resolvedOutcome") == "co-hosted" else 0)

    # Mutual co-hosts currently in the events collection (positive only).
    # Optimized via org->events index to avoid O(n²) scan (was 100M iterations at 10k events).
    if len(events_by_id) > 5000:
        # Safety cap to prevent OOM on huge collections
        print(f"[db] skipping mutual co-host scan: {len(events_by_id)} events exceeds cap")
        return pairs, labels
    from collections import defaultdict
    org_to_events = defaultdict(list)
    for ev in events_by_id.values():
        org_to_events[str(ev.get("organization") or "")].append(ev)
    for e in events_by_id.values():
        other_ids = [str(x) for x in (e.get("coHostOrganizations") or [])]
        if not other_ids:
            continue
        for org_id in other_ids:
            for other in org_to_events.get(org_id, []):
                if other.get("_id") == e.get("_id"):
                    continue
                mutual = str(e.get("organization")) in [str(x) for x in (other.get("coHostOrganizations") or [])]
                if not mutual:
                    continue
                key = "-".join(sorted([str(e.get("_id")), str(other.get("_id"))]))
                if key in seen:
                    continue
                seen.add(key)
                pairs.append((attach(e), attach(other)))
                labels.append(1)
    return pairs, labels


def insert_chat_log(message, intent):
    from datetime import datetime, timezone

    get_db().chatlog.insert_one(
        {"message": message, "intent": intent, "createdAt": datetime.now(timezone.utc)}
    )


def __now_iso():
    from datetime import datetime, timezone

    return datetime.now(timezone.utc)


def _oid(value):
    from bson import ObjectId
    from bson.errors import InvalidId

    if isinstance(value, ObjectId):
        return value
    try:
        return ObjectId(str(value))
    except (InvalidId, TypeError, ValueError) as e:
        raise ValueError(f"Invalid ObjectId: {value}") from e
