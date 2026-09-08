const mongoose = require("mongoose");
const { OAuth2Client } = require("google-auth-library");
const User = require("../models/User");
const Session = require("../models/Session");
const Ticket = require("../models/Ticket");
const Event = require("../models/Event");
const Feedback = require("../models/Feedback");
const Notification = require("../models/Notification");
const Organization = require("../models/Organization");
const OrganizationMember = require("../models/OrganizationMember");
const generateToken = require("../utils/generateToken");
const { slugify } = require("./organizationController");
const { audit } = require("../utils/audit");
const { sendMail } = require("../utils/email");
const {
  generateRefreshToken,
  generateEmailToken,
  hashToken,
  parseDuration,
} = require("../utils/tokens");
const { parsePagination, parseSort, paginate } = require("../utils/query");

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const REFRESH_TTL_MS = parseDuration(process.env.JWT_REFRESH_EXPIRES_IN, 30 * 24 * 60 * 60 * 1000);
const EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h

// Emails that are automatically granted the admin role on sign-in.
// Configured via ADMIN_EMAILS; no fallback — avoids leaking personal email
// and prevents unintended privilege grant when env is missing.
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const isAdminEmail = (email) => ADMIN_EMAILS.includes((email || "").toLowerCase());

// Deactivated accounts (admin-managed, see User.active) are refused at every
// auth entry point: password login, Google sign-in, and refresh-token
// rotation. The message avoids leaking account state semantics to strangers —
// "disabled" only appears once the credential check has already passed.
const assertUserActive = (user) => {
  if (user && user.active === false) {
    return { status: 403, message: "Your account has been disabled by an administrator" };
  }
  return null;
};

// Admin routes are tenant-scoped, so an admin must belong to an organization.
// Attach the given user to the first existing org, creating a default one if
// none exists yet. Mutates the user document; caller is responsible for saving.
const assignDefaultOrg = async (user) => {
  if (user.organization) return;
  let org = await Organization.findOne({ status: "active" }).sort({ createdAt: 1 });
  if (!org) {
    org = await Organization.create({
      name: "EventNexus",
      slug: "eventnexus",
      owner: user._id,
    });
  }
  user.organization = org._id;
};

const serializeUser = (user) => ({
  _id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  organization: user.organization,
  location: user.location,
  // True when the account was created via Google sign-in — such accounts
  // have no password, so the UI hides the "change password" card.
  googleAccount: Boolean(user.googleId),
  // True once the email address has been confirmed (report §7). Google
  // accounts are verified on creation; local accounts via the link in the
  // verification email.
  emailVerified: Boolean(user.emailVerifiedAt),
});

// A coarse "same browser on the same device" key: normalized user-agent +
// the client IP. Tabs, profiles and incognito windows of the same browser
// share the user-agent, so this matches exactly the browser the user means;
// the IP keeps a user's phone (same UA pattern? no — different UA) and
// different devices apart. Good enough to enforce "one active session per
// account per browser" without logging the user out of their phone/laptop.
const deviceFingerprintFor = (req) => {
  const ua = (req.get("user-agent") || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
  return `${req.ip}::${ua}`;
};

// Create a refresh-token session for the user and return the plaintext
// token (the only time it's ever visible; the DB stores the hash).
// Enforces one active session per account per device: any other active
// session for the same user from the same browser (same fingerprint) is
// revoked, so logging in as a different account — or again as this one —
// never leaves the previous session alive in the same browser. Sessions on
// other devices (different user-agent) are untouched.
const createSession = async (user, req) => {
  const refreshToken = generateRefreshToken();
  const fingerprint = deviceFingerprintFor(req);
  // Revoke previous sessions on this device BEFORE creating the new one — otherwise
  // the updateMany would match the just-created row (or race with a concurrent login
  // and revoke the sibling's new session). One active session per device invariant
  // is enforced by clearing old ones first, then inserting.
  await Session.updateMany(
    {
      user: user._id,
      deviceFingerprint: fingerprint,
      revokedAt: null,
      expiresAt: { $gt: new Date() },
    },
    { $set: { revokedAt: new Date() } }
  );
  const session = await Session.create({
    user: user._id,
    refreshTokenHash: hashToken(refreshToken),
    ip: req.ip,
    userAgent: req.get("user-agent")?.slice(0, 300),
    deviceFingerprint: fingerprint,
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
  });
  return refreshToken;
};

// Issue a verification token + email a link (dev mode: logged to console /
// Mail collection). Regenerating the token invalidates the previous one,
// so a leaked link expires as soon as a new one is requested.
const sendVerificationEmail = async (user) => {
  const token = generateEmailToken();
  user.emailVerificationToken = hashToken(token);
  user.emailVerificationExpiresAt = new Date(Date.now() + EMAIL_TOKEN_TTL_MS);
  await user.save();

  const link = `${process.env.FRONTEND_URL}/verify-email?token=${token}`;
  await sendMail({
    to: user.email,
    subject: "Verify your EventNexus email",
    template: "verify-email",
    templateData: {
      name: user.name,
      link,
    },
    metadata: { link },
  });
};

const register = async (req, res) => {
  try {
    const { name, email, password, role, organizationId, organizationName } =
      req.body;

    // Public self-service registration is attendee-only. Organizer/admin
    // roles are privileged (event management, tenant administration), so
    // they're granted by an existing admin (users/:id/role) or via the
    // ADMIN_EMAILS allowlist on Google sign-in — never chosen on a form.
    // Before this fix, anyone could register as an "organizer" (or even
    // "admin" with a made-up org name) and get elevated permissions in an
    // existing tenant.
    const requestedRole = role || "attendee";
    if (
      (requestedRole === "org_admin" || requestedRole === "organizer") &&
      !isAdminEmail(email)
    ) {
      return res.status(403).json({
        message:
          "Organizer/admin registration is invite-only. Contact your organization admin to assign this role.",
      });
    }
    const resolvedRole =
      requestedRole === "org_admin" || requestedRole === "organizer"
        ? requestedRole
        : "attendee";

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "User already exists" });
    }

    let organization;

    if (resolvedRole === "org_admin") {
      // Org-admin sign-up creates a brand-new tenant; the signer becomes its
      // owner. The tenant starts "pending" — the system admin must approve
      // it before anyone (including this admin) can log in. (Self-service
      // sign-up is legacy; orgRegister is the intended onboarding flow.)
      if (!organizationName) {
        return res
          .status(400)
          .json({ message: "Organization name is required for org admin sign-up" });
      }
      const slug = slugify(organizationName);
      const slugTaken = await Organization.findOne({ slug });
      if (slugTaken) {
        return res
          .status(400)
          .json({ message: "An organization with that name already exists" });
      }
      // Owner is set after the user is created (chicken-and-egg on the ref).
      organization = await Organization.create({
        name: organizationName,
        slug,
        status: "pending",
        owner: new mongoose.Types.ObjectId(),
      });
    } else if (resolvedRole === "organizer") {
      // Organizer must belong to an organization
      if (!organizationId) {
        return res.status(400).json({ message: "Organization is required for organizer" });
      }
      organization = await Organization.findById(organizationId);
      if (!organization || organization.status !== "active") {
        return res.status(400).json({ message: "Invalid organization" });
      }
    } else {
      // Attendee: organization is optional — normal users can see all events without being tied to a tenant
      if (organizationId) {
        organization = await Organization.findById(organizationId);
        if (!organization || organization.status !== "active") {
          return res.status(400).json({ message: "Invalid organization" });
        }
      } else {
        organization = null;
      }
    }

    // adminGrantedAt is never set here — it exists only to make the
    // platform-wide "admin" role's ADMIN_EMAILS allowlist grant sticky
    // (see googleLogin below). This path only ever creates org_admin,
    // organizer, or attendee accounts, never the system admin.
    const user = await User.create({
      name,
      email,
      password,
      role: resolvedRole,
      organization: organization ? organization._id : null,
    });

    // For org_admin self-registration, fix the placeholder owner now that user exists.
    if (resolvedRole === "org_admin") {
      organization.owner = user._id;
      await organization.save();
      await OrganizationMember.create({
        user: user._id,
        organization: organization._id,
        roleInOrg: "owner",
        status: "active",
      });
      // Pending tenant — do not issue a session yet (mirrors orgRegister flow).
      // The org admin can log in only after a system admin approves the tenant;
      // issuing a token here would bypass the approval gate entirely.
      await sendVerificationEmail(user).catch((err) =>
        console.error("[verify-email] failed to send:", err.message)
      );
      audit({
        req,
        user,
        organization,
        action: "register",
        resourceType: "User",
        resourceId: user._id,
        metadata: { role: resolvedRole, via: "email" },
      });
      audit({
        req,
        user,
        organization,
        action: "organization_created",
        resourceType: "Organization",
        resourceId: organization._id,
        metadata: { name: organization.name },
      });
      return res.status(201).json({
        message:
          "Organization registration submitted. A system admin will review and approve it — you'll be able to log in once approved.",
        user: serializeUser(user),
      });
    }

    const token = generateToken(user._id, user.tokenVersion ?? 0);
    const refreshToken = await createSession(user, req);

    // A fresh local account must confirm its email before the platform is
    // fully usable (report §7). The verification link is emailed (dev mode:
    // console + Mail collection).
    await sendVerificationEmail(user).catch((err) =>
      console.error("[verify-email] failed to send:", err.message)
    );

    audit({
      req,
      user,
      organization,
      action: "register",
      resourceType: "User",
      resourceId: user._id,
      metadata: { role: resolvedRole, via: "email" },
    });
    if (resolvedRole === "org_admin") {
      audit({
        req,
        user,
        organization,
        action: "organization_created",
        resourceType: "Organization",
        resourceId: organization._id,
        metadata: { name: organization.name },
      });
    }

    res.status(201).json({ user: serializeUser(user), token, refreshToken });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

// --- Organization self-registration (approval workflow) ----------------------
// An org admin registers the organization with full details → status
// "pending". The overall system admin verifies and approves it; only then can
// the org's users log in (see login gate below). This is the ONLY way to
// create a tenant — there is no open "create org" endpoint anymore.
const orgRegister = async (req, res) => {
  try {
    const {
      orgName,
      orgEmail,
      orgPhone,
      orgAddress,
      orgCity,
      orgCountry,
      orgType,
      orgDescription,
      orgWebsite,
      adminName,
      adminEmail,
      adminPassword,
    } = req.body;

    if (!orgName || !adminName || !adminEmail || !adminPassword) {
      return res
        .status(400)
        .json({ message: "Organization name and admin credentials are required" });
    }
    if (adminPassword.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    // The org admin is always created as "org_admin" within their own tenant
    // — the distinct tenant-scoped role, never the platform-wide "admin".
    const existingUser = await User.findOne({ email: adminEmail });
    if (existingUser) {
      return res.status(400).json({ message: "An account with that email already exists" });
    }
    const slug = slugify(orgName);
    if (await Organization.findOne({ slug })) {
      return res.status(400).json({ message: "An organization with that name already exists" });
    }

    // The org's business email is the admin account's email — the form no
    // longer asks for the same address twice. (Default keeps older clients
    // that still send a distinct orgEmail working.)
    const orgEmailResolved = orgEmail || adminEmail;

    // Owner set after the user is created (chicken-and-egg on the ref).
    const organization = await Organization.create({
      name: orgName,
      slug,
      email: orgEmailResolved,
      phone: orgPhone,
      address: orgAddress,
      city: orgCity,
      country: orgCountry,
      type: orgType,
      description: orgDescription,
      website: orgWebsite,
      status: "pending",
      owner: new mongoose.Types.ObjectId(),
    });

    const user = await User.create({
      name: adminName,
      email: adminEmail,
      password: adminPassword,
      role: "org_admin",
      organization: organization._id,
    });
    organization.owner = user._id;
    await organization.save();

    await OrganizationMember.create({
      user: user._id,
      organization: organization._id,
      roleInOrg: "owner",
      status: "active",
    });

    // Verification email (dev mode: console + Mail collection).
    await sendVerificationEmail(user).catch((err) =>
      console.error("[verify-email] failed to send:", err.message)
    );

    audit({
      req,
      user,
      organization,
      action: "org_registered",
      resourceType: "Organization",
      resourceId: organization._id,
      metadata: { name: orgName, adminEmail },
    });

    res.status(201).json({
      message:
        "Organization registration submitted. A system admin will review and approve it — you'll be able to log in once approved.",
    });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

// Block logins while the user's org hasn't been approved. The org admin can
// register and create their account, but the tenant is dark until the
// system admin approves it — the whole point of the approval gate. The
// system admin itself (role "admin", no organization) is never gated.
const assertOrgApproved = async (user) => {
  if (!user.organization) return null;
  const org = await Organization.findById(user.organization).lean();
  if (!org) return null;
  if (org.status === "pending") {
    return {
      status: 403,
      message:
        "Your organization is awaiting approval by a system admin. You'll be able to log in once it's verified.",
      code: "ORG_PENDING",
    };
  }
  if (org.status === "rejected") {
    return {
      status: 403,
      message:
        org.rejectionReason
          ? `Your organization registration was rejected: ${org.rejectionReason}`
          : "Your organization registration was rejected. Contact support for details.",
      code: "ORG_REJECTED",
    };
  }
  if (org.status === "suspended") {
    return {
      status: 403,
      message: "Your organization is suspended. Contact support.",
      code: "ORG_SUSPENDED",
    };
  }
  return null;
};

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    const user = await User.findOne({ email }).select("+password");
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const disabled = assertUserActive(user);
    if (disabled) {
      return res.status(disabled.status).json({ message: disabled.message });
    }

    const gate = await assertOrgApproved(user);
    if (gate) {
      return res.status(gate.status).json({ message: gate.message, code: gate.code });
    }

    const token = generateToken(user._id, user.tokenVersion ?? 0);
    const refreshToken = await createSession(user, req);

    audit({
      req,
      user,
      organization: user.organization ? { _id: user.organization } : undefined,
      action: "login",
      resourceType: "User",
      resourceId: user._id,
      metadata: { via: "email" },
    });

    res.json({ user: serializeUser(user), token, refreshToken });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

const googleLogin = async (req, res) => {
  try {
    if (!process.env.GOOGLE_CLIENT_ID) {
      return res
        .status(500)
        .json({ message: "Google login is not configured on the server" });
    }

    const { credential } = req.body;
    if (!credential) {
      return res.status(400).json({ message: "Missing Google credential" });
    }

    // Verify the ID token came from Google and was issued for our client.
    const ticket = await googleClient.verifyIdToken({
      idToken: credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    const { sub: googleId, email, name, email_verified: emailVerified } = payload;

    if (!emailVerified) {
      return res
        .status(401)
        .json({ message: "Google account email is not verified" });
    }

    const admin = isAdminEmail(email);

    // Find an existing account by email, otherwise create one.
    let user = await User.findOne({ email });
    if (user) {
      let changed = false;
      // Link the Google identity to a pre-existing local account.
      if (!user.googleId) {
        user.googleId = googleId;
        changed = true;
      }
      // Google already verified this address (checked above) — a local
      // account that later signs in with the same, Google-confirmed email
      // shouldn't still be stuck behind the "verify your email" gate.
      if (!user.emailVerifiedAt) {
        user.emailVerifiedAt = new Date();
        changed = true;
      }
      // No silent role switch on login: allowlisted emails are NOT auto-promoted
      // on re-login. Admin must be granted explicitly via PUT /users/:id/role.
      // This prevents an attendee who is later added to ADMIN_EMAILS from
      // silently becoming admin on next Google sign-in and seeing /admin.
      // The adminGrantedAt check is kept for audit only, not for promotion.
      // Do NOT auto-assign an org to a system admin (admin without org).
      // System admins (role=admin, organization=null) must stay org-less so
      // requireSystemAdmin passes and they can approve tenants.
      if (changed) await user.save();
    } else {
      // New Google users always start as attendee — even if email is in
      // ADMIN_EMAILS, they must be promoted explicitly via admin panel.
      // Prevents QR scan -> Google sign-up from instantly becoming admin and
      // switching role away from attendee.
      user = new User({
        name: name || email.split("@")[0],
        email,
        googleId,
        role: "attendee",
        // adminGrantedAt is set only when explicitly promoted, not on creation
        // Keep for audit if needed: admin ? new Date() : undefined (removed)
        // Google verified this email before issuing the ID token (checked
        // above) — brand-new Google sign-ups are verified on creation.
        emailVerifiedAt: new Date(),
      });
      // Do NOT auto-assign org to new system admins — they must remain
      // organization-less to retain system-admin privileges.
      await user.save();
    }

    const disabled = assertUserActive(user);
    if (disabled) {
      return res.status(disabled.status).json({ message: disabled.message });
    }

    const gate = await assertOrgApproved(user);
    if (gate) {
      return res.status(gate.status).json({ message: gate.message, code: gate.code });
    }

    const token = generateToken(user._id, user.tokenVersion ?? 0);
    const refreshToken = await createSession(user, req);

    audit({
      req,
      user,
      organization: user.organization ? { _id: user.organization } : undefined,
      action: "login",
      resourceType: "User",
      resourceId: user._id,
      metadata: { via: "google" },
    });

    res.json({ user: serializeUser(user), token, refreshToken });
  } catch (error) {
    // Log the real cause; the client still gets a generic message so no
    // internal details (DB names, stack traces) leak through.
    console.error("[google] login failed:", error.message);
    res.status(401).json({ message: "Google authentication failed" });
  }
};

const getMe = async (req, res) => {
  res.json({ user: serializeUser(req.user) });
};

// --- Refresh-token rotation (report §7) ------------------------------------
// Each refresh rotates: the presented token's hash is checked against the
// stored one, then immediately replaced with a new token+hash pair. If the
// presented hash no longer matches (reuse — the old token was replayed), the
// session is treated as stolen: every session for that user is revoked.
const refresh = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ message: "refreshToken is required" });
    }
    const tokenHash = hashToken(refreshToken);

    const session = await Session.findOne({ refreshTokenHash: tokenHash }).select(
      "+refreshTokenHash +previousTokenHash"
    );
    if (!session) {
      // Not the current hash. Either a garbage token (401, no action) or a
      // REUSED pre-rotation token — the exact theft pattern rotation exists
      // to catch: the attacker presents the client's old token, and the
      // legitimate client's new token won't be current anymore either. When
      // the previous hash matches, revoke every session for the user (their
      // refresh chain is compromised) and refuse the rotation.
      const replayed = await Session.findOne({ previousTokenHash: tokenHash }).select("+previousTokenHash");
      if (replayed) {
        const victim = await User.findById(replayed.user);
        await Session.updateMany({ user: replayed.user, revokedAt: null }, { revokedAt: new Date() });
        if (victim) {
          victim.tokenVersion = (victim.tokenVersion ?? 0) + 1;
          await victim.save();
        }
        console.warn(
          `[refresh] token reuse detected for ${replayed.user} — all sessions revoked`
        );
        audit({
          req,
          user: victim || undefined,
          action: "session_reuse_detected",
          resourceType: "User",
          resourceId: replayed.user,
          metadata: { ip: req.ip },
        });
      }
      return res.status(401).json({ message: "Invalid refresh token" });
    }
    if (session.revokedAt || session.expiresAt <= new Date()) {
      return res.status(401).json({ message: "Refresh token has expired or was revoked" });
    }

    const user = await User.findById(session.user);
    if (!user) {
      return res.status(401).json({ message: "User no longer exists" });
    }
    // Deactivation revokes every session server-side, but defensive gate:
    // never rotate a refresh token for a disabled account even if a revoke
    // raced with an in-flight request.
    const disabled = assertUserActive(user);
    if (disabled) {
      await Session.updateMany({ user: user._id, revokedAt: null }, { revokedAt: new Date() });
      return res.status(disabled.status).json({ message: disabled.message });
    }
    // Block refresh for pending/suspended/rejected tenants — same gate as login.
    const gate = await assertOrgApproved(user);
    if (gate) {
      await Session.updateMany({ user: user._id, revokedAt: null }, { revokedAt: new Date() });
      return res.status(gate.status).json({ message: gate.message, code: gate.code });
    }

    // Rotation: mint a new token, swap the stored hash (the old token is
    // now dead on the server side, even though the client still holds it).
    // The just-replaced hash is kept as previousTokenHash for reuse
    // detection on the next request.
    const newRefreshToken = generateRefreshToken();
    session.previousTokenHash = session.refreshTokenHash;
    session.refreshTokenHash = hashToken(newRefreshToken);
    session.lastUsedAt = new Date();
    await session.save();

    audit({
      req,
      user,
      organization: user.organization ? { _id: user.organization } : undefined,
      action: "refresh",
      resourceType: "Session",
      resourceId: session._id,
    });

    res.json({ token: generateToken(user._id, user.tokenVersion ?? 0), refreshToken: newRefreshToken, user: serializeUser(user) });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

const logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ message: "refreshToken is required" });
    }
    const session = await Session.findOne({ refreshTokenHash: hashToken(refreshToken) });
    if (session && !session.revokedAt) {
      session.revokedAt = new Date();
      await session.save();
    }
    // Idempotent: logging out with an already-revoked token still succeeds.
    res.json({ message: "Logged out" });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

// List the user's own active sessions (device/ip/browser) so they can see
// and revoke unrecognized logins.
const listSessions = async (req, res) => {
  try {
    const { page, limit, skip } = parsePagination(req.query, {
      defaultLimit: 10,
      maxLimit: 50,
    });
    const filter = { user: req.user._id, revokedAt: null };
    const sort = parseSort(req.query.sort, ["createdAt", "lastUsedAt"], {
      lastUsedAt: -1,
    });

    const { data, pagination } = await paginate(Session, {
      filter,
      page,
      limit,
      skip,
      sort,
    });

    res.json({
      sessions: data.map((s) => ({
        _id: s._id,
        ip: s.ip,
        userAgent: s.userAgent,
        createdAt: s.createdAt,
        lastUsedAt: s.lastUsedAt,
        expiresAt: s.expiresAt,
      })),
      pagination,
    });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

const revokeSession = async (req, res) => {
  try {
    const session = await Session.findOne({ _id: req.params.id, user: req.user._id });
    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }
    session.revokedAt = new Date();
    await session.save();
    audit({
      req,
      action: "session_revoked",
      resourceType: "Session",
      resourceId: session._id,
      metadata: { by: req.user._id },
    });
    res.json({ message: "Session revoked" });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

// --- Email verification (report §7) ----------------------------------------
const verifyEmail = async (req, res) => {
  try {
    const { token } = req.params;
    if (!token) {
      return res.status(400).json({ message: "Verification token is required" });
    }
    const user = await User.findOne({ emailVerificationToken: hashToken(token) }).select(
      "+emailVerificationToken"
    );
    if (!user || !user.emailVerificationExpiresAt || user.emailVerificationExpiresAt < new Date()) {
      return res.status(400).json({ message: "Verification link is invalid or has expired" });
    }
    user.emailVerifiedAt = new Date();
    user.emailVerificationToken = undefined;
    user.emailVerificationExpiresAt = undefined;
    await user.save();

    audit({
      req,
      user,
      organization: user.organization ? { _id: user.organization } : undefined,
      action: "email_verified",
      resourceType: "User",
      resourceId: user._id,
    });

    res.json({ message: "Email verified successfully" });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

const resendVerification = async (req, res) => {
  try {
    if (req.user.emailVerifiedAt) {
      return res.status(400).json({ message: "Email is already verified" });
    }
    await sendVerificationEmail(req.user);
    res.json({ message: "Verification email sent" });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

// --- Password reset (report §7) --------------------------------------------
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
      // Don't reveal whether the account exists; same response either way.
      return res.json({ message: "If an account exists, a reset link has been sent" });
    }
    const token = generateEmailToken();
    user.passwordResetToken = hashToken(token);
    user.passwordResetExpiresAt = new Date(Date.now() + EMAIL_TOKEN_TTL_MS);
    await user.save();

    const link = `${process.env.FRONTEND_URL}/reset-password?token=${token}`;
    await sendMail({
      to: user.email,
      subject: "Reset your EventNexus password",
      template: "password-reset",
      templateData: {
        name: user.name,
        link,
      },
      metadata: { link, token },
    });

    audit({
      req,
      user,
      organization: user.organization ? { _id: user.organization } : undefined,
      action: "password_reset_requested",
      resourceType: "User",
      resourceId: user._id,
    });

    res.json({ message: "If an account exists, a reset link has been sent" });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

const resetPassword = async (req, res) => {
  try {
    const { token, password } = req.body;
    if (!token || !password) {
      return res.status(400).json({ message: "token and password are required" });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }
    const user = await User.findOne({ passwordResetToken: hashToken(token) }).select(
      "+passwordResetToken +password"
    );
    if (!user || !user.passwordResetExpiresAt || user.passwordResetExpiresAt < new Date()) {
      return res.status(400).json({ message: "Reset link is invalid or has expired" });
    }
    user.password = password;
    user.passwordResetToken = undefined;
    user.passwordResetExpiresAt = undefined;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpiresAt = undefined;
    // A password reset means any previously-issued credentials are suspect:
    // bump the token version (kills every outstanding JWT) and revoke every
    // refresh session so all devices must re-authenticate.
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    await user.save();
    await Session.updateMany({ user: user._id, revokedAt: null }, { revokedAt: new Date() });

    audit({
      req,
      user,
      organization: user.organization ? { _id: user.organization } : undefined,
      action: "password_reset",
      resourceType: "User",
      resourceId: user._id,
    });

    res.json({ message: "Password has been reset. Please log in again." });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

// GDPR: Export all personal data associated with the current user.
const exportMyData = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).lean();

    const [tickets, events, feedback, notifications, sessions] = await Promise.all([
      Ticket.find({ attendee: user._id })
        .populate("event", "title date venue")
        .lean(),
      Event.find({ organizer: user._id }).select("title date venue status").lean(),
      Feedback.find({ attendee: user._id }).lean(),
      Notification.find({ recipient: user._id }).lean(),
      Session.find({ user: user._id }).lean(),
    ]);

    const exportData = {
      profile: {
        name: user.name,
        email: user.email,
        role: user.role,
        organization: user.organization,
        location: user.location,
        emailVerifiedAt: user.emailVerifiedAt,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      },
      tickets: tickets.map((t) => ({
        event: t.event,
        status: t.status,
        checkedInAt: t.checkedInAt,
        createdAt: t.createdAt,
      })),
      organizedEvents: events.map((e) => ({
        title: e.title,
        date: e.date,
        venue: e.venue,
        status: e.status,
      })),
      feedback: feedback.map((f) => ({
        event: f.event,
        rating: f.rating,
        comment: f.comment,
        sentiment: f.sentiment,
        createdAt: f.createdAt,
      })),
      notifications: notifications.map((n) => ({
        type: n.type,
        title: n.title,
        message: n.message,
        read: n.read,
        createdAt: n.createdAt,
      })),
      sessions: sessions.map((s) => ({
        ip: s.ip,
        userAgent: s.userAgent,
        createdAt: s.createdAt,
        lastUsedAt: s.lastUsedAt,
        revokedAt: s.revokedAt,
        expiresAt: s.expiresAt,
      })),
    };

    res.setHeader("Content-Type", "application/json");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="eventnexus-data-export-${user._id}-${Date.now()}.json"`
    );
    res.send(JSON.stringify(exportData, null, 2));
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

// GDPR: Delete the current user's account (right to erasure).
// Anonymizes user-owned content instead of hard-deleting to preserve
// event integrity (tickets, feedback, analytics). The user can no longer log in.
const deleteMyAccount = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Revoke all sessions immediately.
    await Session.updateMany({ user: user._id, revokedAt: null }, { revokedAt: new Date() });

    const preDeleteOrg = user.organization;
    // Anonymize the user record (preserve _id for FK integrity).
    user.name = "Deleted User";
    user.email = `deleted-${user._id}@eventnexus.local`;
    // Set a dummy password + googleId so the model doesn't require a password
    // and the pre-save hook doesn't try to hash undefined.
    user.password = "deleted-account-" + user._id;
    user.googleId = `deleted-${user._id}`;
    user.role = "attendee";
    user.tokenVersion = (user.tokenVersion ?? 0) + 1;
    user.emailVerifiedAt = null;
    user.emailVerificationToken = undefined;
    user.emailVerificationExpiresAt = undefined;
    user.passwordResetToken = undefined;
    user.passwordResetExpiresAt = undefined;
    user.location = undefined;
    user.reminderEmail = false;
    user.organization = null;
    await user.save();

    // Anonymize tickets: remove attendee reference but keep event/qr for check-in integrity.
    await Ticket.updateMany(
      { attendee: user._id },
      { $set: { attendee: null } }
    );

    // Anonymize feedback: remove attendee reference, keep rating/comment for analytics.
    await Feedback.updateMany({ attendee: user._id }, { $set: { attendee: null } });

    // Anonymize notifications: remove recipient reference.
    await Notification.updateMany({ recipient: user._id }, { $set: { recipient: null } });

    // Remove OrganizationMember records.
    await OrganizationMember.deleteMany({ user: user._id });

    audit({
      req,
      user: { _id: user._id }, // minimal user object for audit
      organization: preDeleteOrg ? { _id: preDeleteOrg } : undefined,
      action: "account_deleted",
      resourceType: "User",
      resourceId: user._id,
    });

    res.json({ message: "Your account has been permanently deleted. You will be logged out." });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

module.exports = {
  register,
  orgRegister,
  login,
  googleLogin,
  getMe,
  refresh,
  logout,
  listSessions,
  revokeSession,
  verifyEmail,
  resendVerification,
  forgotPassword,
  resetPassword,
  exportMyData,
  deleteMyAccount,
};
