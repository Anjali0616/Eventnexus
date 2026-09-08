import { Request, Response } from "express";
import User from "../models/User";
import Event from "../models/Event";
import Organization from "../models/Organization";
import OrganizationMember from "../models/OrganizationMember";
import Session from "../models/Session";
import Ticket from "../models/Ticket";
import { audit } from "../utils/audit";
import { generateEmailToken, hashToken } from "../utils/tokens";
import { sendMail } from "../utils/email";

import { parsePagination, buildSearch, buildFilters, parseSort, paginate } from "../utils/query";

// Update the current user's explicit interests (category pills).
// Validated against the same allowlist as registration; empty array clears.
const ALLOWED_INTERESTS = [
  "Technology",
  "Business",
  "Academic",
  "Workshop",
  "Social",
  "Health",
  "Arts",
  "Music",
  "Sports",
  "Networking",
];

const sanitizeInterests = (arr) => {
  if (!Array.isArray(arr)) return null;
  const seen = new Set();
  const out = [];
  for (const raw of arr) {
    const v = String(raw || "").trim();
    if (ALLOWED_INTERESTS.includes(v) && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
    if (out.length >= 10) break;
  }
  return out;
};

export const updateMyInterests = async (req: Request, res: Response): Promise<void> => {
  try {
    const { interests } = req.body;
    const cleaned = sanitizeInterests(interests);
    if (cleaned === null) {
      return void res.status(400).json({ message: "interests must be an array of categories" });
    }
    req.user.interests = cleaned;
    await req.user.save();
    res.json({ interests: req.user.interests });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
  }
};

const EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h, matches auth resets

// Resolve a user the calling admin may manage. The OVERALL system admin
// (no organization) reaches every tenant; org admins are hard-scoped to
// their own. Returns the populated user or null (404 / 403 handled by the
// caller so it can distinguish "not found" from "not yours").
const findUserInScope = async (req, id) => {
  const user = await User.findById(id).populate("organization", "name");
  if (!user) return null;
  const targetOrg = user.organization?._id || user.organization;
  if (req.user.organization && String(targetOrg || "") !== String(req.user.organization)) {
    return null;
  }
  return user;
};

// Root-of-trust guard, shared by every account-level action: the tenant
// owner (Organization.owner) and the tenant's LAST active admin can't be
// demoted, deactivated or removed by another admin — doing so would leave
// the organization permanently unmanageable.
const assertManagementSafe = async (req, res, user) => {
  if (String(user._id) === String(req.user._id)) {
    return void res.status(400).json({ message: "You can't manage your own account" });
  }
  const orgId = user.organization?._id || user.organization;
  if (orgId) {
    const org = await Organization.findById(orgId);
    if (org?.owner && String(org.owner) === String(user._id)) {
      return void res.status(400).json({ message: "The organization owner's account can't be changed" });
    }
    if (user.role === "org_admin") {
      const otherActiveAdmins = await User.countDocuments({
        _id: { $ne: user._id },
        organization: orgId,
        role: "org_admin",
        active: true,
      });
      if (otherActiveAdmins === 0) {
        return void res
          .status(400)
          .json({ message: "This is the organization's only active admin — promote or create another first" });
      }
    }
  }
  return null;
};

// Admin-only. An org admin (admin with an organization) is scoped to their
// own tenant; the OVERALL system admin (role "admin", no organization) sees
// every tenant (PDF: "Administrators have control over all the tenant
// companies on the platform"). Every returned user carries accurate live
// aggregates (last activity, ticket count, hosted-event count, tenant name)
// so the directory doesn't guess from the page it happens to be showing.
export const listOrgUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const { page, limit, skip } = parsePagination(req.query);
    const isSystemAdmin = !req.user.organization;
    // Org admins always see their own tenant. The system admin (no org) can
    // narrow to a single tenant via ?organizationId — otherwise they see every
    // account on the platform.
    const orgId = isSystemAdmin && req.query.organizationId ? req.query.organizationId : req.user.organization;
    const filter: any = {
      ...(orgId ? { organization: orgId } : {}),
      ...buildSearch(req.query.search, ["name", "email"]),
      ...buildFilters(req.query, ["role"]),
    };
    // ?status=true|false filters active vs. deactivated accounts.
    if (req.query.status === "true" || req.query.status === "false") {
      filter.active = req.query.status === "true";
    }
    const sort = parseSort(req.query.sort, ["name", "createdAt", "active"], {
      createdAt: -1,
    });

    const { data, pagination } = await paginate(User, {
      filter,
      page,
      limit,
      skip,
      sort,
      populate: { path: "organization", select: "name" },
      select: "name email role organization active createdAt emailVerifiedAt googleId",
    });

    // One aggregate per live metric for the whole page — no N+1, and the
    // numbers are exact rather than derived from a table list.
    const pageIds = data.map((u) => u._id);
    const [sessions, tickets, hosted] = await Promise.all([
      Session.aggregate([
        { $match: { user: { $in: pageIds }, revokedAt: null } },
        { $group: { _id: "$user", lastUsedAt: { $max: "$lastUsedAt" }, count: { $sum: 1 } } },
      ]),
      Ticket.aggregate([
        { $match: { attendee: { $in: pageIds }, active: true } },
        { $group: { _id: "$attendee", count: { $sum: 1 } } },
      ]),
      Event.aggregate([
        { $match: { organizer: { $in: pageIds } } },
        { $group: { _id: "$organizer", count: { $sum: 1 } } },
      ]),
    ]);
    const sessionByUser = new Map(sessions.map((s) => [String(s._id), s]));
    const ticketByUser = new Map(tickets.map((t) => [String(t._id), t.count]));
    const hostedByUser = new Map(hosted.map((h) => [String(h._id), h.count]));

    const users = data.map((u) => ({
      _id: u._id,
      name: u.name,
      email: u.email,
      role: u.role,
      active: u.active !== false,
      emailVerifiedAt: u.emailVerifiedAt,
      googleAccount: Boolean(u.googleId),
      organization: u.organization?._id || u.organization,
      organizationName: u.organization?.name || null,
      createdAt: u.createdAt,
      // lastUsedAt may be null (never used a refresh session since 1.0);
      // lastActiveAt mirrors availability for the table's "last active".
      lastActiveAt: sessionByUser.get(String(u._id))?.lastUsedAt || null,
      activeSessions: sessionByUser.get(String(u._id))?.count || 0,
      ticketCount: ticketByUser.get(String(u._id)) || 0,
      hostedEventCount: hostedByUser.get(String(u._id)) || 0,
    }));
    res.json({ users, pagination });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

// Org admin creates user credentials for their own tenant (name/email/
// password + role — full RBAC from day one). Self-service registration is
// attendee-only (register endpoint), so privileged accounts must be created
// here by the org admin or the system admin.
export const createUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, password, role = "attendee", organizationId } = req.body;
    if (!name || !email || !password) {
      return void res.status(400).json({ message: "name, email and password are required" });
    }
    if (password.length < 6) {
      return void res.status(400).json({ message: "Password must be at least 6 characters" });
    }
    // "admin" (the platform-wide system admin) is never created here — every
    // account this endpoint creates belongs to a tenant (org._id is always
    // set below), and a system admin must never carry an organization. The
    // tenant-admin role is "org_admin".
    if (!["org_admin", "organizer", "attendee"].includes(role)) {
      return void res.status(400).json({ message: "Invalid role" });
    }
    if (await User.findOne({ email })) {
      return void res.status(400).json({ message: "User already exists" });
    }

    const isSystemAdmin = req.user.role === "admin" && !req.user.organization;

    // RBAC: only the system admin may grant the org_admin role — an org
    // admin creating more org admins is privilege escalation (it bypasses
    // the system admin's org-approval authority). Org admins provision
    // organizer/attendee accounts for their own tenant. Legacy "admin" with
    // an organization must not pass this check.
    if (role === "org_admin" && !isSystemAdmin) {
      return void res
        .status(403)
        .json({ message: "Only the system admin can create organization admins" });
    }

    // Tenant resolution: org admins always target their own org; the system
    // admin must name one (every created account belongs to a tenant — the
    // platform's sole org-less user is the system admin itself).
    let orgId = req.user.organization;
    if (isSystemAdmin) {
      if (!organizationId) {
        return void res
          .status(400)
          .json({ message: "organizationId is required when creating tenant users" });
      }
      orgId = organizationId;
    }
    const org = await Organization.findById(orgId);
    if (!org || org.status !== "active") {
      return void res.status(400).json({ message: "Invalid or inactive organization" });
    }

    const user = await User.create({
      name,
      email,
      password,
      role,
      organization: org._id,
    });

    // Keep the org-level membership in sync so requireOrgAdmin sees the
    // account with the right tenant role immediately.
    await OrganizationMember.create({
      organization: org._id,
      user: user._id,
      roleInOrg: role === "org_admin" ? "admin" : "member",
      invitedBy: req.user._id,
    });

    audit({
      req,
      action: "user_created",
      resourceType: "User",
      resourceId: user._id,
      metadata: { email, role, by: req.user._id, organization: org._id },
    });

    res.status(201).json({
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        organization: user.organization,
      },
    });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

export const updateUserRole = async (req: Request, res: Response): Promise<void> => {
  try {
    const { role } = req.body;
    const user = await User.findById(req.params.id);
    if (!user) {
      return void res.status(404).json({ message: "User not found" });
    }
    // Org admins can only touch their own tenant; the system admin (no org)
    // manages accounts across the platform.
    if (
      req.user.organization &&
      user.organization?.toString() !== req.user.organization.toString()
    ) {
      return void res.status(403).json({ message: "User belongs to a different organization" });
    }
    if (user._id.toString() === req.user._id.toString()) {
      return void res.status(400).json({ message: "You can't change your own role" });
    }
    // The literal "admin" (platform-wide system admin) role can never be
    // granted through user management — it's only ever assigned via the
    // ADMIN_EMAILS allowlist on Google sign-in (authController.js), which
    // guarantees the account stays organization-less. Granting it here
    // would leave the target with full system-admin permissions
    // (org:approve, ai:manage, iam:manage) while still attached to their
    // tenant's organization — exactly the ambiguous state the org_admin
    // role exists to eliminate.
    if (role === "admin") {
      return void res
        .status(403)
        .json({ message: "The system admin role can't be granted here" });
    }
    // No privilege escalation: granting the org_admin role is the system
    // admin's call (org admins may still manage organizer/attendee roles).
    // Must be system admin (admin without org), not just any admin role.
    if (role === "org_admin" && (req.user.role !== "admin" || req.user.organization)) {
      return void res
        .status(403)
        .json({ message: "Only the system admin can grant the org_admin role" });
    }
    // The tenant owner is the org's root of trust — a misclick here would
    // permanently lock the org out of admin privileges.
    const org = await Organization.findById(user.organization);
    if (org && org.owner?.toString() === user._id.toString()) {
      return void res.status(400).json({ message: "The organization owner's role can't be changed" });
    }
    const previousRole = user.role;
    user.role = role;
    // A role change invalidates every outstanding access token (tokenVersion
    // bump) and refresh session, so the user is logged out everywhere and
    // must re-authenticate — no stale sessions keep running with the old
    // role, and the client UI is forced to pick up the new one.
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    await user.save();
    await Session.updateMany({ user: user._id, revokedAt: null }, { revokedAt: new Date() });
    // Keep the org-level membership in sync with the system role so
    // requireOrgAdmin doesn't keep treating a demoted admin as a tenant admin.
    if (user.organization) {
      await OrganizationMember.updateOne(
        { organization: user.organization, user: user._id, status: { $ne: "removed" } },
        { roleInOrg: role === "org_admin" ? "admin" : "member" },
        { upsert: false }
      );
    }
    audit({
      req,
      action: "role_changed",
      resourceType: "User",
      resourceId: user._id,
      metadata: { from: previousRole, to: role, by: req.user._id, sessionsRevoked: true },
    });
    res.json({
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        organization: user.organization,
      },
    });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

// Any authenticated user can save their own location (captured from the
// browser on login). Powers distance-based recommendations and chatbot.
// Omitting lat/lng clears the saved location entirely.
export const updateMyLocation = async (req: Request, res: Response): Promise<void> => {
  try {
    const { lat, lng, city } = req.body;

    if (lat == null || lng == null) {
      req.user.location = undefined;
      await req.user.save();
      return void res.json({ location: null });
    }

    req.user.location = {
      lat,
      lng,
      city: city || req.user.location?.city,
      updatedAt: new Date(),
    };
    await req.user.save();
    res.json({ location: req.user.location });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

// Any authenticated user (attendee, organizer, admin) can update their own
// display name from Settings. Email stays immutable — it's the account's
// identity (and Google accounts have no password to verify a change with).
// Also accepts optional interests array so PATCH /me/profile can save
// interests together with a name change from the same form.
export const updateMyProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, interests } = req.body;
    if (name !== undefined) {
      if (!name || !String(name).trim()) {
        return void res.status(400).json({ message: "Name is required" });
      }
      if (String(name).trim().length > 80) {
        return void res.status(400).json({ message: "Name is too long (max 80 characters)" });
      }
      req.user.name = String(name).trim();
    } else if (interests === undefined) {
      return void res.status(400).json({ message: "Name is required" });
    }
    if (interests !== undefined) {
      const cleaned = sanitizeInterests(interests);
      if (cleaned === null) {
        return void res.status(400).json({ message: "interests must be an array of categories" });
      }
      req.user.interests = cleaned;
    }
    await req.user.save();
    res.json({
      user: {
        _id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role,
        organization: req.user.organization,
        location: req.user.location,
        interests: req.user.interests || [],
      },
    });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

// Password change for local accounts. Google-linked accounts have no
// password (they authenticate via googleId), so there's nothing to compare
// or update — the settings UI hides the card for them.
export const updateMyPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (req.user.googleId) {
      return void res
        .status(400)
        .json({ message: "Google accounts don't use a password — sign in with Google" });
    }
    if (!currentPassword) {
      return void res.status(400).json({ message: "Current password is required" });
    }
    if (!newPassword || newPassword.length < 6) {
      return void res.status(400).json({ message: "New password must be at least 6 characters" });
    }

    // The password field is select:false, so fetch it explicitly — a
    // missing password would make comparePassword throw instead of failing
    // the check.
    const fullUser = await User.findById(req.user._id).select("+password");
    const ok = await fullUser.comparePassword(currentPassword);
    if (!ok) {
      return void res.status(400).json({ message: "Current password is incorrect" });
    }

    fullUser.password = newPassword;
    // Same hardening as role change / password reset: new password means old
    // JWTs and refresh sessions are dead — every device re-authenticates.
    fullUser.tokenVersion = (fullUser.tokenVersion ?? 0) + 1;
    await fullUser.save();
    await Session.updateMany(
      { user: fullUser._id, revokedAt: null },
      { revokedAt: new Date() }
    );
    res.json({ message: "Password updated. Please log in again." });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

export const getOrgStats = async (req: Request, res: Response): Promise<void> => {
  try {
    // System admin (no org) → platform-wide stats; org admin → own tenant.
    const scope = req.user.organization ? { organization: req.user.organization } : {};
    const monthAgo = new Date();
    monthAgo.setMonth(monthAgo.getMonth() - 1);
    const [userCount, eventCount, roleRows, activeCount, newThisMonth] = await Promise.all([
      User.countDocuments(scope),
      Event.countDocuments(scope),
      User.aggregate([
        { $match: scope },
        { $group: { _id: "$role", count: { $sum: 1 } } },
      ]),
      User.countDocuments({ ...scope, active: { $ne: false } }),
      User.countDocuments({ ...scope, createdAt: { $gte: monthAgo } }),
    ]);
    const roleCounts = { admin: 0, org_admin: 0, organizer: 0, attendee: 0 };
    roleRows.forEach((r) => {
      if (r._id in roleCounts) roleCounts[r._id] = r.count;
    });
    res.json({
      userCount,
      eventCount,
      roleCounts,
      activeCount,
      deactivatedCount: userCount - activeCount,
      newThisMonth,
    });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

// Update the current user's reminder email preference.
export const updateReminderPreference = async (req: Request, res: Response): Promise<void> => {
  try {
    const { reminderEmail } = req.body;
    if (typeof reminderEmail !== "boolean") {
      return void res.status(400).json({ message: "reminderEmail must be a boolean" });
    }
    req.user.reminderEmail = reminderEmail;
    await req.user.save();
    res.json({ reminderEmail: req.user.reminderEmail });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

// Server-side saved events (the heart bookmark) — follows the account
// across devices; the frontend keeps the localStorage list only as a guest
// fallback until sign-in.
export const getMySavedEvents = async (req: Request, res: Response): Promise<void> => {
  try {
    await req.user.populate({
      path: "savedEvents",
      select: "title date venue category type status price capacity registered imageUrl organizer",
    });
    res.json({ savedEvents: req.user.savedEvents });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

export const addSavedEvent = async (req: Request, res: Response): Promise<void> => {
  try {
    const event = await Event.findById(req.params.eventId).select("_id");
    if (!event) {
      return void res.status(404).json({ message: "Event not found" });
    }
    const alreadySaved = req.user.savedEvents.some((id) => String(id) === req.params.eventId);
    if (!alreadySaved) {
      req.user.savedEvents.push(event._id);
      await req.user.save();
    }
    res.json({ saved: true, savedCount: req.user.savedEvents.length });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

export const removeSavedEvent = async (req: Request, res: Response): Promise<void> => {
  try {
    req.user.savedEvents = req.user.savedEvents.filter(
      (id) => String(id) !== req.params.eventId
    );
    await req.user.save();
    res.json({ saved: false, savedCount: req.user.savedEvents.length });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

// Full administrative profile of one user: identity + verification status,
// tenant, live activity metrics (sessions, tickets, hosted events, saved
// bookmarks) — nothing here is guessed from list page data.
export const getUserDetail = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await findUserInScope(req, req.params.id);
    if (!user) return void res.status(404).json({ message: "User not found" });

    const [sessions, ticketRows, hostedRows] = await Promise.all([
      Session.find({ user: user._id }).select("ip userAgent lastUsedAt createdAt expiresAt revokedAt").sort({ createdAt: -1 }).limit(50).lean(),
      Ticket.aggregate([
        { $match: { attendee: user._id } },
        { $group: { _id: null, total: { $sum: 1 }, active: { $sum: { $cond: [{ $eq: ["$active", true] }, 1, 0] } } } },
      ]),
      Event.countDocuments({ organizer: user._id }),
    ]);
    const lastUsed = await Session.findOne({ user: user._id, revokedAt: null })
      .sort({ lastUsedAt: -1, createdAt: -1 })
      .select("lastUsedAt ip userAgent createdAt");

    res.json({
      user: {
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        active: user.active !== false,
        emailVerifiedAt: user.emailVerifiedAt,
        googleAccount: Boolean(user.googleId),
        organization: user.organization?._id || user.organization,
// @ts-ignore
        organizationName: user.organization?.name || null,
        createdAt: user.createdAt,
        activeSessions: sessions.filter((s) => !s.revokedAt).length,
        lastActiveAt: lastUsed?.lastUsedAt || null,
        tickets: ticketRows[0] || { total: 0, active: 0 },
        hostedEventCount: hostedRows,
        savedCount: (user.savedEvents || []).length,
        recentSessions: sessions.slice(0, 10),
      },
    });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

// Admin view of a user's refresh sessions (devices): which are live, when
// last used, expiry — the raw material behind "revoke everywhere".
export const listUserSessions = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!(await findUserInScope(req, req.params.id))) {
      return void res.status(404).json({ message: "User not found" });
    }
    const sessions = await Session.find({ user: req.params.id })
      .select("ip userAgent createdAt lastUsedAt expiresAt revokedAt")
      .sort({ revokedAt: 1, lastUsedAt: -1 })
      .limit(50)
      .lean();
    res.json({ sessions });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

// Deactivate (active=false) or reactivate an account. Deactivation is the
// reversible, safe form of "removal": the account keeps data and history,
// but every session is revoked and the next login is refused; the admin can
// reactivate at any time. Guarded like every privilege change:
// self/tenant-owner/last-admin can't be touched, cross-tenant is 403.
export const updateUserStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { active } = req.body;
    const user = await findUserInScope(req, req.params.id);
    if (!user) return void res.status(404).json({ message: "User not found" });

    const blocked = await assertManagementSafe(req, res, user);
    if (blocked) return blocked;

    if (user.active !== false && active === false) {
      // Deactivate: kill every device, invalidate every JWT (tokenVersion),
      // so the account is dead before either list or login could serve it.
      user.active = false;
      user.tokenVersion = (user.tokenVersion ?? 0) + 1;
      await user.save();
      await Session.updateMany({ user: user._id, revokedAt: null }, { revokedAt: new Date() });
      audit({
        req,
        action: "user_deactivated",
        resourceType: "User",
        resourceId: user._id,
        metadata: { by: req.user._id, sessionsRevoked: true },
      });
      return void res.json({
        user: { _id: user._id, name: user.name, email: user.email, active: false },
        message: `${user.name} has been deactivated. All sessions were revoked and login is blocked.`,
      });
    }
    if (user.active === false && active !== false) {
      user.active = true;
      await user.save();
      audit({
        req,
        action: "user_reactivated",
        resourceType: "User",
        resourceId: user._id,
        metadata: { by: req.user._id },
      });
      return void res.json({
        user: { _id: user._id, name: user.name, email: user.email, active: true },
        message: `${user.name} can log in again.`,
      });
    }
    res.json({ user: { _id: user._id, active: user.active !== false }, message: "No change needed" });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

// Log a user out of every device (refresh sessions revoked + JWT version
// bump). The user itself stays active and can simply log back in.
export const revokeUserSessions = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await findUserInScope(req, req.params.id);
    if (!user) return void res.status(404).json({ message: "User not found" });

    const n = await Session.updateMany({ user: user._id, revokedAt: null }, { revokedAt: new Date() });
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    await user.save();
    audit({
      req,
      action: "sessions_revoked",
      resourceType: "User",
      resourceId: user._id,
      metadata: { by: req.user._id, revoked: n.modifiedCount },
    });
    res.json({ message: `${n.modifiedCount} session(s) revoked — the user must log in again` });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

// Admin-initiated password reset: mints the same single-use, 24h, hashed
// token the self-service forgot-password flow uses and emails the link.
// The admin never sees or sets the password itself.
export const adminResetPassword = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await findUserInScope(req, req.params.id);
    if (!user) return void res.status(404).json({ message: "User not found" });

    if (user.googleId) {
      return void res
        .status(400)
        .json({ message: "This is a Google-linked account — it has no password to reset" });
    }
    const token = generateEmailToken();
    user.passwordResetToken = hashToken(token);
    user.passwordResetExpiresAt = new Date(Date.now() + EMAIL_TOKEN_TTL_MS);
    await user.save();

    const frontendBase = String(process.env.FRONTEND_URL || "http://localhost:3000").split(",")[0].trim().replace(/\/$/, "");
    const link = `${frontendBase}/reset-password?token=${token}`;
    await sendMail({
      to: user.email,
      subject: "Reset your EventNexus password",
      template: "password-reset",
      templateData: { name: user.name, link },
    });

    audit({
      req,
      action: "password_reset_requested",
      resourceType: "User",
      resourceId: user._id,
      metadata: { by: req.user._id, via: "admin" },
    });
    res.json({ message: `Password reset link sent to ${user.email}` });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

// Permanent removal. Deliberately the LEAST convenient option: deactivation
// covers almost every real case (it's reversible), so removal is only
// allowed for accounts with no footprint — no hosted events, no active
// tickets — and never for the tenant owner, the last admin, or yourself.
export const removeUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const user = await findUserInScope(req, req.params.id);
    if (!user) return void res.status(404).json({ message: "User not found" });

    const blocked = await assertManagementSafe(req, res, user);
    if (blocked) return blocked;

    const orgId = user.organization?._id || user.organization;
    const [ticketRows, hostedCount] = await Promise.all([
      Ticket.countDocuments({ attendee: user._id, active: true }),
      Event.countDocuments({ organizer: user._id }),
    ]);
    if (ticketRows > 0) {
      return void res.status(400).json({
        message: `${user.name} still holds ${ticketRows} active ticket(s). Deactivate the account instead — removal requires canceling/all refunding them first.`,
      });
    }
    if (hostedCount > 0) {
      return void res.status(400).json({
        message: `${user.name} hosts ${hostedCount} event(s). Reassign the organizer before removing the account.`,
      });
    }

    await Session.deleteMany({ user: user._id });
    await OrganizationMember.deleteMany({ user: user._id });
    await User.deleteOne({ _id: user._id });
    audit({
      req,
      action: "user_removed",
      resourceType: "User",
      resourceId: user._id,
      metadata: { by: req.user._id, name: user.name, email: user.email, organization: orgId },
    });
    res.json({ message: `${user.name} was removed permanently.` });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

const _controllerExports = { listOrgUsers, createUser, updateUserRole, getUserDetail, listUserSessions, updateUserStatus, revokeUserSessions, adminResetPassword, removeUser, updateMyLocation, updateMyProfile, updateMyPassword, updateMyInterests, updateReminderPreference, getMySavedEvents, addSavedEvent, removeSavedEvent, getOrgStats };
export default _controllerExports;
// CJS interop for require() - keep compatibility
// @ts-ignore
module.exports = _controllerExports;
// @ts-ignore
module.exports.default = _controllerExports;