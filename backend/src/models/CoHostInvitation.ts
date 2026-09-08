import mongoose, { Schema, Document, Types } from "mongoose";

// A request from one organization to another to co-host a specific event.
//
// Co-hosting hands the invited organization's admins real access to the
// event: the full attendee roster (names, emails, payment records), check-in,
// analytics and event details. That cannot be granted unilaterally, so this
// model makes the grant a two-party agreement — the invitation is created in
// "pending", and only an admin of the INVITED organization can move it to
// "accepted", which is the single moment the co-host link is written.
//
// This mirrors the consent model the AI suggestion flow already used
// (CollaborationSuggestion's statusA/statusB handshake). The manual path
// previously bypassed it entirely: the "Invite" button wrote straight into
// Event.coHostOrganizations, so an organization could be given another org's
// attendee data without agreeing to it, or even being told.
export interface ICoHostInvitation extends Document {
  event: Types.ObjectId;
  // Inviting side: the event's owning organization.
  fromOrganization: Types.ObjectId;
  // Invited side: whoever is being asked to co-host.
  toOrganization: Types.ObjectId;
  invitedBy: Types.ObjectId;
  // Optional note from the inviter ("we'd love to run the workshop track
  // together"). Context is what makes an invitation answerable — a bare
  // request with no reason is one the recipient can only guess at.
  message?: string;
  status?: "pending" | "accepted" | "declined" | "cancelled";
  // Who closed it and when — "cancelled" is the inviter withdrawing,
  // "declined" is the invited org saying no.
  respondedBy?: Types.ObjectId;
  respondedAt?: Date;
  // Optional reason supplied with a decline, shown back to the inviter.
  responseMessage?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const coHostInvitationSchema = new Schema<ICoHostInvitation>(
  {
    event: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      required: true,
    },
    // Inviting side: the event's owning organization.
    fromOrganization: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    // Invited side: whoever is being asked to co-host.
    toOrganization: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    invitedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    // Optional note from the inviter ("we'd love to run the workshop track
    // together"). Context is what makes an invitation answerable — a bare
    // request with no reason is one the recipient can only guess at.
    message: { type: String, default: "", maxlength: 1000 },
    status: {
      type: String,
      enum: ["pending", "accepted", "declined", "cancelled"],
      default: "pending",
    },
    // Who closed it and when — "cancelled" is the inviter withdrawing,
    // "declined" is the invited org saying no.
    respondedBy: { type: Schema.Types.ObjectId, ref: "User" },
    respondedAt: Date,
    // Optional reason supplied with a decline, shown back to the inviter.
    responseMessage: { type: String, default: "", maxlength: 1000 },
  },
  { timestamps: true }
);

// At most one OPEN invitation per (event, invited org). Partial so a
// declined or cancelled invitation doesn't block asking again later —
// circumstances change, and a "no" now shouldn't be permanent.
coHostInvitationSchema.index(
  { event: 1, toOrganization: 1 },
  { unique: true, partialFilterExpression: { status: "pending" } }
);
// Inbox lookup: "invitations awaiting my organization", newest first.
coHostInvitationSchema.index({ toOrganization: 1, status: 1, createdAt: -1 });
// Outbox lookup: "invitations this event has sent".
coHostInvitationSchema.index({ event: 1, createdAt: -1 });

const CoHostInvitation = mongoose.model<ICoHostInvitation>("CoHostInvitation", coHostInvitationSchema);
export default CoHostInvitation;

// CommonJS interop for require() compatibility
// @ts-ignore
module.exports = CoHostInvitation;
// @ts-ignore
module.exports.default = CoHostInvitation;
