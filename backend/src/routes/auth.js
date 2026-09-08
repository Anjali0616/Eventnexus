const express = require("express");
const { body, param } = require("express-validator");
const {
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
} = require("../controllers/authController");
const { protect } = require("../middleware/auth");
const validate = require("../middleware/validate");
const rateLimit = require("../middleware/rateLimit");

const router = express.Router();
// One bucket per endpoint — sharing a single limiter across login, register
// and google meant a burst on one blocked the other two as well.
const registerLimiter = rateLimit({ windowMs: 60_000, max: 10 });
const loginLimiter = rateLimit({ windowMs: 60_000, max: 10 });
const googleLimiter = rateLimit({ windowMs: 60_000, max: 10 });
const forgotLimiter = rateLimit({ windowMs: 60_000, max: 5 });
const refreshLimiter = rateLimit({ windowMs: 60_000, max: 60 });
const orgRegisterLimiter = rateLimit({ windowMs: 60_000, max: 5 });

// --- Organization self-registration (approval workflow) ----------------------
// Registers the org with full details → "pending" until a system admin
// approves it. The org admin's account is created but cannot log in before
// approval.
router.post(
  "/org-register",
  orgRegisterLimiter,
  [
    body("orgName").notEmpty().withMessage("Organization name is required"),
    body("adminName").notEmpty().withMessage("Admin name is required"),
    body("adminEmail").isEmail().withMessage("Valid admin email is required"),
    body("adminPassword")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
  ],
  validate,
  orgRegister
);

router.post(
  "/register",
  registerLimiter,
  [
    body("name").notEmpty().withMessage("Name is required"),
    body("email").isEmail().withMessage("Valid email is required"),
    body("password")
      .isLength({ min: 6 })
      .withMessage("Password must be at least 6 characters"),
    body("role")
      .optional()
      .isIn(["org_admin", "organizer", "attendee"])
      .withMessage("Invalid role"),
    body("organizationId")
      .optional()
      .isMongoId()
      .withMessage("Invalid organization"),
    body("organizationName")
      .optional()
      .trim()
      .notEmpty()
      .withMessage("Organization name cannot be empty"),
    body("interests")
      .optional()
      .isArray({ max: 10 })
      .withMessage("interests must be an array (max 10)"),
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
  register
);

router.post(
  "/login",
  loginLimiter,
  [
    body("email").isEmail().withMessage("Valid email is required"),
    body("password").notEmpty().withMessage("Password is required"),
  ],
  validate,
  login
);

router.post(
  "/google",
  googleLimiter,
  [body("credential").notEmpty().withMessage("Google credential is required")],
  validate,
  googleLogin
);

router.get("/me", protect, getMe);

// --- Refresh-token sessions (report §7) -------------------------------------
router.post("/refresh", refreshLimiter, [body("refreshToken").notEmpty().withMessage("refreshToken is required")], validate, refresh);
router.post("/logout", [body("refreshToken").notEmpty().withMessage("refreshToken is required")], validate, logout);
router.get("/sessions", protect, listSessions);
router.delete("/sessions/:id", protect, [param("id").isMongoId().withMessage("Invalid session id")], validate, revokeSession);

// --- Email verification (report §7) -----------------------------------------
router.post("/verify-email/:token", verifyEmail);
router.post("/resend-verification", protect, resendVerification);

// --- Password reset (report §7) ---------------------------------------------
router.post("/forgot-password", forgotLimiter, [body("email").isEmail().withMessage("Valid email is required")], validate, forgotPassword);
router.post(
  "/reset-password",
  forgotLimiter,
  [
    body("token").notEmpty().withMessage("token is required"),
    body("password").isLength({ min: 6 }).withMessage("Password must be at least 6 characters"),
  ],
  validate,
  resetPassword
);

// --- GDPR: Data export & Account deletion ------------------------------------
router.get("/me/export", protect, exportMyData);
router.delete("/me", protect, deleteMyAccount);

module.exports = router;
