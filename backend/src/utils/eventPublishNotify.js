const Notification = require("../models/Notification");
const User = require("../models/User");
const { emitToUsers, getIo } = require("./socket");

const BATCH_SIZE = 500;
const BROADCAST_TYPE = "new-event";

/**
 * Broadcast a "new event published" notification to all attendees.
 * Called only when an event is *published* (Draft -> Upcoming/Live),
 * not on every edit. Fire-and-forget from eventController.
 */
const broadcastNewEvent = async (event) => {
  try {
    const title = `New event: ${event.title}`;
    const dateStr = new Date(event.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const message = `"${event.title}" — ${event.category || "Event"} at ${event.venue || "TBA"} on ${dateStr}${event.price?.amount > 0 ? ` • ${event.price.currency || "NPR"} ${event.price.amount}` : " • Free"} — tap to view & register.`;
    const link = `/events/${event._id}`;
    const orgId = event.organization;

    // Find recipients: all users except the organizer, with active accounts
    // We notify attendees, organizers and org_admins — everyone who browses events
    const recipients = await User.find({
      _id: { $ne: event.organizer },
      active: { $ne: false },
    }).select("_id organization").lean();

    if (!recipients.length) return { notified: 0, total: 0 };

    // Chunked insert to avoid 16MB doc limit and to keep write load bounded
    let notified = 0;
    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      const chunk = recipients.slice(i, i + BATCH_SIZE);
      // Deduplicate: don't re-notify if already have new-event for this event
      const ids = chunk.map((u) => u._id);
      const existing = await Notification.find({ event: event._id, type: BROADCAST_TYPE, recipient: { $in: ids } }).select("recipient").lean();
      const existingSet = new Set(existing.map((n) => String(n.recipient)));
      const docs = chunk
        .filter((u) => !existingSet.has(String(u._id)))
        .map((u) => ({
          recipient: u._id,
          organization: orgId,
          type: BROADCAST_TYPE,
          title,
          message,
          event: event._id,
          link,
          data: { eventId: event._id, category: event.category, venue: event.venue },
        }));
      if (!docs.length) continue;
      try {
        await Notification.insertMany(docs, { ordered: false });
        notified += docs.length;
        // Realtime push per chunk
        const userIds = docs.map((d) => d.recipient);
        // Emit unread count per user is N+1, but we batch with generic count increment
        // For performance, emit a lightweight event and let client refetch unread count
        const io = getIo();
        if (io) {
          userIds.forEach((uid) => {
            io.to(`user:${String(uid)}`).emit("notification:created", {
              notification: { title, message, type: BROADCAST_TYPE, event: event._id, link },
              unread: 1,
            });
          });
        }
      } catch (err) {
        // Ignore duplicate key errors (race), log others
        if (err.code !== 11000) console.error("[broadcastNewEvent] insert error:", err.message);
        // Count successful inserts even if some duplicates
        if (err.result && err.result.nInserted) notified += err.result.nInserted;
      }
    }
    console.log(`[broadcastNewEvent] notified ${notified}/${recipients.length} users for event ${event._id}`);
    return { notified, total: recipients.length };
  } catch (err) {
    console.error("[broadcastNewEvent] failed:", err.message);
    return { notified: 0, error: err.message };
  }
};

module.exports = { broadcastNewEvent, BROADCAST_TYPE };
