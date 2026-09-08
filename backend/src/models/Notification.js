const mongoose = require("mongoose");

const notificationSchema = new mongoose.Schema(
  {
    recipient: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    type: {
      type: String,
      enum: [
        "registration",
        "reminder",
        "event-update",
        "system",
        "nearby-event",
        "new-event",
        "event_published",
        "check-in",
        // Cross-organization co-hosting: a new AI match, the partner org
        // accepting/declining, and the confirmed partnership.
        "collaboration",
      ],
      default: "system",
    },
    title: {
      type: String,
      required: true,
    },
    message: {
      type: String,
      required: true,
    },
    event: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Event",
    },
    // Deep-link target for the "View" action / detail page — a client-side
    // route the user can jump straight to (e.g. "/my-tickets"). Optional:
    // notifications without a link still open a detail page.
    link: {
      type: String,
    },
    // Free-form metadata for the detail view (e.g. ticket id, provider ref).
    data: {
      type: mongoose.Schema.Types.Mixed,
    },
    read: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

notificationSchema.index({ recipient: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, read: 1, createdAt: -1 });
notificationSchema.index({ recipient: 1, type: 1 });
notificationSchema.index({ event: 1, recipient: 1, type: 1 }, { unique: true, partialFilterExpression: { type: "new-event" } });

module.exports = mongoose.model("Notification", notificationSchema);
