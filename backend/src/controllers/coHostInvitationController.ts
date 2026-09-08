import { Request, Response } from "express";
import CoHostInvitation from "../models/CoHostInvitation";
import Event from "../models/Event";
import Organization from "../models/Organization";
import User from "../models/User";
import { canManageEvent } from "./eventController";
import { createNotification } from "./notificationController";
import { sendMail } from "../utils/email";
import { audit } from "../utils/audit";
import { parsePagination, paginate } from "../utils/query";

const POPULATE = [
  { path: "event", select: "title date venue category type status capacity organization" },
  { path: "fromOrganization", select: "name city country" },
  { path: "toOrganization", select: "name city country" },
  { path: "invitedBy", select: "name email" },
];

// Reach every active admin of an organization, in-app AND by email.
//
// createNotification only writes the bell/notification row and emits a
// socket event — it does not send mail. An invitation that needs a human
// decision can't rely on the recipient happening to have the app open, so
// anything actionable here also goes out over email (`mail`), while purely
// informational updates stay in-app only.
//
// Fire-and-forget: a failed notification or a down SMTP server must never
// roll back an invitation decision that is already committed.
const notifyOrgAdmins = async ({ organization, excludeUser, mail, ...payload }) => {
  try {
    const admins = await User.find({
      organization,
      role: "org_admin",
      active: { $ne: false },
      ...(excludeUser ? { _id: { $ne: excludeUser } } : {}),
    })
      .select("_id name email")
      .lean();

    await Promise.all(
      admins.flatMap((a) => {
        const jobs = [
// @ts-ignore
          createNotification({
            recipient: a._id,
            organization,
            type: "collaboration",
            link: "/admin/collaboration",
            ...payload,
          }),
        ];
        if (mail && a.email) {
          jobs.push(
            sendMail({
              to: a.email,
              subject: mail.subject,
              template: mail.template,
              templateData: { name: a.name, ...mail.templateData },
              // Plain-text fallback so the message is still readable if the
              // template can't render.
              text: mail.text,
              metadata: { kind: "cohost-invitation", organization: String(organization) },
            }).catch((err) => console.error("[co-host invite] mail failed:", err.message))
          );
        }
        return jobs;
      })
    );
  } catch (error) {
    console.error("[co-host invite] notify failed:", error.message);
  }
};

// --- Inviting side -----------------------------------------------------------

// Send a co-host invitation for an event. Creates a PENDING request only —
// the co-host link itself is written exclusively by respondToInvitation
// below, when the invited organization accepts.
export const createInvitation = async (req: Request, res: Response): Promise<void> => {
  try {
    const { organizationId, message } = req.body;
    const event = await Event.findById(req.params.id);
    if (!event) return void res.status(404).json({ message: "Event not found" });
    if (!canManageEvent(event, req.user)) {
      return void res.status(403).json({ message: "Not authorized to manage this event" });
    }
    if (String(event.organization) === String(organizationId)) {
      return void res.status(400).json({ message: "The owning organization is already hosting this event" });
    }
    if (event.coHostOrganizations?.some((oid) => String(oid) === String(organizationId))) {
      return void res.status(400).json({ message: "That organization is already a co-host" });
    }

    // Only a real, approved tenant can be invited — inviting a pending or
    // suspended organization would grant attendee data to an account the
    // platform hasn't vetted.
    const target = await Organization.findById(organizationId).select("name status").lean();
    if (!target) return void res.status(404).json({ message: "Organization not found" });
    if (target.status !== "active") {
      return void res.status(400).json({ message: "That organization is not active and cannot be invited" });
    }

    const existing = await CoHostInvitation.findOne({
      event: event._id,
      toOrganization: organizationId,
      status: "pending",
    }).lean();
    if (existing) {
      return void res.status(409).json({ message: "An invitation is already pending with that organization" });
    }

    const invitation = await CoHostInvitation.create({
      event: event._id,
      fromOrganization: event.organization,
      toOrganization: organizationId,
      invitedBy: req.user._id,
      message: (message || "").trim(),
    });

    const fromOrg = await Organization.findById(event.organization).select("name").lean();
    const fromName = fromOrg?.name || "An organization";
    const eventDate = new Date(event.date).toLocaleDateString("en-US", {
      dateStyle: "full",
    });
// @ts-ignore
    await notifyOrgAdmins({
      organization: organizationId,
      title: "Co-host invitation received",
      message: `${fromName} invited you to co-host "${event.title}". Review and respond.`,
      event: event._id,
      data: { invitationId: invitation._id },
      // Actionable and time-sensitive — the other org can't proceed until
      // someone here answers, so this one is emailed as well as in-app.
      mail: {
        subject: `${fromName} invited you to co-host "${event.title}"`,
        template: "cohost-invitation",
        templateData: {
          fromOrgName: fromName,
          toOrgName: target.name,
          eventTitle: event.title,
          eventDate,
          venue: event.venue,
          capacity: event.capacity,
          message: invitation.message,
          invitedByName: req.user.name,
        },
        text:
          `${fromName} invited your organization to co-host "${event.title}" on ${eventDate} at ${event.venue}.` +
          (invitation.message ? `\n\nMessage: "${invitation.message}"` : "") +
          `\n\nReview and respond: ${String(process.env.FRONTEND_URL || "http://localhost:3000").split(",")[0].trim().replace(/\/$/, "")}/admin/collaboration`,
      },
    });

    audit({
      req,
      action: "cohost_invitation_sent",
      resourceType: "CoHostInvitation",
      resourceId: invitation._id,
      metadata: { event: String(event._id), to: String(organizationId) },
    });

    const populated = await CoHostInvitation.findById(invitation._id).populate(POPULATE);
    res.status(201).json({ invitation: populated });
  } catch (error) {
    // The partial unique index is the real race guard — two simultaneous
    // invites to the same org resolve to one, not a duplicate pair.
    if (error?.code === 11000) {
      return void res.status(409).json({ message: "An invitation is already pending with that organization" });
    }
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

// Invitations this event has sent (any status), for the inviter's view.
export const listEventInvitations = async (req: Request, res: Response): Promise<void> => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) return void res.status(404).json({ message: "Event not found" });
    if (!canManageEvent(event, req.user)) {
      return void res.status(403).json({ message: "Not authorized to manage this event" });
    }
    const invitations = await CoHostInvitation.find({ event: event._id })
      .sort({ createdAt: -1 })
      .populate(POPULATE);
    res.json({ invitations });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

// Withdraw a still-pending invitation.
export const cancelInvitation = async (req: Request, res: Response): Promise<void> => {
  try {
    const invitation = await CoHostInvitation.findById(req.params.invitationId);
    if (!invitation) return void res.status(404).json({ message: "Invitation not found" });
    // Only the inviting organization may withdraw.
    if (String(invitation.fromOrganization) !== String(req.user.organization)) {
      return void res.status(403).json({ message: "Only the inviting organization can cancel this invitation" });
    }
    // The status transition is the guard, so a double-click can't reopen or
    // double-close an invitation.
    const claimed = await CoHostInvitation.findOneAndUpdate(
      { _id: invitation._id, status: "pending" },
      { $set: { status: "cancelled", respondedBy: req.user._id, respondedAt: new Date() } },
      { new: true }
    );
    if (!claimed) {
      return void res.status(409).json({ message: "This invitation is no longer pending" });
    }
    audit({
      req,
      action: "cohost_invitation_cancelled",
      resourceType: "CoHostInvitation",
      resourceId: claimed._id,
    });
    res.json({ invitation: await CoHostInvitation.findById(claimed._id).populate(POPULATE) });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

// --- Invited side ------------------------------------------------------------

// Every invitation addressed to the caller's organization.
export const listMyInvitations = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user.organization) {
      return void res.json({ invitations: [], pagination: { total: 0 } });
    }
    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 20 });
    const filter: any = { toOrganization: req.user.organization };
    if (req.query.status && req.query.status !== "all") filter.status = req.query.status;

    const { data, pagination } = await paginate(CoHostInvitation, {
      filter,
      page,
      limit,
      skip,
      sort: { createdAt: -1 },
      populate: POPULATE,
    });
    res.json({ invitations: data, pagination });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

// Accept or decline. Accepting here is the ONLY place a manual co-host link
// is written, so the invited organization's consent is structurally required
// rather than merely assumed by the UI.
export const respondToInvitation = async (req: Request, res: Response): Promise<void> => {
  try {
    const accept = req.params.action === "accept";
    const invitation = await CoHostInvitation.findById(req.params.invitationId);
    if (!invitation) return void res.status(404).json({ message: "Invitation not found" });

    // Only an admin of the INVITED organization may answer. An organizer can
    // see the invitation but must not bind their organization to it.
    if (String(invitation.toOrganization) !== String(req.user.organization)) {
      return void res.status(403).json({ message: "This invitation was not sent to your organization" });
    }
    if (req.user.role !== "org_admin") {
      return void res.status(403).json({ message: "Only an organization admin can respond to co-host invitations" });
    }

    const claimed = await CoHostInvitation.findOneAndUpdate(
      { _id: invitation._id, status: "pending" },
      {
        $set: {
          status: accept ? "accepted" : "declined",
          respondedBy: req.user._id,
          respondedAt: new Date(),
          responseMessage: (req.body?.message || "").trim(),
        },
      },
      { new: true }
    );
    if (!claimed) {
      return void res.status(409).json({ message: "This invitation is no longer pending" });
    }

    if (accept) {
      // $addToSet is atomic and idempotent — a retry can never duplicate the
      // co-host entry.
      await Event.updateOne(
        { _id: claimed.event },
        { $addToSet: { coHostOrganizations: claimed.toOrganization } }
      );
    }

    const [event, toOrg] = await Promise.all([
      Event.findById(claimed.event).select("title").lean(),
      Organization.findById(claimed.toOrganization).select("name").lean(),
    ]);
    const toName = toOrg?.name || "An organization";
    const eventTitle = event?.title || "your event";
    const outcome = accept
      ? `${toName} accepted your invitation to co-host "${eventTitle}".`
      : `${toName} declined your invitation to co-host "${eventTitle}".`;
// @ts-ignore
    await notifyOrgAdmins({
      organization: claimed.fromOrganization,
      title: accept ? "Co-host invitation accepted" : "Co-host invitation declined",
      message: outcome,
      event: claimed.event,
      data: { invitationId: claimed._id },
      // The inviter is blocked waiting on this answer, so it's emailed too.
      mail: {
        subject: accept
          ? `${toName} accepted your co-host invitation`
          : `${toName} declined your co-host invitation`,
        text:
          outcome +
          (claimed.responseMessage ? `\n\nTheir note: "${claimed.responseMessage}"` : "") +
          (accept
            ? "\n\nTheir admins can now manage the event's attendees, check-in and analytics."
            : "") +
          `\n\nView: ${String(process.env.FRONTEND_URL || "http://localhost:3000").split(",")[0].trim().replace(/\/$/, "")}/admin/collaboration`,
      },
    });

    audit({
      req,
      action: accept ? "cohost_invitation_accepted" : "cohost_invitation_declined",
      resourceType: "CoHostInvitation",
      resourceId: claimed._id,
      metadata: { event: String(claimed.event) },
    });

    res.json({ invitation: await CoHostInvitation.findById(claimed._id).populate(POPULATE) });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

const _controllerExports = { createInvitation, listEventInvitations, cancelInvitation, listMyInvitations, respondToInvitation };
export default _controllerExports;
// CJS interop for require() - keep compatibility
// @ts-ignore
module.exports = _controllerExports;
// @ts-ignore
module.exports.default = _controllerExports;