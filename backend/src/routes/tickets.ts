import express from "express";
import { body } from "express-validator";
import { getMyTickets, cancelTicket, verifyTicket } from "../controllers/ticketController";
import { protect, requireRole } from "../middleware/auth";
import validate from "../middleware/validate";

const router = express.Router();

router.get("/my", protect, requireRole("attendee", "organizer", "admin", "org_admin"), getMyTickets);

router.post("/:id/cancel", protect, requireRole("attendee", "organizer", "admin", "org_admin"), cancelTicket);

router.post(
  "/verify",
  protect,
  requireRole("organizer", "admin", "org_admin"),
  [body("qrToken").notEmpty().withMessage("qrToken is required")],
  validate,
  verifyTicket
);

export default router;
// @ts-ignore
module.exports = router;
