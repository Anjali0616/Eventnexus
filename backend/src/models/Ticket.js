const mongoose = require("mongoose");

const ticketSchema = new mongoose.Schema(
  {
    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
      required: true,
    },
    attendee: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    qrToken: {
      type: String,
      required: true,
      unique: true,
    },
    // Derived mirror of status used ONLY by the uniqueness index below.
    // Atlas/MongoDB partial indexes don't support {$ne: ...} filters, so a
    // status-based partial filter ("everything but cancelled") cannot be
    // expressed — instead the pre-save hook keeps `active` in sync and the
    // partial index keys on { active: true } (equality is supported).
    active: {
      type: Boolean,
      default: true,
    },
    status: {
      type: String,
      enum: ["valid", "checked-in", "cancelled"],
      default: "valid",
    },
    checkedInAt: {
      type: Date,
    },
    checkedInBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    cancelledAt: {
      type: Date,
    },
    payment: {
      status: {
        type: String,
        enum: ["none", "pending", "paid", "refunded"],
        default: "none",
      },
      // Which rail actually took the payment — "none" for free events. The
      // amount/currency below reflect what was actually charged (e.g. a
      // Stripe payment on an NPR event is charged in converted USD), while
      // the event's own price stays the source of truth for its listed NPR
      // price.
      provider: {
        type: String,
        enum: ["none", "stripe", "esewa"],
        default: "none",
      },
      amount: { type: Number, default: 0 },
      currency: { type: String, default: "NPR" },
      stripeSessionId: { type: String },
      stripePaymentIntentId: { type: String },
      amountRefunded: { type: Number },
      esewaTransactionUuid: { type: String },
      esewaRefId: { type: String },
    },
  },
  { timestamps: true }
);

// One live ticket per attendee per event. Cancelled tickets are excluded so
// a user can cancel and re-register (or re-purchase) for the same event —
// the old (event, attendee) unique index made re-registration after a cancel
// fail with a duplicate-key error. `active` mirrors "status !== cancelled".
ticketSchema.index(
  { event: 1, attendee: 1 },
  { unique: true, partialFilterExpression: { active: true } }
);
ticketSchema.index({ attendee: 1, createdAt: -1 });
ticketSchema.index({ event: 1, attendee: 1 });
ticketSchema.index({ attendee: 1, status: 1 });
ticketSchema.index({ event: 1, status: 1 });
ticketSchema.index({ "payment.stripeSessionId": 1 }, { sparse: true });
ticketSchema.index({ "payment.stripePaymentIntentId": 1 }, { sparse: true });
ticketSchema.index({ "payment.esewaTransactionUuid": 1 }, { sparse: true });
ticketSchema.index({ "payment.esewaRefId": 1 }, { sparse: true });
ticketSchema.index({ "payment.status": 1 });
ticketSchema.index({ "payment.provider": 1 });

ticketSchema.pre("save", function (next) {
  this.active = this.status !== "cancelled";
  next();
});

module.exports = mongoose.model("Ticket", ticketSchema);
