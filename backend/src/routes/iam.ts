import express from "express";
import { body, param } from "express-validator";
import {
  listRoles,
  listPermissions,
  updateRolePermissions,
} from "../controllers/iamController";
import { protect, requireRole } from "../middleware/auth";
import validate from "../middleware/validate";

const router = express.Router();

router.use(protect, requireRole("admin", "org_admin"));

// Role & permission management (report §4, §18) — administrators only.
router.get("/roles", listRoles);
router.get("/permissions", listPermissions);
router.put(
  "/roles/:id/permissions",
  [
    param("id").isMongoId().withMessage("Invalid role id"),
    body("permissions").isArray().withMessage("permissions must be an array"),
  ],
  validate,
  updateRolePermissions
);

export default router;
// @ts-ignore
module.exports = router;
