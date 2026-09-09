import dotenv from "dotenv";
dotenv.config();
import http from "http";
import express, { Request, Response } from "express";
import cors from "cors";
import helmet from "helmet";
import connectDB from "./config/db";
import { initSocket } from "./utils/socket";
import authRoutes from "./routes/auth";
import eventRoutes from "./routes/events";
import organizationRoutes from "./routes/organizations";
import ticketRoutes from "./routes/tickets";
import userRoutes from "./routes/users";
import sessionRoutes from "./routes/sessions";
import speakerRoutes from "./routes/speakers";
import notificationRoutes from "./routes/notifications";
import recommendationRoutes from "./routes/recommendations";
import analyticsRoutes from "./routes/analytics";
import chatbotRoutes from "./routes/chatbot";
import paymentRoutes from "./routes/payments";
import aiRoutes from "./routes/ai";
import auditRoutes from "./routes/audit";
import iamRoutes from "./routes/iam";
import collaborationRoutes from "./routes/collaboration";
import systemRoutes from "./routes/system";
import { handleWebhook } from "./controllers/paymentController";
import { health as aiHealth } from "./utils/aiClient";
import { notFound, errorHandler } from "./middleware/errors";
import { sanitizeRequest } from "./middleware/sanitize";
import { startScheduler } from "./utils/reminderScheduler";
import { checkRoleIntegrity } from "./utils/roleIntegrity";

const app = express();
app.set("trust proxy", 1);

connectDB().then(() => {
  // Start the in-process reminder scheduler once the DB is ready.
  startScheduler();
  // Warn loudly if any account still carries the pre-split admin shape —
  // the role checks in code are exact, so stale rows fail silently as
  // "not authorized" rather than as an obvious misconfiguration.
  checkRoleIntegrity();
});

// Secure HTTP headers (report §18): HSTS, X-Content-Type-Options, frame
// protections, and friends. CSP is relaxed for the admin panel / image
// data URLs (cover images are inline base64) — tightened via a proper CDN
// when object storage is added.
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);
app.disable("x-powered-by");

const allowedOrigins: string[] = (process.env.FRONTEND_URL || "http://localhost:3000")
  .split(",")
  .map((o: string) => o.trim())
  .filter(Boolean);
const extraOrigins: string[] = [
  // Production domain (HTTPS via Caddy) — kept here as a hard fallback so the
  // API stays reachable even if FRONTEND_URL is misconfigured on the host.
  "https://eventnexus.tech",
  "https://www.eventnexus.tech",
  "http://3.106.232.125",
  "http://3.106.232.125:3000",
  "http://3.106.232.125:80",
  "http://3.106.232.125:5000",
  "http://eventnexus-alb-1182569403.ap-southeast-2.elb.amazonaws.com",
  "http://localhost:3000",
  "http://localhost:80",
];
const allAllowed: string[] = [...new Set([...allowedOrigins, ...extraOrigins])];
app.use(
  cors({
    origin: (origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => {
      if (!origin) return cb(null, true);
      if (allAllowed.includes(origin)) return cb(null, true);
      return cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

// Stripe needs the raw, unparsed body to verify the webhook signature, so
// this route is registered with express.raw() *before* the global
// express.json() body parser below.
app.post(
  "/api/payments/webhook",
  express.raw({ type: "application/json" }),
  handleWebhook
);

// Raised from the default 100kb so event cover images (sent as base64 data
// URLs, since no object-storage provider is configured) fit in the body —
// the frontend downsizes images client-side before sending, well under this.
app.use(express.json({ limit: "8mb" }));

// NoSQL-injection guard, applied to every request regardless of whether the
// route happens to run express-validator's `validate` — several list
// endpoints (GET /events/my, GET /users, GET /tickets, ...) take req.query
// straight into buildFilters()/buildAdvancedFilters() with no validators at
// all. Express's query parser turns `?role[$ne]=admin` into an object
// (`{ $ne: "admin" }`), which would otherwise reach those filters unfiltered.
app.use(sanitizeRequest);

app.use("/api/auth", authRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/organizations", organizationRoutes);
app.use("/api/tickets", ticketRoutes);
app.use("/api/users", userRoutes);
app.use("/api/events/:eventId/sessions", sessionRoutes);
app.use("/api/speakers", speakerRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/recommendations", recommendationRoutes);
app.use("/api/analytics", analyticsRoutes);
app.use("/api/chatbot", chatbotRoutes);
app.use("/api/payments", paymentRoutes);

// AI health probe is public (used by status indicators/landing page), so it
// must be registered BEFORE the admin-protected /api/ai router mounts below —
// mounted after, the router's protect middleware swallows it with a 401.
app.get("/api/ai/health", async (req: Request, res: Response) => {
  const health = await aiHealth();
  res.json(health ?? { online: false, attendance: false, cf: false, intent: false });
});

// Admin-only AI training console (proxies the Python AI service).
app.use("/api/ai", aiRoutes);

app.use("/api/audit", auditRoutes);
app.use("/api/iam", iamRoutes);
app.use("/api/collaboration", collaborationRoutes);
app.use("/api/system", systemRoutes);

app.get("/api/health", (req: Request, res: Response) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Standardized 404 + error responses (report §23) — registered last so any
// thrown error anywhere above lands here.
app.use(notFound);
app.use(errorHandler);

const PORT: string | number = process.env.PORT || 5000;

// Express and Socket.IO share one HTTP server — real-time pushes ride the
// same origin/port as the REST API, so the frontend only needs its API base.
const server = http.createServer(app);
initSocket(server);

server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

export default app;
