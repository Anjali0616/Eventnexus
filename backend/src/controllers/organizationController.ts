import { Request, Response } from "express";
import Organization from "../models/Organization";
import OrganizationMember from "../models/OrganizationMember";
import User from "../models/User";
import { audit } from "../utils/audit";

import { parsePagination, buildSearch, buildFilters, parseSort, paginate } from "../utils/query";

export const slugify = (name) =>
  name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

// Public: lets registration forms populate an "organization" dropdown without
// exposing anything beyond name/id for orgs that aren't the caller's own.
export const listOrganizations = async (req: Request, res: Response): Promise<void> => {
  try {
    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 50 });

    const filter: any = {
      status: "active",
      ...buildSearch(req.query.search, ["name", "slug", "city", "country"]),
    };
    const sort = parseSort(req.query.sort, ["name", "createdAt"], { name: 1 });

    const { data, pagination } = await paginate(Organization, {
      filter,
      page,
      limit,
      skip,
      sort,
      select: "name _id slug city country status",
    });
    res.json({ organizations: data, pagination });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

export const getMyOrganization = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user.organization) {
      return void res.status(404).json({ message: "No organization assigned" });
    }
    const organization = await Organization.findById(
      req.user.organization
    ).populate("owner", "name email");
    if (!organization) {
      return void res.status(404).json({ message: "Organization not found" });
    }
    res.json({ organization });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

export const updateMyOrganization = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name } = req.body;
    // status is system-admin only (system.js). Tenant admins must not self-approve,
    // suspend or reactivate their own organization — that would bypass the approval gate.
    if (req.body.status !== undefined) {
      return void res.status(403).json({ message: "Organization status can only be changed by a system admin" });
    }
    if (!name || !name.trim()) {
      return void res.status(400).json({ message: "Organization name is required" });
    }
    if (name.trim().length > 100) {
      return void res.status(400).json({ message: "Organization name is too long (max 100 characters)" });
    }
    const organization = await Organization.findById(req.user.organization);
    if (!organization) {
      return void res.status(404).json({ message: "Organization not found" });
    }

    organization.name = name.trim();
    await organization.save();

    audit({
      req,
      action: "organization_updated",
      resourceType: "Organization",
      resourceId: organization._id,
      metadata: { name: name.trim() },
    });

    res.json({ organization });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

// --- Organization membership (tenant-level roles, report §15) -------------

// Members of the caller's organization, with their org-level roles.
export const listMembers = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user.organization;
    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 20 });

    const filter: any = {
      organization: orgId,
      status: { $ne: "removed" },
      ...buildFilters(req.query, ["roleInOrg", "status"]),
    };

    // Search across the member's user record (name/email) — resolve matching
    // user ids first, then scope the membership query to them.
    const search = String(req.query.search || "").trim();
    if (search) {
      const safe = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const rx = new RegExp(safe, "i");
      const users = await User.find({ $or: [{ name: rx }, { email: rx }] })
        .select("_id")
        .lean();
      filter.user = { $in: users.map((u) => u._id) };
    }

    const sort = parseSort(req.query.sort, ["roleInOrg", "joinedAt"], {
      roleInOrg: 1,
      joinedAt: 1,
    });

    const { data, pagination } = await paginate(OrganizationMember, {
      filter,
      page,
      limit,
      skip,
      sort,
      populate: { path: "user", select: "name email role" },
    });

    res.json({
      members: data.map((m) => ({
        _id: m._id,
        userId: m.user?._id,
        name: m.user?.name,
        email: m.user?.email,
        systemRole: m.user?.role,
        roleInOrg: m.roleInOrg,
        status: m.status,
        joinedAt: m.joinedAt,
      })),
      pagination,
    });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

// Add an existing platform user to the organization (by email) and grant an
// org-level role. Only org admins (requireOrgAdmin) may do this.
export const addMember = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, roleInOrg = "member" } = req.body;
    if (!email) {
      return void res.status(400).json({ message: "email is required" });
    }
    if (!["owner", "admin", "manager", "member"].includes(roleInOrg)) {
      return void res.status(400).json({ message: "Invalid roleInOrg" });
    }
    // Only the organization owner may create another owner — manager/admin
    // granting owner is privilege escalation to tenant root.
    if (roleInOrg === "owner" && req.orgAdminRole !== "owner") {
      return void res.status(403).json({ message: "Only the organization owner can add another owner" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return void res.status(404).json({ message: "No user found with that email" });
    }

    const orgId = req.user.organization;
    // Re-adding someone who was removed: revive the membership.
    let member = await OrganizationMember.findOne({ organization: orgId, user: user._id });
    if (member?.status === "removed") {
      member.status = "active";
      member.roleInOrg = roleInOrg;
    } else if (member) {
      return void res.status(409).json({ message: "User is already a member" });
    } else {
      member = await OrganizationMember.create({
        organization: orgId,
        user: user._id,
        roleInOrg,
        invitedBy: req.user._id,
      });
    }
    await member.save();

    // Keep the user's tenant pointer in sync.
    if (!user.organization) {
      user.organization = orgId;
      await user.save();
    }

    audit({
      req,
      action: "member_added",
      resourceType: "Organization",
      resourceId: orgId,
      metadata: { userId: user._id, email, roleInOrg },
    });

    res.status(201).json({ member });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

export const updateMemberRole = async (req: Request, res: Response): Promise<void> => {
  try {
    const { roleInOrg } = req.body;
    if (!["owner", "admin", "manager", "member"].includes(roleInOrg)) {
      return void res.status(400).json({ message: "Invalid roleInOrg" });
    }
    const orgId = req.user.organization;
    const member = await OrganizationMember.findOne({
      organization: orgId,
      user: req.params.userId,
      status: { $ne: "removed" },
    });
    if (!member) {
      return void res.status(404).json({ message: "Membership not found" });
    }
    if (member.roleInOrg === "owner" && req.user._id.toString() !== member.user.toString()) {
      return void res.status(403).json({ message: "Only the owner can change the owner role" });
    }
    // Promoting anyone TO owner requires being the owner — admin/manager cannot
    // escalate a member to owner.
    if (roleInOrg === "owner" && req.orgAdminRole !== "owner") {
      return void res.status(403).json({ message: "Only the organization owner can promote to owner" });
    }

    member.roleInOrg = roleInOrg;
    await member.save();

    audit({
      req,
      action: "member_role_changed",
      resourceType: "Organization",
      resourceId: orgId,
      metadata: { userId: req.params.userId, roleInOrg },
    });

    res.json({ member });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

export const removeMember = async (req: Request, res: Response): Promise<void> => {
  try {
    const orgId = req.user.organization;
    const member = await OrganizationMember.findOne({
      organization: orgId,
      user: req.params.userId,
      status: { $ne: "removed" },
    });
    if (!member) {
      return void res.status(404).json({ message: "Membership not found" });
    }
    if (member.roleInOrg === "owner") {
      return void res.status(403).json({ message: "The owner cannot be removed" });
    }
    if (req.user._id.toString() === member.user.toString()) {
      return void res.status(403).json({ message: "You cannot remove yourself" });
    }

    member.status = "removed";
    await member.save();

    audit({
      req,
      action: "member_removed",
      resourceType: "Organization",
      resourceId: orgId,
      metadata: { userId: req.params.userId },
    });

    res.json({ ok: true });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

const _controllerExports = { slugify, listOrganizations, getMyOrganization, updateMyOrganization, listMembers, addMember, updateMemberRole, removeMember };
export default _controllerExports;
// CJS interop for require() - keep compatibility
// @ts-ignore
module.exports = _controllerExports;
// @ts-ignore
module.exports.default = _controllerExports;