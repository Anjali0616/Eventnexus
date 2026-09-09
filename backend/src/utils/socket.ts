// Real-time notification channel (Socket.IO).
//
// One server-wide Socket.IO instance, attached to the same HTTP server as the
// Express app (see server.js). Clients authenticate during the handshake with
// the same JWT they send as a Bearer token; on success the socket joins a
// per-user room (`user:<id>`) and receives:
//
//   - "notification:created"  { notification, unread }  a fresh notification
//   - "notification:read"     { id, unread }            one notification read
//   - "notifications:read-all" { unread }               all notifications read
//   - "unread:count"          { count }                 live unread badge count
//
// Everything else in the app goes through emitToUser/emitToUsers below — the
// socket layer never holds business logic, so REST stays the source of truth
// and the push channel is only ever a fast mirror of what was persisted.

import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import User from "../models/User";
import type { Server as HttpServer } from "http";

let io: Server | null = null;

export const initSocket = (server: HttpServer): Server => {
  if (io) return io;

  const allowedSocketOrigins = [
    ...new Set(
      [
        ...(process.env.FRONTEND_URL || "http://localhost:3000").split(","),
        // Hard fallbacks so realtime survives a missing/incomplete FRONTEND_URL.
        "https://eventnexus.tech",
        "https://www.eventnexus.tech",
        "http://localhost:3000",
      ]
        .map((o: string) => o.trim())
        .filter(Boolean),
    ),
  ];
  io = new Server(server as any, {
    path: "/api/socket.io",
    cors: {
      origin: allowedSocketOrigins.length === 1 ? allowedSocketOrigins[0] : allowedSocketOrigins,
      credentials: true,
    },
    // Forced polling → websocket upgrade keeps the connection alive reliably
    // behind proxies; the upgrade still happens automatically when possible.
    transports: ["websocket", "polling"],
  });

  // Handshake auth: the client sends its access token as auth.token. Same
  // rules as the REST `protect` middleware — verify the JWT, load the user,
  // and reject stale token-version sessions (role/password changed).
  io.use(async (socket: any, next: any) => {
    const token: string | undefined = socket.handshake.auth?.token;
    if (!token) return next(new Error("No token provided"));

    try {
      const decoded: any = jwt.verify(token, process.env.JWT_SECRET as string);
      const user: any = await (User as any).findById(decoded.id);
      if (!user) return next(new Error("User not found"));
      if (user.active === false) return next(new Error("Account disabled"));
      if ((decoded.ver ?? 0) !== (user.tokenVersion ?? 0)) {
        return next(new Error("Session invalidated, please log in again"));
      }
      // Enforce org approval gate for socket as well — disabled/suspended org
      // users with still-valid JWT (7d) must not keep a live socket.
      if (user.organization) {
        const Organization: any = require("../models/Organization");
        const org: any = await Organization.findById(user.organization).lean();
        if (org && ["pending", "suspended", "rejected"].includes(org.status)) {
          return next(new Error("Organization not approved"));
        }
      }
      socket.userId = user._id.toString();
      next();
    } catch (error: any) {
      return next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket: any) => {
    if (socket.userId) {
      socket.join(`user:${socket.userId}`);
    }
    socket.on("disconnect", () => {});
  });

  io.on("connect_error", (error: any) => {
    // Rejected handshakes (bad/expired token) show up here on clients that
    // keep trying — harmless, but noisy; log quietly.
    console.error("[socket] connection error:", error.message);
  });

  console.log("[socket] real-time channel ready");
  return io;
};

export const getIo = (): Server | null => io;

const roomFor = (userId: string | any): string => `user:${userId}`;

// Push to a single user's socket(s). No-op when the channel isn't up (e.g.
// server still booting) — REST is the source of truth, so a missed push just
// means the client picks the notification up on its next refetch.
export const emitToUser = (userId: string | any, event: string, payload: any): boolean => {
  if (!io || !userId) return false;
  (io as any).to(roomFor(userId.toString())).emit(event, payload);
  return true;
};

// Fan-out to many users at once (geospatial "nearby event" bursts).
export const emitToUsers = (userIds: any[], event: string, payload: any): boolean => {
  if (!io || !userIds?.length) return false;
  const rooms: string[] = [...new Set(userIds.map((id: any) => `user:${id.toString()}`))];
  (io as any).to(rooms).emit(event, payload);
  return true;
};

export default { initSocket, getIo, emitToUser, emitToUsers };
