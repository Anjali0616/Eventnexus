import express from "express";
import { getRecommendations } from "../controllers/recommendationController";
import { protect, requireRole } from "../middleware/auth";

const router = express.Router();

router.get("/", protect, requireRole("attendee"), getRecommendations);

export default router;
// @ts-ignore
module.exports = router;
