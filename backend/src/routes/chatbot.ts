import express, { Request, Response, NextFunction } from "express";
import { body } from "express-validator";
import { query, getSuggestions } from "../controllers/chatbotController";
import { protect } from "../middleware/auth";
import validate from "../middleware/validate";
import rateLimit from "../middleware/rateLimit";

const router = express.Router();

// Chat answers and suggestion chips must never be served from a cache —
// every response is computed live from the current database so the bot
// always reflects the latest events, tickets and prices.
router.use((req: Request, res: Response, next: NextFunction) => {
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

export default router;
// @ts-ignore
module.exports = router;
