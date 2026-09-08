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

const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const User = require("../models/User");

let io = null;

const initSocket = (server) => {
  if (io) return io;

  const allowedSocketOrigins = (process.env.FRONTEND_URL || "http://localhost:3000")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  io = new Server(server, {
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
  io.use(async (socket, next) => {
    const token = socket.handshake.auth?.token;
    if (!token) return next(new Error("No token provided"));

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await User.findById(decoded.id);
      if (!user) return next(new Error("User not found"));
      if (user.active === false) return next(new Error("Account disabled"));
      if ((decoded.ver ?? 0) !== (user.tokenVersion ?? 0)) {
        return next(new Error("Session invalidated, please log in again"));
      }
      // Enforce org approval gate for socket as well — disabled/suspended org
      // users with still-valid JWT (7d) must not keep a live socket.
      if (user.organization) {
        const Organization = require("../models/Organization");
        const org = await Organization.findById(user.organization).lean();
        if (org && ["pending", "suspended", "rejected"].includes(org.status)) {
          return next(new Error("Organization not approved"));
        }
      }
      socket.userId = user._id.toString();
      next();
    } catch (error) {
      return next(new Error("Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    if (socket.userId) {
      socket.join(`user:${socket.userId}`);
    }
    socket.on("disconnect", () => {});
  });

  io.on("connect_error", (error) => {
    // Rejected handshakes (bad/expired token) show up here on clients that
    // keep trying — harmless, but noisy; log quietly.
    console.error("[socket] connection error:", error.message);
  });

  console.log("[socket] real-time channel ready");
  return io;
};

const getIo = () => io;

const roomFor = (userId) => `user:${userId}`;

// Push to a single user's socket(s). No-op when the channel isn't up (e.g.
// server still booting) — REST is the source of truth, so a missed push just
// means the client picks the notification up on its next refetch.
const emitToUser = (userId, event, payload) => {
  if (!io || !userId) return false;
  io.to(roomFor(userId.toString())).emit(event, payload);
  return true;
};

// Fan-out to many users at once (geospatial "nearby event" bursts).
const emitToUsers = (userIds, event, payload) => {
  if (!io || !userIds?.length) return false;
  const rooms = [...new Set(userIds.map((id) => `user:${id.toString()}`))];
  io.to(rooms).emit(event, payload);
  return true;
};

module.exports = { initSocket, getIo, emitToUser, emitToUsers };