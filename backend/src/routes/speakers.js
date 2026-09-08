const express = require("express");
const { body, param } = require("express-validator");
const {
  createSpeaker,
  getOrganizationSpeakers,
  getSpeakerById,
  updateSpeaker,
  deleteSpeaker,
} = require("../controllers/speakerController");
const { protect, authorize, requireOrgAdmin } = require("../middleware/auth");
const validate = require("../middleware/validate");

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

module.exports = router;