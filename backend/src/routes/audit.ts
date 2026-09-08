import express from "express";
import { listAuditLogs } from "../controllers/auditController";
import { protect, requireRole } from "../middleware/auth";

const router = express.Router();

// Security/audit trail — administrators only (report §24).
router.get("/", protect, requireRole("admin", "org_admin"), listAuditLogs);

export default router;
// @ts-ignore
module.exports = router;
