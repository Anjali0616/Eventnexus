// In-process reminder scheduler — no external cron required.
// Runs a setInterval tick every REMINDER_TICK_MS (default 60s) to:
// 1. Ensure reminder jobs exist for registered attendees of upcoming events.
// 2. Dispatch any jobs whose scheduledAt <= now and sentAt is null.

const Event = require("../models/Event");
const Ticket = require("../models/Ticket");
const ReminderJob = require("../models/ReminderJob");
const Notification = require("../models/Notification");
const { emitToUser } = require("./socket");
const { sendMail } = require("./email");

// Config via env; defaults are production-friendly (1 min tick, 3-day lookahead).
const REMINDER_TICK_MS = Number(process.env.REMINDER_TICK_MS) || 60_000;
// Maximum window ahead of now to create "before_event" jobs (3 days = 4320 min).
const MAX_LOOKAHEAD_MIN = Number(process.env.REMINDER_MAX_LOOKAHEAD_MIN) || 4320;
// How far back to look for post-event feedback nudges (7 days).
const FEEDBACK_LOOKBACK_DAYS = Number(process.env.REMINDER_FEEDBACK_LOOKBACK_DAYS) || 7;

let tickTimer = null;
let isRunning = false;

async function ensureJobsForEvent(event) {
  const settings = event.reminderSettings || { enabled: true, offsets: [1440, 60], feedbackDelayHours: 24 };
  if (!settings.enabled) {
    // Cleanup any pending jobs for this event (organizer disabled reminders).
    await ReminderJob.deleteMany({ event: event._id, sentAt: null });
    return;
  }

  const now = new Date();
  const eventDate = new Date(event.date);
  const offsets = Array.isArray(settings.offsets) ? settings.offsets : [1440, 60];
  const feedbackDelayHours = Number(settings.feedbackDelayHours) || 24;

  // Fetch all valid (non-cancelled) tickets for this event.
  const tickets = await Ticket.find({ event: event._id, status: { $ne: "cancelled" } })
    .select("attendee")
    .lean();

  // Upsert "before_event" jobs for each offset.
  for (const ticket of tickets) {
    const attendeeId = ticket.attendee;
    for (const offsetMin of offsets) {
      const fireAt = new Date(eventDate.getTime() - offsetMin * 60_000);
      // Create if the fire time is now or in the future (allow tiny buffer for
      // events that start within the offset window).
      if (fireAt >= new Date(now.getTime() - 60_000)) {
        await ReminderJob.updateOne(
          { event: event._id, recipient: attendeeId, kind: "before_event", offsetMinutes: offsetMin },
          {
            $setOnInsert: {
              event: event._id,
              recipient: attendeeId,
              organization: event.organization,
              kind: "before_event",
              scheduledAt: fireAt,
              offsetMinutes: offsetMin,
            },
          },
          { upsert: true }
        );
      }
    }

    // Upsert "feedback" job (always create if in the future, regardless of lookback).
    const feedbackAt = new Date(eventDate.getTime() + feedbackDelayHours * 3_600_000);
    if (feedbackAt > now) {
      await ReminderJob.updateOne(
        { event: event._id, recipient: attendeeId, kind: "feedback", offsetMinutes: 0 },
        {
          $setOnInsert: {
            event: event._id,
            recipient: attendeeId,
            organization: event.organization,
            kind: "feedback",
            scheduledAt: feedbackAt,
            offsetMinutes: 0,
          },
        },
        { upsert: true }
      );
    }
  }
}

async function dispatchDueJobs() {
  const now = new Date();
  const dueJobs = await ReminderJob.find({ scheduledAt: { $lte: now }, sentAt: null })
    .populate("event", "title date venue")
    .populate("recipient", "name email reminderEmail")
    .lean();

  for (const job of dueJobs) {
    const event = job.event;
    const recipient = job.recipient;
    if (!event || !recipient) {
      // Mark as sent to avoid retrying forever on bad data.
      await ReminderJob.updateOne({ _id: job._id }, { sentAt: new Date(), metadata: { error: "missing event or recipient" } });
      continue;
    }

    // Build the in-app notification.
    let title, message;
    if (job.kind === "before_event") {
      const mins = job.offsetMinutes;
      const when = mins >= 1440 ? `${mins / 60}h` : `${mins}min`;
      title = `Reminder: ${event.title} starts in ${when}`;
      message = `${event.title} at ${event.venue} starts in ${when}.${event.date ? ` (${new Date(event.date).toLocaleString()})` : ""}`;
    } else {
      title = `How was ${event.title}?`;
      message = `We'd love your feedback on ${event.title}. It only takes a minute — share your thoughts!`;
    }

    // Guard: never create /event/undefined — validate event id before using it for link/event field.
    const rawEventId = event?._id ? String(event._id) : null;
    const validEventId = rawEventId && /^[0-9a-fA-F]{24}$/.test(rawEventId) ? rawEventId : null;
    if (!validEventId) {
      console.warn("[reminder] skipping notification with invalid event id", { jobId: job._id, rawEventId });
      await ReminderJob.updateOne({ _id: job._id }, { sentAt: new Date(), metadata: { error: "invalid event id", title, kind: job.kind } });
      continue;
    }
    // Create in-app notification (always). Canonical singular /event/<id>.
    const notification = await Notification.create({
      recipient: recipient._id,
      organization: job.organization,
      type: "reminder",
      title,
      message,
      event: event._id,
      link: `/event/${validEventId}`,
    });

    // Push it live — reminders land as a toast even if the app is open.
    const unread = await Notification.countDocuments({
      recipient: recipient._id,
      read: false,
    });
    emitToUser(recipient._id, "notification:created", { notification, unread });
    emitToUser(recipient._id, "unread:count", { count: unread });

    // Send dev-mode email if the recipient has reminderEmail enabled.
    if (recipient.reminderEmail) {
      try {
        await sendMail({
          to: recipient.email,
          subject: title,
          template: "reminder",
          text: message,
          html: `<p>${message.replace(/\n/g, "<br>")}</p>`,
          metadata: { eventId: event._id.toString(), kind: job.kind, offsetMinutes: job.offsetMinutes },
        });
      } catch (e) {
        // Log and continue; email failure shouldn't block the in-app notification.
        console.error("[reminder] email send failed:", e.message);
      }
    }

    // Mark job as dispatched.
    await ReminderJob.updateOne(
      { _id: job._id },
      { sentAt: new Date(), metadata: { title, kind: job.kind } }
    );
  }
}

async function tick() {
  if (isRunning) return; // Prevent overlapping ticks.
  isRunning = true;
  try {
    // Find events within the lookahead window + feedback lookback window.
    const now = new Date();
    const maxAhead = new Date(now.getTime() + MAX_LOOKAHEAD_MIN * 60_000);
    const lookbackStart = new Date(now.getTime() - FEEDBACK_LOOKBACK_DAYS * 86_400_000);

    const events = await Event.find({
      date: { $gte: lookbackStart, $lte: maxAhead },
      status: { $nin: ["Draft", "cancelled"] }, // Only remind for live/upcoming/past events
    }).lean();

    // Ensure jobs exist for each event's registered attendees.
    for (const event of events) {
      await ensureJobsForEvent(event);
    }

    // Dispatch any due jobs.
    await dispatchDueJobs();
  } catch (e) {
    console.error("[reminder] tick error:", e.message);
  } finally {
    isRunning = false;
  }
}

function startScheduler() {
  if (tickTimer) return; // Already started.
  console.log(`[reminder] scheduler starting (tick=${REMINDER_TICK_MS}ms, lookahead=${MAX_LOOKAHEAD_MIN}min, feedback lookback=${FEEDBACK_LOOKBACK_DAYS}d)`);
  // Run once immediately on startup.
  tick();
  // Then run on interval.
  tickTimer = setInterval(tick, REMINDER_TICK_MS);
  // Ensure the interval doesn't keep the process alive on shutdown.
  tickTimer.unref?.();
}

function stopScheduler() {
  if (tickTimer) {
    clearInterval(tickTimer);
    tickTimer = null;
    console.log("[reminder] scheduler stopped");
  }
}

module.exports = { startScheduler, stopScheduler, tick, ensureJobsForEvent };