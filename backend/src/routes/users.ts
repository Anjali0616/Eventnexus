import express from "express";
import { body, param } from "express-validator";
import {
  listOrgUsers,
  createUser,
  updateUserRole,
  getUserDetail,
  listUserSessions,
  updateUserStatus,
  revokeUserSessions,
  adminResetPassword,
  removeUser,
  updateMyLocation,
  updateMyProfile,
  updateMyPassword,
  updateMyInterests,
  updateReminderPreference,
  getMySavedEvents,
  addSavedEvent,
  removeSavedEvent,
  getOrgStats,
} from "../controllers/userController";
import { protect, requireRole } from "../middleware/auth";
import validate from "../middleware/validate";

const router = express.Router();

// Available to any authenticated user (not just admins). lat/lng are
// optional: omitting them clears the saved location (used by the settings
// page's "Remove location").
router.patch(
  "/me/location",
  protect,
  [
    body("lat").optional().isFloat({ min: -90, max: 90 }).withMessage("lat must be between -90 and 90"),
    body("lng").optional().isFloat({ min: -180, max: 180 }).withMessage("lng must be between -180 and 180"),
    body("city").optional().isString(),
  ],
  validate,
  updateMyLocation
);

// Settings endpoints — available to every authenticated role so the same
// settings UI works on the attendee, organizer and admin dashboards.
router.patch(
  "/me/profile",
  protect,
  [
    body("name").optional().isString().trim().notEmpty().withMessage("Name is required"),
    body("interests").optional().isArray({ max: 10 }).withMessage("interests must be an array (max 10)"),
    body("interests.*")
      .optional()
      .isString()
      .isIn([
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
      ])
      .withMessage("Invalid interest category"),
  ],
  validate,
  updateMyProfile
);

router.patch(
  "/me/interests",
  protect,
  [
    body("interests").isArray({ max: 10 }).withMessage("interests must be an array (max 10)"),
    body("interests.*")
      .isString()
      .isIn([
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
      ])
      .withMessage("Invalid interest category"),
  ],
  validate,
  updateMyInterests
);

router.patch(
  "/me/reminders",
  protect,
  [body("reminderEmail").isBoolean().withMessage("reminderEmail must be a boolean")],
  validate,
  updateReminderPreference
);

router.patch(
  "/me/password",
  protect,
  [
    body("currentPassword").notEmpty().withMessage("Current password is required"),
    body("newPassword").isLength({ min: 6 }).withMessage("New password must be at least 6 characters"),
  ],
  validate,
  updateMyPassword
);

// Server-side saved events — available to every authenticated role.
// Must be declared BEFORE /:id routes (Express matches sequentially; /:id
// would capture "me" otherwise).
router.get("/me/saved-events", protect, getMySavedEvents);
router.post("/me/saved-events/:eventId", protect, addSavedEvent);
router.delete("/me/saved-events/:eventId", protect, removeSavedEvent);

router.get("/", protect, requireRole("admin", "org_admin"), listOrgUsers);
router.get("/stats", protect, requireRole("admin", "org_admin"), getOrgStats);

// --- Admin user management (report §18 identity management) ---
const mongoIdParam = param("id").isMongoId().withMessage("Invalid user id");

// Full admin profile of one user (live activity, sessions, ticket/event
// counts). Org admins are tenant-scoped; the system admin sees every tenant.
router.get("/:id", protect, requireRole("admin", "org_admin"), [mongoIdParam], validate, getUserDetail);
// Refresh sessions (devices) of one user, newest first.
router.get("/:id/sessions", protect, requireRole("admin", "org_admin"), [mongoIdParam], validate, listUserSessions);
// Deactivate / reactivate an account. Deactivation revokes every session and
// blocks further logins; the account keeps its data and can be restored.
router.patch(
  "/:id/status",
  protect,
  requireRole("admin", "org_admin"),
  [mongoIdParam, body("active").isBoolean().withMessage("active must be a boolean")],
  validate,
  updateUserStatus
);
// Log the user out of every device (sessions revoked, tokens invalidated).
router.post(
  "/:id/revoke-sessions",
  protect,
  requireRole("admin", "org_admin"),
  [mongoIdParam],
  validate,
  revokeUserSessions
);
// Admin-initiated password reset — emails the user a single-use reset link;
// the admin never sees or sets a password. Only for local (non-Google)
// accounts.
router.post(
  "/:id/reset-password",
  protect,
  requireRole("admin", "org_admin"),
  [mongoIdParam],
  validate,
  adminResetPassword
);
// Permanent removal — guarded (no self, no tenant owner, no last admin, no
// active tickets or hosted events). Deactivation is the recommended
// reversible alternative and is always available.
router.delete(
  "/:id",
  protect,
  requireRole("admin", "org_admin"),
  [mongoIdParam],
  validate,
  removeUser
);

router.post(
  "/",
  protect,
  requireRole("admin", "org_admin"),
  [
    body("name").notEmpty().withMessage("Name is required"),
    body("email").isEmail().withMessage("Valid email is required"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
    // "admin" (system admin) is never provisioned here — it is org-less and
    // only granted via ADMIN_EMAILS allowlist. Listing it here would imply
    // an org admin could create a platform admin inside a tenant.
    body("role").optional().isIn(["org_admin", "organizer", "attendee"]).withMessage("Invalid role"),
    body("organizationId")
      .optional()
      .isMongoId()
      .withMessage("organizationId must be a valid id"),
  ],
  validate,
  createUser
);
router.put(
  "/:id/role",
  protect,
  requireRole("admin", "org_admin"),
  [
    body("role")
      .isIn(["org_admin", "organizer", "attendee"])
      .withMessage("Invalid role"),
  ],
  validate,
  updateUserRole
);

export default router;
// @ts-ignore
module.exports = router;
