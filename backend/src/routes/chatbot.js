const express = require("express");
const { body } = require("express-validator");
const { query, getSuggestions } = require("../controllers/chatbotController");
const { protect } = require("../middleware/auth");
const validate = require("../middleware/validate");
const rateLimit = require("../middleware/rateLimit");

const router = express.Router();

// Chat answers and suggestion chips must never be served from a cache —
// every response is computed live from the current database so the bot
// always reflects the latest events, tickets and prices.
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

router.post(
  "/query",
  protect,
  rateLimit({ windowMs: 60_000, max: 20 }),
  [body("message").notEmpty().withMessage("message is required").isLength({ max: 2000 }).withMessage("message too long")],
  validate,
  query
);

router.get("/suggestions", protect, rateLimit({ windowMs: 60_000, max: 30 }), getSuggestions);

module.exports = router;
