import express from "express";
import { body, param } from "express-validator";
import {
  listPendingOrgs,
  approveOrg,
  rejectOrg,
  updateOrganization,
} from "../controllers/systemAdminController";
import { protect, requireSystemAdmin } from "../middleware/auth";
import validate from "../middleware/validate";

const router = express.Router();

// System-admin org approval console — the overall admin (no organization)
// verifies pending organization registrations (PDF: admin controls all
// tenant companies).
router.use(protect, requireSystemAdmin);

router.get("/orgs", listPendingOrgs);
router.post(
  "/orgs/:id/approve",
  [param("id").isMongoId().withMessage("Invalid organization id")],
  validate,
  approveOrg
);
router.post(
  "/orgs/:id/reject",
  [
    param("id").isMongoId().withMessage("Invalid organization id"),
    body("reason").notEmpty().withMessage("Rejection reason is required"),
  ],
  validate,
  rejectOrg
);

// Rename / suspend / reactivate a provisioned tenant (system admin only).
router.patch(
  "/orgs/:id",
  [param("id").isMongoId().withMessage("Invalid organization id")],
  validate,
  updateOrganization
);

export default router;
// @ts-ignore
module.exports = router;
