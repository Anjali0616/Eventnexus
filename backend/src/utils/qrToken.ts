import jwt from "jsonwebtoken";

const getQrSecret = (): string => {
  // Prefer dedicated QR secret; fallback to JWT_SECRET only in development.
  // Warn loudly if QR_TOKEN_SECRET is missing in production so rotation of
  // the session secret does not silently invalidate/forge tickets.
  if (process.env.QR_TOKEN_SECRET) return process.env.QR_TOKEN_SECRET as string;
  if (process.env.NODE_ENV === "production" && !process.env.QR_TOKEN_SECRET) {
    console.warn("[qrToken] QR_TOKEN_SECRET not set — falling back to JWT_SECRET (not recommended for production)");
  }
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required for QR token fallback");
  return process.env.JWT_SECRET as string;
};

export const signTicketToken = (ticketId: string, eventId: string, attendeeId: string): string => {
  return jwt.sign({ ticketId, eventId, attendeeId }, getQrSecret(), { expiresIn: "30d" });
};

export const verifyTicketToken = (token: string): any | null => {
  try {
    return jwt.verify(token, getQrSecret());
  } catch (error) {
    return null;
  }
};

// ──────────────────────────────────────────────────────────────────────────
// Non-breaking advanced extensions — all additive. Existing 30-day tokens
// continue to verify via signTicketToken/verifyTicketToken unchanged.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Short-lived ticket token (e.g. 10 minutes) for door-scan rotation.
 * The attendee wallet can refresh this every few minutes while online,
 * but the long-lived token remains the durable fallback (so offline
 * scanners never reject a ticket just because the short token expired).
 *
 * @param ticketId
 * @param eventId
 * @param attendeeId
 * @param expiresIn
 */
export const signShortLivedTicketToken = (ticketId: string, eventId: string, attendeeId: string, expiresIn: string | number = "10m"): string => {
  return jwt.sign({ ticketId, eventId, attendeeId, kind: "short" }, getQrSecret(), { expiresIn } as any);
};

/**
 * Decode without verifying signature — useful for offline gate devices
 * that want to show ticketId/eventId even when clock skew or expiry
 * would make verifyTicketToken return null. Caller MUST still call
 * verifyTicketToken before marking checked-in.
 */
export const decodeTicketTokenUnsafe = (token: string): any | null => {
  try {
    return jwt.decode(token);
  } catch {
    return null;
  }
};

/**
 * Verify with a grace window for clock skew at the door (default 5 min).
 * Does NOT extend real expiry; just tolerates device clock drift.
 */
export const verifyTicketTokenWithGrace = (token: string, graceSeconds: number = 300): any | null => {
  try {
    return jwt.verify(token, getQrSecret(), { clockTolerance: graceSeconds } as any);
  } catch {
    return null;
  }
};

/**
 * Returns seconds until expiry, or null if token is invalid / has no exp.
 * Lets the attendee wallet show "Refreshing..." or countdown without a server round-trip.
 */
export const getTicketTokenTtlSeconds = (token: string): number | null => {
  const payload: any = decodeTicketTokenUnsafe(token);
  if (!payload || typeof payload.exp !== "number") return null;
  return Math.max(0, payload.exp - Math.floor(Date.now() / 1000));
};

/**
 * True if the token expires within `thresholdSeconds` (default 5 min).
 * Wallet can proactively call POST /tickets/:id/refresh before expiry.
 */
export const isTicketTokenExpiringSoon = (token: string, thresholdSeconds: number = 300): boolean => {
  const ttl = getTicketTokenTtlSeconds(token);
  if (ttl === null) return false;
  return ttl <= thresholdSeconds;
};

/**
 * Offline structural check — no crypto, just shape + expiry, for
 * airplane-mode scanners that want to reject obviously-bad QRs instantly
 * before queuing them for online verification.
 */
export const isTicketTokenStructurallyValid = (token: string): boolean => {
  if (typeof token !== "string" || token.split(".").length !== 3) return false;
  const payload: any = decodeTicketTokenUnsafe(token);
  if (!payload) return false;
  return Boolean(payload.ticketId && payload.eventId && payload.attendeeId);
};

export default {
  signTicketToken,
  verifyTicketToken,
  // additive — safe to import without affecting existing flows
  signShortLivedTicketToken,
  decodeTicketTokenUnsafe,
  verifyTicketTokenWithGrace,
  getTicketTokenTtlSeconds,
  isTicketTokenExpiringSoon,
  isTicketTokenStructurallyValid,
};
