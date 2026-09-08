import express from "express";
import { body } from "express-validator";
import {
  createSpeaker,
  getOrganizationSpeakers,
  getSpeakerById,
  updateSpeaker,
  deleteSpeaker,
} from "../controllers/speakerController";
import { protect, authorize, requireOrgAdmin } from "../middleware/auth";
import validate from "../middleware/validate";

const router = express.Router();

// Attendee-facing reads must not require org admin. Attendees are normal
// users without an organization (see authController register) and hit these
// from the Event Details page (useOrganizationSpeakers). Block them with
// 403 here would break the attendee experience.
router.get("/", protect, authorize("organizer", "admin", "org_admin", "attendee"), getOrganizationSpeakers);
router.get("/:id", protect, authorize("organizer", "admin", "org_admin", "attendee"), getSpeakerById);

router.post(
  "/",
  protect,
  authorize("organizer", "admin", "org_admin"),
  requireOrgAdmin,
  [body("name").notEmpty().withMessage("Speaker name is required")],
  validate,
  createSpeaker
);

router.put(
  "/:id",
  protect,
  authorize("organizer", "admin", "org_admin"),
  requireOrgAdmin,
  [
    body("name").optional().notEmpty().withMessage("Name cannot be empty"),
    body("email").optional().isEmail().withMessage("Invalid email"),
  ],
  validate,
  updateSpeaker
);

router.delete("/:id", protect, authorize("organizer", "admin", "org_admin"), requireOrgAdmin, deleteSpeaker);

export default router;
// @ts-ignore
module.exports = router;
