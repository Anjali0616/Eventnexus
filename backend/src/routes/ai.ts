// System-admin-only AI console API. Proxies the Python AI service
// (ai-service/) behind the app's auth so the platform admin can inspect,
// retrain and curate the models from the dashboard UI.
import express, { Request, Response } from "express";
import { protect, requireSystemAdmin } from "../middleware/auth";
import * as ai from "../utils/aiClient";

const router = express.Router();

// System-admin only, not just any "admin" — /train retrains platform-wide
// models from every tenant's data in one shot, and /chatlog exposes labeled
// chatbot conversation samples pooled across every organization. Neither is
// scoped by organization (nor could reasonably be, since the models are
// shared), so a tenant admin (role "admin" WITH an organization) must not
// reach this: they'd retrain the shared model and read/edit/delete other
// tenants' chat samples. Only requireSystemAdmin (admin, no organization)
// may use this console — same guard as the org-approval console.
router.use(protect, requireSystemAdmin);

// Combined service health + model metadata + training-data stats.
router.get("/status", async (req: Request, res: Response) => {
  const [health, stats] = await Promise.all([(ai as any).health(), (ai as any).getStats()]);
  res.json({
    health: health ?? { online: false, attendance: false, cf: false, intent: false },
    stats: stats ?? null,
  });
});

// Retrain all models from current DB data.
router.post("/train", async (req: Request, res: Response) => {
  const results = await (ai as any).retrain();
  if (!results) return res.status(502).json({ message: "AI service unreachable" });
  res.json(results);
});

// Labeled training samples (message -> intent), newest first.
router.get("/chatlog", async (req: Request, res: Response) => {
  const { limit, offset, intent, search } = req.query as any;
  const data = await (ai as any).listChatlog({
    limit: parseInt(limit as string, 10) || 50,
    offset: parseInt(offset as string, 10) || 0,
    intent,
    search,
  });
  if (!data) return res.status(502).json({ message: "AI service unreachable" });
  res.json(data);
});

// Fix a mislabeled sample's intent.
router.patch("/chatlog/:id", async (req: Request, res: Response) => {
  const { id } = req.params as any;
  const { intent } = (req.body as any) || {};
  if (!intent || typeof intent !== "string") {
    return res.status(400).json({ message: "intent is required" });
  }
  const result = await (ai as any).patchChatlog(id, intent);
  if (!result) return res.status(502).json({ message: "AI service unreachable" });
  if (!result.ok) return res.status(400).json({ message: "could not update sample" });
  res.json(result);
});

// Remove a noisy/duplicate training sample.
router.delete("/chatlog/:id", async (req: Request, res: Response) => {
  const result = await (ai as any).deleteChatlog((req.params as any).id);
  if (!result) return res.status(502).json({ message: "AI service unreachable" });
  if (!result.ok) return res.status(400).json({ message: "could not delete sample" });
  res.json(result);
});

// Playground: classify a message with the trained ML model.
router.post("/classify", async (req: Request, res: Response) => {
  const { message } = (req.body as any) || {};
  if (!message || typeof message !== "string") {
    return res.status(400).json({ message: "message is required" });
  }
  const result = await (ai as any).classifyIntent(message, 3000);
  res.json(result ?? { intent: null, score: null });
});

export default router;
// @ts-ignore
module.exports = router;
