import express from "express";
import {
  getMyNotifications,
  getNotification,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
} from "../controllers/notificationController";
import { protect } from "../middleware/auth";

const router = express.Router();

// Static routes first so "/unread-count" is never captured by "/:id".
router.get("/unread-count", protect, getUnreadCount);
router.get("/", protect, getMyNotifications);
router.get("/:id", protect, getNotification);
router.put("/read-all", protect, markAllAsRead);
router.put("/:id/read", protect, markAsRead);

export default router;
// @ts-ignore
module.exports = router;
