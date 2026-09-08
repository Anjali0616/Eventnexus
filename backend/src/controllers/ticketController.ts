import { Request, Response } from "express";
import Event from "../models/Event";
import Ticket from "../models/Ticket";
import User from "../models/User";
import { verifyTicketToken } from "../utils/qrToken";
import { createNotification } from "./notificationController";
import { claimAndIssueTicket } from "../utils/ticketing";
import { canManageEvent } from "./eventController";
import { sendMail } from "../utils/email";
import { generateQRCodeDataURI } from "../utils/qrCode";

import { parsePagination, buildSearch, buildFilters, parseSort, paginate } from "../utils/query";

export const registerForEvent = async (req: Request, res: Response): Promise<void> => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) {
      return void res.status(404).json({ message: "Event not found" });
    }

    if (event.status === "Draft") {
      return void res.status(400).json({ message: "This event is not open for registration yet" });
    }
    if (new Date(event.date) <= new Date()) {
      return void res.status(400).json({ message: "This event has already started" });
    }

    if (event.price?.amount > 0) {
      return void res.status(400).json({
        message: "This event requires payment — use the checkout endpoint instead",
        requiresPayment: true,
      });
    }

    const existing = await Ticket.findOne({
      event: event._id,
      attendee: req.user._id,
      status: { $ne: "cancelled" },
    });
    if (existing) {
      return void res.status(400).json({ message: "Already registered for this event" });
    }

    let ticket;
    try {
      ticket = await claimAndIssueTicket({
        event,
        attendeeId: req.user._id,
        attendeeName: req.user.name,
        payment: { status: "none", amount: 0, currency: event.price?.currency || "NPR" },
      });
    } catch (error) {
      // The (event, attendee) partial unique index is the final backstop for
      // double-submits — two rapid clicks can both pass the existence check
      // above before either ticket lands. A duplicate-key race is surfaced
      // as the same clean 400 as the pre-check, never a 500.
      if (error?.code === 11000) {
        return void res.status(400).json({ message: "Already registered for this event" });
      }
      throw error;
    }

    // Send confirmation email with QR code
    try {
      const qrCodeDataUri = await generateQRCodeDataURI(ticket.qrToken);
      await sendMail({
        to: req.user.email,
        subject: `Registration confirmed: ${event.title}`,
        template: "ticket-confirmation",
        templateData: {
          name: req.user.name,
          eventTitle: event.title,
          eventDate: new Date(event.date).toLocaleDateString("en-US", { dateStyle: "full" }),
          eventTime: new Date(event.date).toLocaleTimeString("en-US", { timeStyle: "short" }),
          venue: event.venue || "TBA",
          eventType: event.type || "In-person",
          ticketType: event.price?.amount > 0 ? "Paid" : "Free",
          quantity: 1,
          orderId: ticket._id.toString().slice(-8).toUpperCase(),
          eventId: event._id,
          qrCodeUrl: qrCodeDataUri,
        },
        metadata: { ticketId: ticket._id, eventId: event._id },
      });
    } catch (mailErr) {
      console.error("[ticket] Failed to send confirmation email:", mailErr.message);
      // Don't fail the registration if email fails
    }

    res.status(201).json({ ticket });
  } catch (error) {
    const status = error.status || 500;
    const isOperational = status < 500;
    if (!isOperational) console.error("[error]", error);
    res.status(status).json({
      success: false,
      message: isOperational ? error.message : "Something went wrong. Please try again.",
      code: isOperational ? "OPERATIONAL_ERROR" : "INTERNAL_ERROR",
    });
  }
};

export const getMyTickets = async (req: Request, res: Response): Promise<void> => {
  try {
    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 12, maxLimit: 50 });
    const filter: any = {
      attendee: req.user._id,
      ...buildFilters(req.query, ["status"]),
    };

    // Role-aware time bucket (server-side, fixes pagination bug where client filtered only current page)
    const timeBucket = String(req.query.timeBucket || req.query.bucket || "").toLowerCase();
    if (timeBucket === "upcoming" || timeBucket === "past") {
      const now = new Date();
      const bucketEvents = await Event.find({
        date: timeBucket === "upcoming" ? { $gt: now } : { $lte: now },
      }).select("_id").lean();
      const bucketIds = bucketEvents.map((e) => e._id);
      // Intersect with existing event filter if any
      if (filter.event && filter.event.$in) {
        const existingSet = new Set(filter.event.$in.map(String));
        filter.event = { $in: bucketIds.filter((id) => existingSet.has(String(id))) };
      } else {
        filter.event = { $in: bucketIds };
      }
      // If no events match bucket, short-circuit to empty result with counts
      if (!filter.event.$in.length) {
        const counts = await getMyTicketsCounts(req.user._id);
        return void res.json({ tickets: [], pagination: { page, limit, total: 0, totalPages: 0 }, counts });
      }
    }

    // Search by event title — resolve matching event ids first, then scope
    // the ticket query to them (the event is a populated ref, not inline).
    const searchTerm = String(req.query.search || "").trim();
    if (searchTerm) {
      const safe = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rx = new RegExp(safe, "i");
      const events = await Event.find({ title: rx }).select("_id").lean();
      const searchIds = events.map((e) => e._id);
      if (filter.event && filter.event.$in) {
        const bucketSet = new Set(filter.event.$in.map(String));
        filter.event = { $in: searchIds.filter((id) => bucketSet.has(String(id))) };
      } else {
        filter.event = { $in: searchIds };
      }
    }

    // Provider filter (for history)
    if (req.query.provider && req.query.provider !== "all") {
      filter["payment.provider"] = req.query.provider;
    }

    const sort = parseSort(req.query.sort, ["createdAt", "payment.amount"], { createdAt: -1 });

    const { data, pagination } = await paginate(Ticket, {
      filter,
      page,
      limit,
      skip,
      sort,
      populate: "event",
    });

    // Global counts for header (not just current page)
    const counts = await getMyTicketsCounts(req.user._id);

    res.json({ tickets: data, pagination, counts });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
 }
};

// Helper for global counts (used by my-tickets header)
const getMyTicketsCounts = async (userId) => {
  try {
    const all = await Ticket.find({ attendee: userId }).populate("event", "date").lean();
    const now = Date.now();
    let upcoming = 0, past = 0, cancelled = 0, checkedIn = 0, valid = 0;
    for (const t of all) {
      if (t.status === "cancelled") cancelled++;
      else if (t.status === "checked-in") checkedIn++;
      else if (t.status === "valid") valid++;
      const ev = t.event;
// @ts-ignore
      const evDate = ev && ev.date ? new Date(ev.date).getTime() : null;
      if (evDate != null && !Number.isNaN(evDate)) {
        if (evDate > now) upcoming++;
        else past++;
      }
    }
    return { total: all.length, upcoming, past, cancelled, checkedIn, valid };
  } catch {
    return { total: 0, upcoming: 0, past: 0, cancelled: 0, checkedIn: 0, valid: 0 };
  }
};

// Attendee self-service cancellation: only their own ticket, only before the
// event starts, and only if it hasn't already been checked in.
export const cancelTicket = async (req: Request, res: Response): Promise<void> => {
  try {
    const ticket = await Ticket.findOne({
      _id: req.params.id,
      attendee: req.user._id,
    }).populate("event");

    if (!ticket) {
      return void res.status(404).json({ message: "Ticket not found" });
    }
    if (ticket.status === "cancelled") {
      return void res.status(400).json({ message: "Ticket is already cancelled" });
    }
    if (ticket.status === "checked-in") {
      return void res.status(400).json({ message: "Cannot cancel a ticket that's already checked in" });
    }
    if (ticket.payment?.status === "paid") {
      return void res.status(400).json({
        message: "Paid tickets can't be cancelled online — contact the organizer to arrange a refund.",
      });
    }
// @ts-ignore
    if (ticket.event && new Date(ticket.event.date) <= new Date()) {
      return void res.status(400).json({ message: "Cannot cancel — this event has already started" });
    }

    ticket.status = "cancelled";
    ticket.cancelledAt = new Date();
    await ticket.save();

    if (ticket.event) {
      await Event.updateOne(
        { _id: ticket.event._id, registered: { $gt: 0 } },
        { $inc: { registered: -1 } }
      );

// @ts-ignore
      await createNotification({
// @ts-ignore
        recipient: ticket.event.organizer,
        organization: ticket.organization,
        type: "registration",
        title: "Registration cancelled",
// @ts-ignore
        message: `${req.user.name} cancelled their registration for ${ticket.event.title}.`,
        event: ticket.event._id,
        link: "/organizer/tickets",
      });
    }

    res.json({ ticket });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

// Organizer/admin-only: validates the signed QR payload, confirms the ticket's
// event belongs to the caller's own organization, then marks it checked-in.
// This is what prevents forged tickets and cross-org check-ins.
export const verifyTicket = async (req: Request, res: Response): Promise<void> => {
  try {
    const { qrToken } = req.body;
    const payload = verifyTicketToken(qrToken);
    if (!payload) {
      return void res.status(400).json({ message: "Invalid or forged ticket" });
    }

    const ticket = await Ticket.findById(payload.ticketId).populate("event");
    if (!ticket || ticket.qrToken !== qrToken) {
      return void res.status(404).json({ message: "Ticket not found" });
    }
    if (String(ticket.event?._id || ticket.event) !== String(payload.eventId) || String(ticket.attendee) !== String(payload.attendeeId)) {
      return void res.status(400).json({ message: "Ticket payload mismatch" });
    }

    // System admin (admin without org) may check in any ticket platform-wide,
    // mirroring their event-management scope (canManageEvent). Co-host organization
    // admins may also check in tickets for events they co-host — ticket.organization
    // is the owning org, so a strict equality check would incorrectly deny co-hosts
    // who have legitimate attendee-list access (getEventAttendees uses canManageEvent).
    const isSystemAdmin = req.user.role === "admin" && !req.user.organization;
    if (isSystemAdmin) {
      // allowed — fall through
    } else if (!req.user.organization || !ticket.organization) {
      return void res.status(403).json({ message: "Check-in requires an organization on both ends" });
    } else if (ticket.organization.toString() !== req.user.organization.toString()) {
      // Check co-host relationship: if event's coHostOrganizations includes caller's org,
      // the caller is a managing party and may check in.
      if (ticket.event) {
        const callerOrg = req.user.organization.toString();
// @ts-ignore
        const isCoHost = Array.isArray(ticket.event.coHostOrganizations) &&
// @ts-ignore
          ticket.event.coHostOrganizations.some((oid) => oid.toString() === callerOrg);
        if (!isCoHost) {
          return void res.status(403).json({ message: "Ticket belongs to a different organization" });
        }
      } else {
        return void res.status(403).json({ message: "Ticket belongs to a different organization" });
      }
    }

// @ts-ignore
    if (ticket.event && ticket.event.status === "Draft") {
      return void res.status(400).json({ message: "This event isn't open yet — tickets can't be checked in" });
    }

    if (ticket.status === "checked-in") {
      return void res.status(400).json({ message: "Ticket already checked in" });
    }
    if (ticket.status === "cancelled") {
      return void res.status(400).json({ message: "Ticket has been cancelled" });
    }

    ticket.status = "checked-in";
    ticket.checkedInAt = new Date();
    ticket.checkedInBy = req.user._id;
    await ticket.save();

    // Real-time heads-up to the attendee the moment the door scanner pings
    // their QR — the in-app toast arrives while they're still in the queue.
    if (ticket.event) {
      await createNotification({
        recipient: ticket.attendee,
        organization: ticket.organization,
        type: "check-in",
        title: "You're checked in",
// @ts-ignore
        message: `You've been checked in for ${ticket.event.title}. Enjoy the event!`,
        event: ticket.event._id,
        link: "/my-tickets",
        data: { ticketId: ticket._id },
      });
    }

    res.json({ ticket });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

// Organizer/admin: full attendee roster for one of their own events, with
// check-in status so the Tickets & Check-in dashboard can show who's
// registered, who's arrived, and drill into each attendee's detail. Scoped
// by canManageEvent (owner or same-org admin) — never cross-tenant.
export const getEventAttendees = async (req: Request, res: Response): Promise<void> => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) {
      return void res.status(404).json({ message: "Event not found" });
    }
    if (!canManageEvent(event, req.user)) {
      return void res.status(403).json({ message: "Not authorized" });
    }

    const { page, limit, skip } = parsePagination(req.query, {
      defaultLimit: 50,
      maxLimit: 200,
    });

    const filter: any = {
      event: event._id,
      ...buildFilters(req.query, ["status"]),
    };

    // Payment-status filter ("paid" / "pending" / "refunded" / "none") —
    // buildFilters is column-agnostic so it would treat "payment.status" as
    // an unknown equality field; wire it explicitly.
    if (req.query.paymentStatus && req.query.paymentStatus !== "all") {
      filter["payment.status"] = req.query.paymentStatus;
    }

    // Search by attendee name/email — resolve matching user ids first, then
    // scope the ticket query to them (attendee is a populated ref).
    const searchTerm = String(req.query.search || "").trim();
    if (searchTerm) {
      const safe = searchTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rx = new RegExp(safe, "i");
      const users = await User.find({ $or: [{ name: rx }, { email: rx }] })
        .select("_id")
        .lean();
      filter.attendee = { $in: users.map((u) => u._id) };
    }

    const { data: tickets, pagination } = await paginate(Ticket, {
      filter,
      page,
      limit,
      skip,
      sort: { createdAt: 1 },
      populate: { path: "attendee", select: "name email" },
    });

    const attendees = tickets.map((t) => ({
      ticketId: t._id,
      status: t.status,
      registeredAt: t.createdAt,
      checkedInAt: t.checkedInAt,
      cancelledAt: t.cancelledAt,
      payment: {
        status: t.payment?.status ?? "none",
        provider: t.payment?.provider ?? "none",
        amount: t.payment?.amount ?? 0,
        currency: t.payment?.currency ?? "NPR",
        amountRefunded: t.payment?.amountRefunded ?? 0,
        // Masked provider reference so ledger entries stay traceable without
        // leaking the full Stripe/eSewa transaction id in list views.
        ref: t.payment?.stripePaymentIntentId || t.payment?.esewaRefId || t.payment?.stripeSessionId || null,
      },
      attendee: t.attendee,
    }));

    // Event-level counts (unaffected by page/search so the header stats stay
    // stable while the roster below filters).
    const [total, checkedIn, cancelled, paidByCurrency, pendingByCurrency, refundedByCurrency, noneCount] =
      await Promise.all([
        Ticket.countDocuments({ event: event._id }),
        Ticket.countDocuments({ event: event._id, status: "checked-in" }),
        Ticket.countDocuments({ event: event._id, status: "cancelled" }),
        Ticket.aggregate([
          { $match: { event: event._id, status: { $ne: "cancelled" }, "payment.status": "paid" } },
          { $group: { _id: "$payment.currency", count: { $sum: 1 }, amount: { $sum: "$payment.amount" } } },
        ]),
        Ticket.aggregate([
          { $match: { event: event._id, status: { $ne: "cancelled" }, "payment.status": "pending" } },
          { $group: { _id: "$payment.currency", count: { $sum: 1 }, amount: { $sum: "$payment.amount" } } },
        ]),
        Ticket.aggregate([
          { $match: { event: event._id, "payment.status": "refunded" } },
          { $group: { _id: "$payment.currency", count: { $sum: 1 }, amount: { $sum: { $ifNull: ["$payment.amountRefunded", 0] } } } },
        ]),
        Ticket.countDocuments({ event: event._id, status: { $ne: "cancelled" }, "payment.status": "none" }),
      ]);
    // For backward compat, keep single-currency totals as sum (but also expose byCurrency for correct display)
    const sumAgg = (arr) => arr.reduce((acc, cur) => ({ count: acc.count + cur.count, amount: acc.amount + cur.amount }), { count: 0, amount: 0 });
    const paid = sumAgg(paidByCurrency);
    const pending = sumAgg(pendingByCurrency);
    const refunded = sumAgg(refundedByCurrency);
    const byCurrency = (arr) => {
      const out = {};
      for (const r of arr) {
        const cur = r._id || "NPR";
        out[cur] = { count: r.count, amount: r.amount };
      }
      return out;
    };
    const counts = {
      total,
      checkedIn,
      valid: total - checkedIn - cancelled,
      cancelled,
      // Payment ledger summary for the header strip (free tickets = "none").
      revenue: {
        paid: paid.count,
        paidAmount: paid.amount,
        pending: pending.count,
        pendingAmount: pending.amount,
        refunded: refunded.count,
        refundedAmount: refunded.amount,
        free: noneCount,
        byCurrency: {
          paid: byCurrency(paidByCurrency),
          pending: byCurrency(pendingByCurrency),
          refunded: byCurrency(refundedByCurrency),
        },
      },
    };

    res.json({
      event: {
        _id: event._id,
        title: event.title,
        date: event.date,
        capacity: event.capacity,
        registered: event.registered,
      },
      attendees,
      counts,
      pagination,
    });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

const _controllerExports = { registerForEvent, getMyTickets, cancelTicket, verifyTicket, getEventAttendees };
export default _controllerExports;
// CJS interop for require() - keep compatibility
// @ts-ignore
module.exports = _controllerExports;
// @ts-ignore
module.exports.default = _controllerExports;