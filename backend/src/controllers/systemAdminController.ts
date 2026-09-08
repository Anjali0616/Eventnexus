import { Request, Response } from "express";
import mongoose from "mongoose";
import Organization from "../models/Organization";
import User from "../models/User";
import OrganizationMember from "../models/OrganizationMember";
import { audit } from "../utils/audit";
import { sendMail } from "../utils/email";

import { parsePagination, buildSearch, parseSort, paginate } from "../utils/query";

// --- System-admin org approval console ---------------------------------------
// Organizations self-register with full details (orgRegister) and land in
// "pending". The OVERALL system admin (role "admin", no organization) reviews
// and approves/rejects them; only approved orgs' users can log in.

export const listPendingOrgs = async (req: Request, res: Response): Promise<void> => {
  try {
    const { status = "pending" } = req.query as any;
    const valid = ["pending", "active", "rejected", "suspended"];
    const filter: any = {
      ...(valid.includes(status) ? { status } : { status: "pending" }),
      ...buildSearch(req.query.search, ["name", "slug", "email", "city", "country", "type"]),
    };
    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 20 });

    const { data: orgs, pagination } = await paginate(Organization, {
      filter,
      page,
      limit,
      skip,
      sort: parseSort(req.query.sort, ["name", "createdAt"], { createdAt: -1 }),
    });

    // Attach the org admin (the user who registered the org) for each.
    const orgIds = orgs.map((o) => o._id);
    const admins = await User.find({ organization: { $in: orgIds }, role: "org_admin" })
      .select("name email organization")
      .lean();
    const adminByOrg: any = {};
    admins.forEach((a) => {
      if (!a.organization) return;
      const key = a.organization.toString();
      if (!adminByOrg[key]) adminByOrg[key] = a;
    });

    res.json({
      organizations: orgs.map((o) => ({
        ...o,
        admin: adminByOrg[o._id.toString()] || null,
      })),
      pagination,
    });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

export const approveOrg = async (req: Request, res: Response): Promise<void> => {
  try {
    const org = await Organization.findById(req.params.id);
    if (!org) {
      return void res.status(404).json({ message: "Organization not found" });
    }
    if (org.status !== "pending") {
      return void res.status(400).json({ message: `Organization is already ${org.status}` });
    }

    org.status = "active";
    org.approvedBy = req.user._id;
    org.approvedAt = new Date();
    org.rejectionReason = undefined;
    org.rejectedAt = undefined;
    await org.save();

    // The registering admin is the org's owner inside the tenant.
    const admin = await User.findById(org.owner);
    if (admin) {
      await OrganizationMember.updateOne(
        { user: admin._id, organization: org._id },
        { $set: { roleInOrg: "owner", status: "active" } },
        { upsert: true }
      );
      await sendMail({
        to: admin.email,
        subject: "Your organization has been approved",
        template: "org-approved",
        text: `Hi ${admin.name},\n\nGreat news — ${org.name} has been verified and approved. You can now log in to your EventNexus workspace and start building your team and events.\n\n${String(process.env.FRONTEND_URL || "http://localhost:3000").split(",")[0].trim().replace(/\/$/, "")}/login`,
        metadata: { org: org.name },
      }).catch((err) => console.error("[mail] approval notice failed:", err.message));
    }

    audit({
      req,
      action: "org_approved",
      resourceType: "Organization",
      resourceId: org._id,
      metadata: { name: org.name, by: req.user._id },
    });

    res.json({ message: "Organization approved", organization: org });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

export const rejectOrg = async (req: Request, res: Response): Promise<void> => {
  try {
    const { reason } = req.body;
    if (!reason || !reason.trim()) {
      return void res.status(400).json({ message: "A rejection reason is required" });
    }

    const org = await Organization.findById(req.params.id);
    if (!org) {
      return void res.status(404).json({ message: "Organization not found" });
    }
    if (org.status !== "pending") {
      return void res.status(400).json({ message: `Organization is already ${org.status}` });
    }

    org.status = "rejected";
    org.rejectionReason = reason.trim();
    org.rejectedAt = new Date();
    org.approvedBy = req.user._id;
    await org.save();

    const admin = await User.findById(org.owner);
    if (admin) {
      await sendMail({
        to: admin.email,
        subject: "Your organization registration was not approved",
        template: "org-rejected",
        text: `Hi ${admin.name},\n\nUnfortunately ${org.name} could not be approved at this time.\n\nReason: ${reason}\n\nYou can edit your details and re-apply, or contact support.`,
        metadata: { org: org.name, reason },
      }).catch((err) => console.error("[mail] rejection notice failed:", err.message));
    }

    audit({
      req,
      action: "org_rejected",
      resourceType: "Organization",
      resourceId: org._id,
      metadata: { name: org.name, reason },
    });

    res.json({ message: "Organization rejected", organization: org });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

// --- System-admin org lifecycle: rename / suspend / reactivate ----------------
// Unlike approve/reject (pending → active/rejected), this mutates an already-
// provisioned tenant: a system admin can rename it or flip active↔suspended
// (e.g. when a tenant stops paying or violates policy).
export const updateOrganization = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, status } = req.body;
    const org = await Organization.findById(req.params.id);
    if (!org) {
      return void res.status(404).json({ message: "Organization not found" });
    }
    const validStatus = ["active", "suspended", "rejected"];
    if (status && !validStatus.includes(status)) {
      return void res.status(400).json({ message: "Invalid status" });
    }
    if (name) org.name = name.trim();
    if (status) org.status = status;
    if (org.status === "active") {
      // Re-activating a tenant: make sure its owner/admins can sign in again.
      org.rejectionReason = undefined;
      org.rejectedAt = undefined;
    }
    await org.save();

    // If a tenant is being suspended, revoke every active session AND bump
    // tokenVersion for its members so outstanding JWTs are invalidated immediately.
    // Revoking sessions alone leaves valid access tokens usable until expiry;
    // bumping tokenVersion makes protect() reject them on next use (same as
    // deactivation / role change hardening).
    if (org.status === "suspended") {
      const Session = require("../models/Session");
      const User = require("../models/User");
      const members = await User.find({ organization: org._id }).select("_id");
      const ids = members.map((m) => m._id);
      await Promise.all([
        Session.updateMany(
          { user: { $in: ids }, revokedAt: null },
          { revokedAt: new Date() }
        ),
        User.updateMany(
          { _id: { $in: ids } },
          { $inc: { tokenVersion: 1 } }
        ),
      ]);
    }

    audit({
      req,
      action: "organization_updated",
      resourceType: "Organization",
      resourceId: org._id,
      metadata: { name, status },
    });

    res.json({ organization: org });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

const _controllerExports = { listPendingOrgs, approveOrg, rejectOrg, updateOrganization };
export default _controllerExports;
// CJS interop for require() - keep compatibility
// @ts-ignore
module.exports = _controllerExports;
// @ts-ignore
module.exports.default = _controllerExports;