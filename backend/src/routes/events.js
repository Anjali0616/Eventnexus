const express = require("express");
const { body } = require("express-validator");
const {
  createEvent,
  getMyEvents,
  getEventById,
  updateEvent,
  deleteEvent,
  getAllEvents,
  getOrgEvents,
  getEventAiInsight,
  removeCoHostOrganization,
  listCoHostOrganizations,
} = require("../controllers/eventController");
const {
  createInvitation,
  listEventInvitations,
  cancelInvitation,
} = require("../controllers/coHostInvitationController");
const { registerForEvent, getEventAttendees } = require("../controllers/ticketController");
const {
  submitFeedback,
  getMyFeedback,
  getEventFeedback,
} = require("../controllers/feedbackController");
const { getEventNetworking } = require("../controllers/networkingController");
const { protect, optionalAuth, authorize, requireRole, requirePermission } = require("../middleware/auth");
const validate = require("../middleware/validate");
const rateLimit = require("../middleware/rateLimit");

const registerLimiter = rateLimit({ windowMs: 60_000, max: 15 });
const feedbackLimiter = rateLimit({ windowMs: 60_000, max: 10 });
const createEventLimiter = rateLimit({ windowMs: 60_000, max: 5 });
const updateEventLimiter = rateLimit({ windowMs: 60_000, max: 20 });
const aiDraftLimiter = rateLimit({ windowMs: 60_000, max: 20 });

const router = express.Router();

router.get("/", getAllEvents);

router.get("/my", protect, authorize("organizer", "admin", "org_admin"), getMyEvents);

router.get("/org", protect, authorize("admin", "org_admin"), getOrgEvents);

router.get("/:id", optionalAuth, getEventById);

// Full attendee roster for a managed event (organizer/admin) — powers the
// Tickets & Check-in dashboard's attendee list + per-attendee detail view.
router.get("/:id/attendees", protect, authorize("organizer", "admin", "org_admin"), getEventAttendees);

// Real AI insight (LLM with heuristic fallback) + attendance forecast for
// the organizer's event workspace.
router.get("/:id/ai-insight", protect, authorize("organizer", "admin", "org_admin"), getEventAiInsight);

router.post(
  "/ai-draft",
  protect,
  authorize("organizer", "admin", "org_admin"),
  aiDraftLimiter,
  [
    body("title").notEmpty().withMessage("Title is required"),
    body("category").optional().isString(),
    body("type").optional().isIn(["In-person", "Hybrid", "Virtual"]),
    body("venue").optional().isString(),
    body("capacity").optional().isInt({ min: 1 }),
  ],
  validate,
  require("../controllers/eventController").generateEventDraft
);

router.post(
  "/",
  protect,
  authorize("organizer", "admin", "org_admin"),
  createEventLimiter,
  [
    body("title").notEmpty().withMessage("Title is required"),
    body("status").optional().isIn(["Draft", "Upcoming", "Live", "Past"]).withMessage("Invalid status"),
    body("date")
      .if((value, { req }) => req.body.status !== "Draft")
      .notEmpty().withMessage("Date is required")
      .isISO8601().withMessage("Invalid date"),
    body("date").if((value, { req }) => req.body.status === "Draft").optional({ checkFalsy: true }).isISO8601().withMessage("Invalid date"),
    body("venue")
      .if((value, { req }) => req.body.status !== "Draft")
      .notEmpty().withMessage("Venue is required"),
    body("venue").if((value, { req }) => req.body.status === "Draft").optional({ checkFalsy: true }).isString(),
    body("category").notEmpty().withMessage("Category is required"),
    body("capacity")
      .if((value, { req }) => req.body.status !== "Draft")
      .isInt({ min: 1, max: 1000000 }).withMessage("Capacity must be between 1 and 1,000,000"),
    body("capacity").if((value, { req }) => req.body.status === "Draft").optional({ checkFalsy: true }).isInt({ min: 1, max: 1000000 }).withMessage("Capacity must be between 1 and 1,000,000"),
    body("type")
      .optional()
      .isIn(["In-person", "Hybrid", "Virtual"])
      .withMessage("Invalid event type"),
    body("imageUrl").optional().isLength({ max: 6_000_000 }).withMessage("Image is too large (max 6MB)"),
    body("tags").optional().isArray({ max: 20 }).withMessage("Tags must be a list (max 20)"),
    body("tags.*").optional().isString().trim().isLength({ max: 50 }).withMessage("Each tag max 50 chars"),
    body("highlights").optional().isArray({ max: 20 }).withMessage("Highlights must be a list (max 20)"),
    body("highlights.*").optional().isString().trim().isLength({ max: 200 }).withMessage("Each highlight max 200 chars"),
    body("agenda").optional().isArray({ max: 50 }).withMessage("Agenda must be a list (max 50)"),
    body("speakers").optional().isArray({ max: 30 }).withMessage("Speakers must be a list (max 30)"),
    body("contactEmail").optional({ checkFalsy: true }).isEmail().withMessage("Invalid contact email"),
    body("contactPhone").optional({ checkFalsy: true }).isLength({ max: 30 }).withMessage("Phone too long"),
    body("website").optional({ checkFalsy: true }).isURL({ require_protocol: true }).withMessage("Website must be a valid URL (https://...)"),
  ],
  validate,
  createEvent
);

router.put(
  "/:id",
  protect,
  authorize("organizer", "admin", "org_admin"),
  updateEventLimiter,
  [
    body("title").optional().isString().trim().isLength({ min: 3, max: 120 }).withMessage("Title must be 3-120 chars"),
    body("status").optional().isIn(["Draft", "Upcoming", "Live", "Past"]).withMessage("Invalid status"),
    body("date").optional({ checkFalsy: true }).isISO8601().withMessage("Invalid date"),
    body("venue").optional({ checkFalsy: true }).isString().trim().isLength({ min: 2, max: 200 }).withMessage("Venue must be 2-200 chars"),
    body("category").optional().isString().trim().isLength({ min: 2, max: 50 }).withMessage("Category must be 2-50 chars"),
    body("capacity").optional({ checkFalsy: true }).isInt({ min: 1, max: 1000000 }).withMessage("Capacity must be between 1 and 1,000,000"),
    body("type").optional().isIn(["In-person", "Hybrid", "Virtual"]).withMessage("Invalid event type"),
    body("imageUrl").optional({ checkFalsy: true }).isLength({ max: 6_000_000 }).withMessage("Image is too large (max 6MB)"),
    body("tags").optional().isArray({ max: 20 }).withMessage("Tags must be a list (max 20)"),
    body("tags.*").optional().isString().trim().isLength({ max: 50 }).withMessage("Each tag max 50 chars"),
    body("highlights").optional().isArray({ max: 20 }).withMessage("Highlights must be a list (max 20)"),
    body("highlights.*").optional().isString().trim().isLength({ max: 200 }).withMessage("Each highlight max 200 chars"),
    body("agenda").optional().isArray({ max: 50 }).withMessage("Agenda must be a list (max 50)"),
    body("speakers").optional().isArray({ max: 30 }).withMessage("Speakers must be a list (max 30)"),
    body("contactEmail").optional({ checkFalsy: true }).isEmail().withMessage("Invalid contact email"),
    body("contactPhone").optional({ checkFalsy: true }).isLength({ max: 30 }).withMessage("Phone too long"),
    body("website").optional({ checkFalsy: true }).isURL({ require_protocol: true }).withMessage("Website must be a valid URL"),
    body("price").optional().custom((val) => {
      if (val == null || val === "") return true;
      if (typeof val === "object") {
        if (val.amount != null && String(val.amount).trim() !== "" && !Number.isFinite(Number(val.amount))) throw new Error("Price amount must be numeric");
        return true;
      }
      if (!Number.isFinite(Number(val))) throw new Error("Price must be numeric");
      return true;
    }),
  ],
  validate,
  updateEvent
);

router.delete("/:id", protect, authorize("organizer", "admin", "org_admin"), deleteEvent);

// Co-host organization management (event organizer or owning org admin)
router.get(
  "/:id/co-hosts",
  protect,
  authorize("organizer", "admin", "org_admin"),
  listCoHostOrganizations
);
// Co-hosting is granted ONLY by the invited organization accepting an
// invitation (see routes below + coHostInvitationController). The old
// POST /:id/co-hosts wrote the link directly, which let one organization
// hand another org's admins its full attendee roster with no consent from
// — or notice to — the organization receiving that access.
router.post(
  "/:id/co-host-invitations",
  protect,
  authorize("organizer", "admin", "org_admin"),
  [
    body("organizationId").isMongoId().withMessage("Valid organizationId is required"),
    body("message").optional().isLength({ max: 1000 }).withMessage("Message is too long"),
  ],
  validate,
  createInvitation
);
router.get(
  "/:id/co-host-invitations",
  protect,
  authorize("organizer", "admin", "org_admin"),
  listEventInvitations
);
router.delete(
  "/:id/co-host-invitations/:invitationId",
  protect,
  authorize("organizer", "admin", "org_admin"),
  cancelInvitation
);
router.delete(
  "/:id/co-hosts/:orgId",
  protect,
  authorize("organizer", "admin", "org_admin"),
  removeCoHostOrganization
);

router.post(
  "/:id/register",
  protect,
  requireRole("attendee"),
  registerLimiter,
  registerForEvent
);

router.get("/:id/networking", protect, requireRole("attendee"), getEventNetworking);

router.get("/:id/feedback/me", protect, requireRole("attendee"), getMyFeedback);

router.post(
  "/:id/feedback",
  protect,
  requireRole("attendee"),
  requirePermission("feedback:submit"),
  feedbackLimiter,
  [
    body("rating").isInt({ min: 1, max: 5 }).withMessage("Rating must be between 1 and 5"),
    body("comment").optional().isLength({ max: 1000 }).withMessage("Comment is too long"),
  ],
  validate,
  submitFeedback
);

router.get("/:id/feedback", protect, requireRole("organizer", "admin", "org_admin"), getEventFeedback);

module.exports = router;
