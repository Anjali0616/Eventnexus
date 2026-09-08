const express = require("express");
const {
  getPaymentConfig,
  createCheckoutSession,
  getCheckoutStatus,
  initiateEsewaPayment,
  handleEsewaSuccess,
  handleEsewaFailure,
} = require("../controllers/paymentController");
const { protect, requireRole } = require("../middleware/auth");
const rateLimit = require("../middleware/rateLimit");

const checkoutLimiter = rateLimit({ windowMs: 60_000, max: 15 });

const router = express.Router();

router.get("/config", getPaymentConfig);
router.post(
  "/checkout/:id",
  protect,
  requireRole("attendee", "organizer", "admin", "org_admin"),
  checkoutLimiter,
  createCheckoutSession
);
router.get("/checkout/status/:sessionId", protect, requireRole("attendee", "organizer", "admin", "org_admin"), getCheckoutStatus);

router.post(
  "/esewa/initiate/:id",
  protect,
  requireRole("attendee", "organizer", "admin", "org_admin"),
  checkoutLimiter,
  initiateEsewaPayment
);
// eSewa redirects the user's browser to these directly (GET, no auth
// header available), so they're intentionally public — ticket issuance
// itself is still gated behind signature verification + a server-to-server
// status check inside the controller, not the redirect alone.
// eventId is carried as a path segment (not a query param) because eSewa's
// redirect appends its own `?data=...` query string to whatever URL we hand
// it — a query param here could get clobbered, a path segment can't.
const esewaLimiter = rateLimit({ windowMs: 60_000, max: 20 });
router.get("/esewa/success/:eventId?", esewaLimiter, handleEsewaSuccess);
router.get("/esewa/failure/:eventId?", esewaLimiter, handleEsewaFailure);

module.exports = router;
