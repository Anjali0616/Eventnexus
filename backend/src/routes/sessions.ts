import express from "express";
import { body } from "express-validator";
import {
  createSession,
  getEventSessions,
  getSessionById,
  updateSession,
  deleteSession,
} from "../controllers/sessionController";
import { protect, authorize } from "../middleware/auth";
import validate from "../middleware/validate";

const router = express.Router({ mergeParams: true });

// Session routes (event-scoped)
router.get("/", protect, authorize("organizer", "admin", "org_admin", "attendee"), getEventSessions);
router.get("/:id", protect, authorize("organizer", "admin", "org_admin", "attendee"), getSessionById);

router.post(
  "/",
  protect,
  authorize("organizer", "admin", "org_admin"),
  [
    body("title").notEmpty().withMessage("Title is required"),
    body("startTime").notEmpty().withMessage("startTime is required"),
    body("endTime").notEmpty().withMessage("endTime is required"),
    body("track").optional().isString(),
    body("speakers").optional().isArray(),
    body("capacity").optional().isInt({ min: 0 }),
    body("isPublic").optional().isBoolean(),
  ],
  validate,
  createSession
);

router.put(
  "/:id",
  protect,
  authorize("organizer", "admin", "org_admin"),
  [
    body("title").optional().notEmpty().withMessage("Title cannot be empty"),
    body("startTime").optional().isISO8601().withMessage("Invalid startTime"),
    body("endTime").optional().isISO8601().withMessage("Invalid endTime"),
    body("speakers").optional().isArray(),
    body("capacity").optional().isInt({ min: 0 }),
    body("isPublic").optional().isBoolean(),
    body("status").optional().isIn(["scheduled", "live", "completed", "cancelled"]),
  ],
  validate,
  updateSession
);

router.delete("/:id", protect, authorize("organizer", "admin", "org_admin"), deleteSession);

export default router;
// @ts-ignore
module.exports = router;
