import User from "../models/User";
import Notification from "../models/Notification";
import { emitToUsers } from "./socket";
import { sendMail } from "./email";

// How far "near you" reaches, in km. Configurable per deployment since it's
// as much a product decision (dense city vs. rural region) as a technical one.
export const RADIUS_KM: number = Number(process.env.NEARBY_EVENT_RADIUS_KM) || 25;
// Safety cap — a very central venue shouldn't fan out to thousands of
// notification writes on a single event publish.
const MAX_NOTIFIED: number = 300;
// Emails cost real money and sender reputation, so they're capped harder
// than the in-app feed. $near returns nearest-first, so the cap keeps the
// most relevant recipients rather than an arbitrary slice.
const MAX_EMAILED: number = Number(process.env.NEARBY_EVENT_MAX_EMAILS) || 100;

// Fires when an event goes live (created non-draft, or transitions out of
// Draft): finds attendees/organizers within RADIUS_KM of the venue using the
// 2dsphere index on location.geo (a real geospatial query, not an
// application-level scan) and alerts each one.
//
// Deliberately NOT scoped to the event's organization. Attendees browse
// every organization's events on the public Discover page, and most have a
// different organization — or none at all. The old `organization:
// event.organization` filter therefore excluded nearly every real attendee
// from "new event near you", the same single-tenant assumption already
// corrected in the chatbot and recommendation engine.
//
// In-app notification goes to everyone nearby; EMAIL goes only to those who
// left the Settings toggle on (User.reminderEmail). That preference was
// previously honoured by the reminder scheduler alone, so a user who had
// opted in still received nothing when a new event was published.
//
// Fire-and-forget from the caller — a slow or failed fan-out must never
// block event creation or publishing.
export const notifyNearbyUsers = async (event: any): Promise<{ notified: number; emailed: number; reason?: string }> => {
  // Guard: never build /event/undefined links
  const rawEventId: string | null = event?._id ? String(event._id) : null;
  if (!rawEventId || !/^[0-9a-fA-F]{24}$/.test(rawEventId)) {
    console.warn("[proximity] skipped: missing or invalid event._id", { title: event?.title, rawEventId });
    return { notified: 0, emailed: 0, reason: "missing event _id" };
  }
  const point: any = event.coordinates?.geo?.coordinates;
  if (!point || point.length !== 2) {
    // Not an error: virtual events and venues without a geocode legitimately
    // have no point. Logged so a misconfigured event is visible rather than
    // silently un-alerted.
    console.log(`[proximity] "${event.title}" has no geo point — no nearby alerts sent`);
    return { notified: 0, emailed: 0, reason: "event has no coordinates" };
  }

  // $near returns nearest-first, so both caps below keep the closest users.
  const nearby: any[] = await (User as any).find({
    _id: { $ne: event.organizer },
    role: { $in: ["attendee", "organizer"] },
    active: { $ne: false },
    "location.geo": {
      $near: {
        $geometry: event.coordinates.geo,
        $maxDistance: RADIUS_KM * 1000,
      },
    },
  })
    .select("_id name email reminderEmail")
    .limit(MAX_NOTIFIED)
    .lean();

  if (!nearby.length) {
    console.log(`[proximity] no users within ${RADIUS_KM}km of "${event.title}"`);
    return { notified: 0, emailed: 0 };
  }

  // Don't alert the same person about the same event twice. createEvent and
  // updateEvent can both reach here (publish, then an edit that re-publishes),
  // and a duplicate "new event near you" reads as a bug to the recipient.
  const already: any[] = await (Notification as any).find({
    event: event._id,
    type: "nearby-event",
    recipient: { $in: nearby.map((u: any) => u._id) },
  })
    .select("recipient")
    .lean();
  const seen = new Set(already.map((n: any) => String(n.recipient)));
  const recipients: any[] = nearby.filter((u: any) => !seen.has(String(u._id)));

  if (!recipients.length) {
    console.log(`[proximity] "${event.title}" — all nearby users already alerted`);
    return { notified: 0, emailed: 0 };
  }

  const message = `"${event.title}" was just published at ${event.venue}, within ${RADIUS_KM} km of you.`;
  // Canonical singular /event/<id> — validated above so never /event/undefined
  const link = `/event/${rawEventId}`;
  const docs: any[] = recipients.map((user: any) => ({
    recipient: user._id,
    organization: event.organization,
    type: "nearby-event",
    title: "New event near you",
    message,
    event: event._id,
    link,
  }));

  // insertMany returns the created docs, so the socket payload below carries
  // the REAL _id. It previously emitted `doc._id` from the plain input
  // objects, which is undefined — any client keying off notification id
  // received a broken record.
  const created: any[] = await (Notification as any).insertMany(docs, { ordered: false });

  for (const doc of created) {
    emitToUsers([doc.recipient], "notification:created", {
      notification: {
        _id: doc._id,
        type: doc.type,
        title: doc.title,
        message: doc.message,
        event: doc.event,
        link: doc.link,
        organization: doc.organization,
        read: false,
        createdAt: doc.createdAt || new Date(),
      },
      unread: 1,
    });
  }

  // --- Email, for opted-in recipients only ---------------------------------
  const emailable: any[] = recipients
    .filter((u: any) => u.reminderEmail !== false && u.email)
    .slice(0, MAX_EMAILED);

  const eventDate = new Date(event.date);
  let emailed = 0;
  await Promise.all(
    emailable.map(async (user: any) => {
      try {
        await sendMail({
          to: user.email,
          subject: `New event near you: ${event.title}`,
          template: "nearby-event",
          templateData: {
            name: user.name,
            eventTitle: event.title,
            eventDate: eventDate.toLocaleDateString("en-US", { dateStyle: "full" }),
            eventTime: eventDate.toLocaleTimeString("en-US", { timeStyle: "short" }),
            venue: event.venue || "TBA",
            category: event.category || "",
            eventType: event.type || "In-person",
            price:
              event.price?.amount > 0
                ? `${(event.price.currency || "NPR").toUpperCase()} ${event.price.amount}`
                : "Free",
            radiusKm: RADIUS_KM,
            eventId: String(event._id),
          },
          metadata: { kind: "nearby-event", eventId: String(event._id) },
        });
        emailed += 1;
      } catch (err: any) {
        // One bad address must not stop the rest of the fan-out.
        console.error(`[proximity] email to ${user.email} failed:`, err.message);
      }
    })
  );

  console.log(
    `[proximity] "${event.title}": notified ${created.length}, emailed ${emailed} (of ${recipients.length} within ${RADIUS_KM}km)`
  );
  return { notified: created.length, emailed };
};

export default { notifyNearbyUsers, RADIUS_KM };
