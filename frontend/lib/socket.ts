// Client-side Socket.IO singleton for real-time notifications.
//
// The backend exposes the live channel on the same origin as the REST API
// (see backend/src/utils/socket.js), so the URL is derived from
// NEXT_PUBLIC_API_URL by stripping the trailing "/api".
//
// Lifecycle is managed by the caller (RealtimeNotifications provider):
//   ensureSocket()  — connects with the current JWT (no-op if connected)
//   disconnectSocket() — tears the channel down (logout)
//
// The socket authenticates during the handshake via auth.token; when the
// access token is rotated or the session is invalidated server-side, the
// server closes the socket and it reconnects with the fresh token on the
// next connect attempt.

import { io, type Socket } from "socket.io-client";

let socket: Socket | null = null;
let socketToken: string | null = null;

const socketUrl = () => {
  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";
  return apiBase.replace(/\/api\/?$/, "");
};

const socketPath = () => {
  const apiBase = process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api";
  return apiBase.includes("/api") ? "/api/socket.io" : "/socket.io";
};

export const getSocket = (token?: string | null): Socket | null => {
  if (typeof window === "undefined") return null;
  const jwtToken = token ?? (typeof window !== "undefined" ? localStorage.getItem("token") : null);
  if (!jwtToken) return null;

  if (socket && socketToken === jwtToken && socket.connected) return socket;
  // Token changed — tear down and reconnect with the new identity.
  if (socket) {
    socket.removeAllListeners();
    socket.disconnect();
    socket = null;
  }

  socket = io(socketUrl(), {
    auth: { token: jwtToken },
    path: socketPath(),
    transports: ["websocket", "polling"],
    reconnectionAttempts: 10,
    timeout: 10_000,
  });
  socketToken = jwtToken;
  return socket;
};

export const disconnectSocket = () => {
  if (!socket) return;
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
  socketToken = null;
};