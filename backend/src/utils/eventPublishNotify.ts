import Notification from "../models/Notification";
import User from "../models/User";
import { emitToUsers, getIo } from "./socket";

const BATCH_SIZE: number = 500;
export const BROADCAST_TYPE: string = "new-event";

/**
 * Broadcast a "new event published" notification to all attendees.
 * Called only when an event is *published* (Draft -> Upcoming/Live),
 * not on every edit. Fire-and-forget from eventController.
 */
export const broadcastNewEvent = async (event: any): Promise<{ notified: number; total?: number; error?: string }> => {
  try {
    // Guard: require a valid event ObjectId — otherwise we'd create links like /event/undefined
    const rawId: string | null = event?._id ? String(event._id) : null;
    const isValidId = rawId && /^[0-9a-fA-F]{24}$/.test(rawId);
    if (!isValidId) {
      console.warn("[broadcastNewEvent] skipped: missing or invalid event._id", { title: event?.title, rawId });
      return { notified: 0, total: 0, error: "missing event _id" };
    }
    const eventId = rawId as string;
    const title = `New event: ${event.title}`;
    const dateStr = new Date(event.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    const message = `"${event.title}" — ${event.category || "Event"} at ${event.venue || "TBA"} on ${dateStr}${event.price?.amount > 0 ? ` • ${event.price.currency || "NPR"} ${event.price.amount}` : " • Free"} — tap to view & register.`;
    // Canonical attendee event detail is /event/[id] (public QR + authenticated detail). Use singular for consistency.
    const link = `/event/${eventId}`;
    const orgId = event.organization;

    // Find recipients: all users except the organizer, with active accounts
    // We notify attendees, organizers and org_admins — everyone who browses events
    const recipients: any[] = await (User as any).find({
      _id: { $ne: event.organizer },
      active: { $ne: false },
    }).select("_id organization").lean();

    if (!recipients.length) return { notified: 0, total: 0 };

    // Chunked insert to avoid 16MB doc limit and to keep write load bounded
    let notified = 0;
    for (let i = 0; i < recipients.length; i += BATCH_SIZE) {
      const chunk = recipients.slice(i, i + BATCH_SIZE);
      // Deduplicate: don't re-notify if already have new-event for this event
      const ids = chunk.map((u: any) => u._id);
      const existing: any[] = await (Notification as any).find({ event: event._id, type: BROADCAST_TYPE, recipient: { $in: ids } }).select("recipient").lean();
      const existingSet = new Set(existing.map((n: any) => String(n.recipient)));
      const docs = chunk
        .filter((u: any) => !existingSet.has(String(u._id)))
        .map((u: any) => ({
          recipient: u._id,
          organization: orgId,
          type: BROADCAST_TYPE,
          title,
          message,
          event: event._id,
          link,
          data: { eventId, category: event.category, venue: event.venue },
        }));
      if (!docs.length) continue;
      try {
        await (Notification as any).insertMany(docs, { ordered: false });
        notified += docs.length;
        // Realtime push per chunk
        const userIds = docs.map((d: any) => d.recipient);
        // Emit unread count per user is N+1, but we batch with generic count increment
        // For performance, emit a lightweight event and let client refetch unread count
        const io: any = getIo();
        if (io) {
          userIds.forEach((uid: any) => {
            io.to(`user:${String(uid)}`).emit("notification:created", {
              notification: { title, message, type: BROADCAST_TYPE, event: eventId, link },
              unread: 1,
            });
          });
        }
      } catch (err: any) {
        // Ignore duplicate key errors (race), log others
        if (err.code !== 11000) console.error("[broadcastNewEvent] insert error:", err.message);
        // Count successful inserts even if some duplicates
        if (err.result && err.result.nInserted) notified += err.result.nInserted;
      }
    }
    console.log(`[broadcastNewEvent] notified ${notified}/${recipients.length} users for event ${eventId}`);
    return { notified, total: recipients.length };
  } catch (err: any) {
    console.error("[broadcastNewEvent] failed:", err.message);
    return { notified: 0, error: err.message };
  }
};

export default { broadcastNewEvent, BROADCAST_TYPE };
