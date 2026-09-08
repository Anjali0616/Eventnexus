import express from "express";
import { body, param } from "express-validator";
import {
  listOrganizations,
  getMyOrganization,
  updateMyOrganization,
  listMembers,
  addMember,
  updateMemberRole,
  removeMember,
} from "../controllers/organizationController";
import { protect, requireRole, requireOrgAdmin } from "../middleware/auth";
import validate from "../middleware/validate";

const router = express.Router();

router.get("/", listOrganizations);
router.get("/me", protect, requireRole("admin", "org_admin"), getMyOrganization);
router.put("/me", protect, requireRole("admin", "org_admin"), updateMyOrganization);

// --- Membership (org-level roles) — tenant admins only --------------------
router.get(
  "/members",
  protect,
  requireRole("admin", "org_admin", "organizer"),
  requireOrgAdmin,
  listMembers
);

router.post(
  "/members",
  protect,
  requireRole("admin", "org_admin", "organizer"),
  requireOrgAdmin,
  [
    body("email").isEmail().withMessage("Valid email is required"),
    body("roleInOrg")
      .optional()
      .isIn(["owner", "admin", "manager", "member"])
      .withMessage("Invalid organization role"),
  ],
  validate,
  addMember
);

router.patch(
  "/members/:userId",
  protect,
  requireRole("admin", "org_admin"),
  requireOrgAdmin,
  [
    param("userId").isMongoId().withMessage("Invalid user id"),
    body("roleInOrg")
      .isIn(["owner", "admin", "manager", "member"])
      .withMessage("Invalid organization role"),
  ],
  validate,
  updateMemberRole
);

router.delete(
  "/members/:userId",
  protect,
  requireRole("admin", "org_admin", "organizer"),
  requireOrgAdmin,
  [param("userId").isMongoId().withMessage("Invalid user id")],
  validate,
  removeMember
);

export default router;
// @ts-ignore
module.exports = router;
