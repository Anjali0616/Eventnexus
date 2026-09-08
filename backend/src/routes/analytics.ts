import express from "express";
import {
  getOrganizerAnalytics,
  getAdminAnalytics,
  getAudienceSegments,
  getMarketingInsight,
} from "../controllers/analyticsController";
import { protect, requireRole } from "../middleware/auth";

const router = express.Router();

router.get("/organizer", protect, requireRole("organizer", "admin", "org_admin"), getOrganizerAnalytics);
router.get("/admin", protect, requireRole("admin", "org_admin"), getAdminAnalytics);
router.get("/segments", protect, requireRole("organizer", "admin", "org_admin"), getAudienceSegments);
router.get("/marketing-insight", protect, requireRole("organizer", "admin", "org_admin"), getMarketingInsight);

export default router;
// @ts-ignore
module.exports = router;
