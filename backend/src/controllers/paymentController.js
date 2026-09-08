const Stripe = require("stripe");
const Event = require("../models/Event");
const Ticket = require("../models/Ticket");
const User = require("../models/User");
const { issueTicketOnce } = require("../utils/ticketing");
const { createNotification } = require("./notificationController");
const { sendMail } = require("../utils/email");
const { generateQRCodeDataURI } = require("../utils/qrCode");
const { nprToUsd, NPR_USD_RATE } = require("../utils/currency");
const esewa = require("../utils/esewa");

// Payments are entirely optional: the app runs fine with STRIPE_SECRET_KEY
// unset (free events work as before), it just returns a clear 503 for the
// checkout endpoint until a real key is configured.
const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const FRONTEND_URL = (process.env.FRONTEND_URL || "http://localhost:3000").split(",")[0].trim().replace(/\/$/, "");
const BACKEND_URL = (process.env.BACKEND_URL || process.env.API_BASE_URL || "").split(",")[0].trim().replace(/\/$/, "") || null;

// eSewa is always available: unlike Stripe it needs no live secret key to
// exercise end-to-end, since utils/esewa.js falls back to eSewa's own
// published UAT/sandbox test credentials when ESEWA_SECRET_KEY isn't set.
const getPaymentConfig = (req, res) => {
  res.json({
    enabled: !!stripe,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
    esewaEnabled: true,
    nprUsdRate: NPR_USD_RATE,
  });
};

const createCheckoutSession = async (req, res) => {
  try {
    if (!stripe) {
      return res.status(503).json({
        message: "Payments are not configured on this server (missing STRIPE_SECRET_KEY)",
      });
    }

    const event = await Event.findById(req.params.id);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }
    if (event.status === "Draft") {
      return res.status(400).json({ message: "This event is not open for registration yet" });
    }
    if (new Date(event.date) <= new Date()) {
      return res.status(400).json({ message: "This event has already started" });
    }
    if (!event.price?.amount || event.price.amount <= 0) {
      return res.status(400).json({ message: "This event is free — register directly instead" });
    }
    if (event.registered >= event.capacity) {
      return res.status(400).json({ message: "Event is at full capacity" });
    }

    const existing = await Ticket.findOne({
      event: event._id,
      attendee: req.user._id,
      status: { $ne: "cancelled" },
    });
    if (existing) {
      return res.status(400).json({ message: "Already registered for this event" });
    }

    // Stripe can't settle in NPR, so an NPR-priced event is billed to the
    // card in a converted USD amount instead of failing outright — the
    // event's own listed price (and everything else about it) stays in NPR.
    const originalCurrency = (event.price.currency || "USD").toUpperCase();
    const isNpr = originalCurrency === "NPR";
    const chargeCurrency = isNpr ? "usd" : originalCurrency.toLowerCase();
    const chargeAmount = isNpr ? nprToUsd(event.price.amount) : event.price.amount;

    // Idempotency: prevent double Stripe sessions on retry/double-click (S4)
    const crypto = require("crypto");
    const idempotencyKey = crypto
      .createHash("sha256")
      .update(`${event._id.toString()}:${req.user._id.toString()}:${event.price.amount}:${event.price.currency || "NPR"}`)
      .digest("hex")
      .slice(0, 32);
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        payment_method_types: ["card"],
        customer_email: req.user.email,
        line_items: [
          {
            price_data: {
              currency: chargeCurrency,
              product_data: {
                name: event.title.slice(0, 100),
                description: (isNpr
                  ? `Ticket for ${event.title} on ${new Date(event.date).toDateString()} (converted from Rs. ${event.price.amount})`
                  : `Ticket for ${event.title} on ${new Date(event.date).toDateString()}`
                ).slice(0, 500),
              },
              unit_amount: Math.round(chargeAmount * 100),
            },
            quantity: 1,
          },
        ],
        metadata: {
          eventId: event._id.toString(),
          attendeeId: req.user._id.toString(),
          expectedAmount: String(Math.round(chargeAmount * 100)),
          expectedCurrency: chargeCurrency,
        },
        success_url: `${FRONTEND_URL}/checkout/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${FRONTEND_URL}/events/${event._id}?checkout=cancelled`,
        client_reference_id: req.user._id.toString(),
      },
      { idempotencyKey }
    );

    res.json({ url: session.url, chargeAmount, chargeCurrency: chargeCurrency.toUpperCase() });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

// Confirms a completed Checkout Session for the frontend's success page —
// the ticket itself is only ever created by the webhook below (the source of
// truth for "payment actually happened"), so this just reports status.
const getCheckoutStatus = async (req, res) => {
  try {
    if (!stripe) {
      return res.status(503).json({ message: "Payments are not configured on this server" });
    }
    const session = await stripe.checkout.sessions.retrieve(req.params.sessionId);
    if (session.metadata?.attendeeId !== req.user._id.toString()) {
      return res.status(403).json({ message: "Not authorized to view this session" });
    }
    const ticket = await Ticket.findOne({ "payment.stripeSessionId": session.id }).populate("event");
    res.json({ paid: session.payment_status === "paid", ticket: ticket || null });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

// Mounted with express.raw() (see server.js) so req.body is the raw buffer
// Stripe needs to verify the webhook signature — issuing a ticket only ever
// happens here, never from the client-side "success" redirect, so a user
// can't fake a paid ticket by hitting the success URL directly.
const handleWebhook = async (req, res) => {
  if (!stripe) return res.status(503).end();

  // Signature verification is mandatory — without STRIPE_WEBHOOK_SECRET the
  // endpoint must refuse to run, otherwise anyone could POST a forged
  // checkout.session.completed event and mint free tickets. (The previous
  // JSON.parse fallback silently skipped verification.)
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    return res
      .status(400)
      .json({ message: "Stripe webhook secret is not configured on this server" });
  }

  let event;
  try {
    const signature = req.headers["stripe-signature"];
    event = stripe.webhooks.constructEvent(
      req.body,
      signature,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (error) {
    return res.status(400).json({ message: `Webhook signature verification failed: ${error.message}` });
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const { eventId, attendeeId } = session.metadata || {};

    // checkout.session.completed also fires for sessions whose payment
    // ended up "unpaid"/"processing" (async payment methods, later
    // failures). Issuing a ticket in those cases would mint free tickets —
    // only "paid" counts.
    if (session.payment_status !== "paid") {
      console.error(
        `[stripe webhook] ignoring ${event.type} for session ${session.id} with payment_status "${session.payment_status}"`
      );
      return res.json({ received: true });
    }

    if (!eventId || !attendeeId) {
      console.error(`[stripe webhook] session ${session.id} has no eventId/attendeeId metadata`);
      return res.json({ received: true });
    }

    try {
      const [eventDoc, attendee] = await Promise.all([
        Event.findById(eventId),
        User.findById(attendeeId),
      ]);

      if (eventDoc && attendee) {
        // Idempotent: a webhook retry for the same session finds the ticket
        // already issued and returns it instead of failing on the unique index.
        const ticket = await issueTicketOnce({
          event: eventDoc,
          attendeeId,
          attendeeName: attendee.name,
          payment: {
            status: "paid",
            provider: "stripe",
            amount: (session.amount_total || 0) / 100,
            currency: (session.currency || "usd").toUpperCase(),
            stripeSessionId: session.id,
            stripePaymentIntentId: session.payment_intent,
          },
        });

        // Send confirmation email with QR code
        try {
          const qrCodeDataUri = await generateQRCodeDataURI(ticket.qrToken);
          await sendMail({
            to: attendee.email,
            subject: `Registration confirmed: ${eventDoc.title}`,
            template: "ticket-confirmation",
            templateData: {
              name: attendee.name,
              eventTitle: eventDoc.title,
              eventDate: new Date(eventDoc.date).toLocaleDateString("en-US", { dateStyle: "full" }),
              eventTime: new Date(eventDoc.date).toLocaleTimeString("en-US", { timeStyle: "short" }),
              venue: eventDoc.venue || "TBA",
              eventType: eventDoc.type || "In-person",
              ticketType: "Paid",
              quantity: 1,
              orderId: ticket._id.toString().slice(-8).toUpperCase(),
              eventId: eventDoc._id,
              qrCodeUrl: qrCodeDataUri,
            },
            metadata: { ticketId: ticket._id, eventId: eventDoc._id, stripeSessionId: session.id },
          });
        } catch (mailErr) {
          console.error("[stripe webhook] Failed to send confirmation email:", mailErr.message);
        }
      }
    } catch (error) {
      console.error("[stripe webhook] failed to issue ticket:", error.message);
    }
  }

  // Full refund: the ticket's payment is marked refunded and the ticket
  // itself cancelled (releasing its capacity slot) so the attendee can't
  // walk in with a QR for a purchase that was reversed. The refunded status
  // existed on the model but nothing ever set it — refunds used to leave
  // the ticket valid indefinitely. Partial refunds (amount_refunded <
  // amount) only update the payment record; the ticket stays usable.
  if (event.type === "charge.refunded") {
    const charge = event.data.object;
    const paymentIntentId = charge.payment_intent;

    try {
      const ticket = await Ticket.findOne({
        "payment.stripePaymentIntentId": paymentIntentId,
      }).populate("event");

      if (!ticket) {
        console.error(`[stripe webhook] no ticket found for payment intent ${paymentIntentId}`);
        return res.json({ received: true });
      }

      const fullyRefunded =
        Number(charge.amount_refunded) >= Number(charge.amount_captured || charge.amount);

      if (ticket.payment.status === "refunded" || ticket.status === "cancelled") {
        // Idempotent — Stripe may deliver the same refund more than once.
        return res.json({ received: true });
      }

      ticket.payment.status = "refunded";
      ticket.payment.amountRefunded = Number(charge.amount_refunded) / 100;

      if (fullyRefunded && ticket.status !== "checked-in") {
        ticket.status = "cancelled";
        ticket.cancelledAt = new Date();
        if (ticket.event) {
          await Event.updateOne(
            { _id: ticket.event._id, registered: { $gt: 0 } },
            { $inc: { registered: -1 } }
          );
          await createNotification({
            recipient: ticket.attendee,
            organization: ticket.organization,
            type: "registration",
            title: "Payment refunded",
            message: `Your payment for ${ticket.event.title} was refunded and your ticket cancelled.`,
            event: ticket.event._id,
            link: "/my-tickets",
          });
        }
      }

      await ticket.save();
    } catch (error) {
      console.error("[stripe webhook] failed to process refund:", error.message);
    }
  }

  res.json({ received: true });
};

// eSewa checkout is initiated by the browser auto-submitting a real HTML
// form (not fetch) directly to eSewa's gateway, so this just returns the
// signed field set for the frontend to POST — mirroring how Stripe's
// session.url is handed back for a full-page redirect.
const initiateEsewaPayment = async (req, res) => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) {
      return res.status(404).json({ message: "Event not found" });
    }
    if (event.status === "Draft") {
      return res.status(400).json({ message: "This event is not open for registration yet" });
    }
    if (new Date(event.date) <= new Date()) {
      return res.status(400).json({ message: "This event has already started" });
    }
    if (!event.price?.amount || event.price.amount <= 0) {
      return res.status(400).json({ message: "This event is free — register directly instead" });
    }
    if (event.registered >= event.capacity) {
      return res.status(400).json({ message: "Event is at full capacity" });
    }

    const existing = await Ticket.findOne({
      event: event._id,
      attendee: req.user._id,
      status: { $ne: "cancelled" },
    });
    if (existing) {
      return res.status(400).json({ message: "Already registered for this event" });
    }

    // eSewa only supports NPR — reject non-NPR events early
    const currency = (event.price.currency || "NPR").toUpperCase();
    if (currency !== "NPR") {
      return res.status(400).json({ message: "eSewa only supports NPR events — use card payment for this event" });
    }

    const baseUrl = BACKEND_URL || `${req.protocol}://${req.get("host")}`;
    const { action, fields } = esewa.buildPaymentForm({
      amount: event.price.amount,
      eventId: event._id.toString(),
      attendeeId: req.user._id.toString(),
      // eventId in the path so the frontend can offer a "pay with card
      // instead" fallback on failure/cancel without needing to decode
      // eSewa's signed payload (which doesn't exist for a plain cancel).
      successUrl: `${baseUrl}/api/payments/esewa/success/${event._id}`,
      failureUrl: `${baseUrl}/api/payments/esewa/failure/${event._id}`,
    });

    res.json({ action, fields });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

// eSewa redirects the browser here (GET, unauthenticated — the user's
// session cookie/JWT isn't sent along) with a base64 `data` query param.
// Ticket issuance only ever happens after (a) verifying that payload's
// signature and (b) an independent server-to-server status check against
// eSewa's API — never from the redirect alone — the same "redirect is not
// proof of payment" principle the Stripe webhook above is built on.
// Confirms an eSewa callback payload and issues the ticket if — and only if
// — eSewa's own status API says the money was actually taken.
//
// Shared by BOTH the success and failure callbacks. eSewa does not reliably
// send a completed payment to success_url: a redirect can land on
// failure_url after the charge has already been captured (network hiccup,
// the user backing out of the final screen, or eSewa's own routing). The
// failure handler used to discard the payload and hard-code
// "cancelled", so in that case the attendee was charged and silently got
// nothing — the worst possible outcome in a payment flow. Running the same
// verification on both paths means a real payment can never be thrown away,
// whichever URL eSewa happens to choose.
//
// Returns { ok: true, ticket } or { ok: false, reason }.
const confirmEsewaPayment = async (raw, source) => {
  if (!raw) return { ok: false, reason: "missing_data" };

  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(String(raw), "base64").toString("utf-8"));
  } catch {
    return { ok: false, reason: "invalid_data" };
  }

  console.log(
    `[esewa:${source}] uuid=${decoded.transaction_uuid} status=${decoded.status} amount=${decoded.total_amount}`
  );

  // Signature proves the payload came from eSewa untampered.
  if (!esewa.verifyResponse(decoded)) {
    console.error(`[esewa:${source}] signature verification FAILED`);
    return { ok: false, reason: "signature" };
  }

  const { eventId, attendeeId } = esewa.parseTransactionUuid(decoded.transaction_uuid);
  if (!eventId || !attendeeId) return { ok: false, reason: "bad_transaction" };

  // Source of truth: ask eSewa directly. The redirect itself is never proof
  // of payment (same principle as the Stripe webhook above), and it's what
  // lets the failure path still recognise a genuinely completed payment.
  let statusCheck;
  try {
    statusCheck = await esewa.checkStatus({
      transactionUuid: decoded.transaction_uuid,
      totalAmount: decoded.total_amount,
    });
  } catch (error) {
    console.error(`[esewa:${source}] status check errored:`, error.message);
    return { ok: false, reason: "unconfirmed" };
  }

  console.log(`[esewa:${source}] status API says: ${statusCheck?.status}`);
  if (statusCheck?.status !== "COMPLETE") {
    // Surface eSewa's own wording rather than inventing one, so the UI can
    // tell "you cancelled" apart from "it's still pending".
    const real = String(statusCheck?.status || decoded.status || "unconfirmed").toLowerCase();
    return { ok: false, reason: real };
  }

  const [eventDoc, attendee] = await Promise.all([
    Event.findById(eventId),
    User.findById(attendeeId),
  ]);
  if (!eventDoc || !attendee) return { ok: false, reason: "not_found" };

  // Cross-check amount matches event price to prevent underpayment via
  // tampered signed payload + UAT secret. Use integer paisa to avoid float issues.
  const decodedAmount = esewa.toAmountNumber(decoded.total_amount);
  const expectedAmount = Number(eventDoc.price?.amount);
  if (!Number.isFinite(decodedAmount) || !Number.isFinite(expectedAmount)) {
    console.error(`[esewa:${source}] amount invalid: decoded=${decodedAmount} expected=${expectedAmount}`);
    return { ok: false, reason: "amount_mismatch" };
  }
  if (Math.round(decodedAmount * 100) !== Math.round(expectedAmount * 100)) {
    console.error(`[esewa:${source}] amount mismatch: decoded=${decodedAmount} expected=${expectedAmount}`);
    return { ok: false, reason: "amount_mismatch" };
  }

  let ticket = await Ticket.findOne({
    event: eventId,
    attendee: attendeeId,
    status: { $ne: "cancelled" },
  });

  if (!ticket) {
    // Idempotent: a duplicated eSewa callback (or the same payment arriving
    // on both callbacks) returns the already-issued ticket instead of
    // erroring on the unique index.
    ticket = await issueTicketOnce({
      event: eventDoc,
      attendeeId,
      attendeeName: attendee.name,
      payment: {
        status: "paid",
        provider: "esewa",
        // Normalized via the same helper the status check uses — eSewa
        // echoes four-figure amounts with a thousands separator, and a raw
        // Number("1,792.0") would store NaN on the ticket.
        amount: esewa.toAmountNumber(decoded.total_amount),
        currency: "NPR",
        esewaTransactionUuid: decoded.transaction_uuid,
        esewaRefId: statusCheck.ref_id || decoded.transaction_code,
      },
    });
    console.log(`[esewa:${source}] ticket issued: ${ticket._id}`);

    // Confirmation email with QR — only on first issue, so a duplicate
    // callback doesn't email the attendee twice.
    try {
      const qrCodeDataUri = await generateQRCodeDataURI(ticket.qrToken);
      await sendMail({
        to: attendee.email,
        subject: `Registration confirmed: ${eventDoc.title}`,
        template: "ticket-confirmation",
        templateData: {
          name: attendee.name,
          eventTitle: eventDoc.title,
          eventDate: new Date(eventDoc.date).toLocaleDateString("en-US", { dateStyle: "full" }),
          eventTime: new Date(eventDoc.date).toLocaleTimeString("en-US", { timeStyle: "short" }),
          venue: eventDoc.venue || "TBA",
          eventType: eventDoc.type || "In-person",
          ticketType: "Paid",
          quantity: 1,
          orderId: ticket._id.toString().slice(-8).toUpperCase(),
          eventId: eventDoc._id,
          qrCodeUrl: qrCodeDataUri,
        },
        metadata: { ticketId: ticket._id, eventId: eventDoc._id, provider: "esewa" },
      });
    } catch (mailErr) {
      console.error("[esewa] Failed to send confirmation email:", mailErr.message);
    }
  } else {
    console.log(`[esewa:${source}] ticket already existed: ${ticket._id}`);
  }

  return { ok: true, ticket };
};

const handleEsewaSuccess = async (req, res) => {
  const rawEventId = req.params.eventId;
  const eventIdParam = rawEventId && /^[0-9a-fA-F]{24}$/.test(String(rawEventId)) ? `&eventId=${encodeURIComponent(String(rawEventId))}` : "";
  try {
    const result = await confirmEsewaPayment(req.query.data, "success");
    if (result.ok) {
      return res.redirect(
        `${FRONTEND_URL}/checkout/success?provider=esewa&ticketId=${encodeURIComponent(String(result.ticket._id))}`
      );
    }
    res.redirect(
      `${FRONTEND_URL}/checkout/success?provider=esewa&error=${encodeURIComponent(String(result.reason))}${eventIdParam}`
    );
  } catch (error) {
    console.error("[esewa] success handling failed:", error.message);
    res.redirect(`${FRONTEND_URL}/checkout/success?provider=esewa&error=server${eventIdParam}`);
  }
};

// eSewa redirects here when it considers the payment unsuccessful — but it
// is NOT taken at its word. The payload is verified and the status API
// queried exactly as on the success path, because a captured payment can
// still land here; if the money really was taken, the ticket is issued and
// the attendee is sent to the success screen. Only a genuinely unpaid
// transaction reports a failure, and it reports eSewa's actual reason rather
// than always claiming the user cancelled.
const handleEsewaFailure = async (req, res) => {
  const rawEventId = req.params.eventId;
  const eventIdParam = rawEventId && /^[0-9a-fA-F]{24}$/.test(String(rawEventId)) ? `&eventId=${encodeURIComponent(String(rawEventId))}` : "";
  try {
    if (req.query.data) {
      const result = await confirmEsewaPayment(req.query.data, "failure");
      if (result.ok) {
        console.warn(
          "[esewa:failure] eSewa sent a COMPLETED payment to failure_url — ticket issued anyway"
        );
        return res.redirect(
          `${FRONTEND_URL}/checkout/success?provider=esewa&ticketId=${encodeURIComponent(String(result.ticket._id))}`
        );
      }
      return res.redirect(
        `${FRONTEND_URL}/checkout/success?provider=esewa&error=${encodeURIComponent(String(result.reason))}${eventIdParam}`
      );
    }
    // No payload at all — genuinely nothing to verify (the user backed out
    // before eSewa produced a transaction).
    console.log("[esewa:failure] no data payload — treating as cancelled");
    res.redirect(`${FRONTEND_URL}/checkout/success?provider=esewa&error=cancelled${eventIdParam}`);
  } catch (error) {
    console.error("[esewa] failure handling failed:", error.message);
    res.redirect(`${FRONTEND_URL}/checkout/success?provider=esewa&error=server${eventIdParam}`);
  }
};

module.exports = {
  getPaymentConfig,
  createCheckoutSession,
  getCheckoutStatus,
  handleWebhook,
  initiateEsewaPayment,
  handleEsewaSuccess,
  handleEsewaFailure,
};
