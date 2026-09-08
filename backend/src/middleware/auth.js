const jwt = require("jsonwebtoken");
const User = require("../models/User");
const Role = require("../models/Role");
const Organization = require("../models/Organization");
const OrganizationMember = require("../models/OrganizationMember");

const protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    return res.status(401).json({ message: "Not authorized, no token" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = await User.findById(decoded.id);
    if (!req.user) {
      return res.status(401).json({ message: "User not found" });
    }
    // Immediate deactivation check — do not rely solely on tokenVersion bump which
    // may be delayed or missed in a race; active=false must be enforced on every
    // authenticated request.
    if (req.user.active === false) {
      return res.status(403).json({ message: "Your account has been disabled by an administrator" });
    }
    // Token-version check: a role/password change bumps tokenVersion, which
    // invalidates every JWT minted before it — the user must re-authenticate
    // instead of continuing on the old session. (?? 0 keeps pre-version
    // tokens — and pre-field users — working.)
    if ((decoded.ver ?? 0) !== (req.user.tokenVersion ?? 0)) {
      return res.status(401).json({ message: "Session invalidated, please log in again" });
    }
    next();
  } catch (error) {
    return res.status(401).json({ message: "Not authorized, token invalid" });
  }
};

// Like protect, but doesn't reject when there's no/invalid token — it just
// leaves req.user unset. Used by routes that serve different data to
// anonymous vs. authenticated callers (e.g. public event browsing vs.
// tenant-scoped visibility of draft events).
const optionalAuth = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer")) return next();

  try {
    const token = header.split(" ")[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.id);
    // Stale-version tokens (role/password changed) are treated as anonymous
    // — an old JWT must not unlock privileged views on optional routes.
    // Also enforce immediate deactivation: disabled accounts must not get
    // privileged optional views either.
    if (user && user.active !== false && (decoded.ver ?? 0) === (user.tokenVersion ?? 0)) {
      req.user = user;
    }
  } catch (error) {
    // Invalid/expired token on an optional route — proceed as anonymous.
  }
  next();
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res
        .status(403)
        .json({ message: "Not authorized for this action" });
    }
    next();
  };
};

// Permission matrix: which actions each role may perform. requireRole checks the
// role itself; requirePermission checks intent (action on a resource), which is
// more resilient to a role gaining/losing a capability without touching every route.
const ROLE_PERMISSIONS = {
  // "admin" is the OVERALL system administrator (PDF: controls all tenant
  // companies) — platform-wide, never carries an organization. Tenant
  // admins are the separate "org_admin" role below; they used to be
  // "admin" + organization set, which meant this exact permission list
  // (including org:approve and iam:manage) was granted to org admins too.
  admin: [
    "org:approve",
    "org:manage",
    "user:manage",
    "security:view",
    "event:manage",
    "analytics:view",
    "ticket:verify",
    "audit:view",
    "iam:manage",
    "ai:manage",
    "collaboration:invite",
    "session:manage",
  ],
  // A tenant's admin, scoped to their own organization by every route
  // (listOrgUsers, getOrgEvents, buildUserEventFilter, etc. all filter on
  // req.user.organization). Deliberately excludes "org:approve" (approving
  // OTHER tenants) and "ai:manage" (retrains platform-wide shared models
  // and reads cross-tenant chat data) — those stay system-admin-only.
  org_admin: [
    "org:manage",
    "user:manage",
    "security:view",
    "event:manage",
    "analytics:view",
    "ticket:verify",
    "audit:view",
    "iam:manage",
    "collaboration:invite",
    "session:manage",
  ],
  organizer: [
    "event:manage",
    "analytics:view",
    "ticket:verify",
    "collaboration:invite",
    "session:manage",
  ],
  attendee: ["event:register", "ticket:view", "feedback:submit"],
};

// Roles live in MongoDB (seeded from the matrix above, editable by admins).
// Keep an in-memory cache so requirePermission doesn't hit the DB on every
// request; invalidated when an admin updates roles via the IAM API.
const roleCache = new Map();
let roleCacheLoaded = false;

const loadRoleCache = async () => {
  try {
    const roles = await Role.find({}).lean();
    roleCache.clear();
    roles.forEach((r) => roleCache.set(r.name, r.permissions || []));
    roleCacheLoaded = true;
  } catch (error) {
    // DB not ready (early boot) — fall back to the static matrix below.
    roleCacheLoaded = false;
  }
};

const getRolePermissions = (role) => {
  const fromDb = roleCache.get(role);
  if (fromDb) return fromDb;
  return ROLE_PERMISSIONS[role] || [];
};

// Invalidate the cache when an admin edits roles (called by the IAM API).
const invalidateRoleCache = () => {
  roleCache.clear();
  roleCacheLoaded = false;
};

const requireRole = (...roles) => authorize(...roles);

// Platform-level guard: the OVERALL system admin — role "admin" (tenant
// admins are the distinct "org_admin" role and never reach here). The
// `req.user.organization` check is redundant now that the roles are
// explicit, kept as defense-in-depth in case that invariant is ever
// violated. Used by the org-approval console and platform-wide functions
// (AI training) that operate across every tenant at once.
const requireSystemAdmin = (req, res, next) => {
  if (req.user?.role !== "admin" || req.user.organization) {
    return res.status(403).json({ message: "System admin privileges required" });
  }
  next();
};

const requirePermission = (permission) => {
  return async (req, res, next) => {
    if (!roleCacheLoaded) await loadRoleCache();
    const allowed = getRolePermissions(req.user.role);
    if (!allowed.includes(permission)) {
      return res
        .status(403)
        .json({ message: "Not authorized for this action" });
    }
    next();
  };
};

// Organization-level admin: the tenant owner (Organization.owner, kept for
// back-compat) or an active OrganizationMember with an admin-level
// roleInOrg (owner/admin/manager). Used for tenant-scoped management
// (membership, settings, collaboration invitations).
const requireOrgAdmin = async (req, res, next) => {
  try {
    const orgId = req.user?.organization;
    if (!orgId) {
      // Attendee is a normal user by design with NO organization requirement
      // (authController register: organization is optional for attendee).
      // Attendee-facing reads (speakers, sessions) must not 403 here; the
      // write routes that truly require org-admin add an explicit
      // authorize("organizer","admin","org_admin") ahead of this guard so an
      // attendee bypass here never grants write access. Organizer / org_admin
      // without an org is a misconfiguration and must still be rejected.
      if (req.user?.role === "attendee") return next();
      return res.status(403).json({ message: "User has no organization assigned" });
    }
    const [membership, organization] = await Promise.all([
      OrganizationMember.findOne({
        organization: orgId,
        user: req.user._id,
        status: "active",
      }).lean(),
      Organization.findById(orgId).lean(),
    ]);
    const isOwner =
      membership?.roleInOrg === "owner" ||
      (organization?.owner?.toString() === req.user._id.toString() && !membership);
    const isOrgAdmin = ["admin", "manager"].includes(membership?.roleInOrg);
    if (!isOwner && !isOrgAdmin) {
      return res.status(403).json({ message: "Not authorized for this organization" });
    }
    req.orgAdminRole = membership?.roleInOrg || "owner";
    next();
  } catch (error) {
    next(error);
  }
};

module.exports = {
  protect,
  optionalAuth,
  authorize,
  requireRole,
  requireSystemAdmin,
  requirePermission,
  requireOrgAdmin,
  loadRoleCache,
  invalidateRoleCache,
  getRolePermissions,
  ROLE_PERMISSIONS,
};
