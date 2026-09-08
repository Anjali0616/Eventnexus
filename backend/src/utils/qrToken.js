const jwt = require("jsonwebtoken");

const getQrSecret = () => {
  // Prefer dedicated QR secret; fallback to JWT_SECRET only in development.
  // Warn loudly if QR_TOKEN_SECRET is missing in production so rotation of
  // the session secret does not silently invalidate/forge tickets.
  if (process.env.QR_TOKEN_SECRET) return process.env.QR_TOKEN_SECRET;
  if (process.env.NODE_ENV === "production" && !process.env.QR_TOKEN_SECRET) {
    console.warn("[qrToken] QR_TOKEN_SECRET not set — falling back to JWT_SECRET (not recommended for production)");
  }
  if (!process.env.JWT_SECRET) throw new Error("JWT_SECRET is required for QR token fallback");
  return process.env.JWT_SECRET;
};

const signTicketToken = (ticketId, eventId, attendeeId) => {
  return jwt.sign({ ticketId, eventId, attendeeId }, getQrSecret(), { expiresIn: "30d" });
};

const verifyTicketToken = (token) => {
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
 * @param {string} ticketId
 * @param {string} eventId
 * @param {string} attendeeId
 * @param {string|number} [expiresIn='10m']
 */
const signShortLivedTicketToken = (ticketId, eventId, attendeeId, expiresIn = "10m") => {
  return jwt.sign({ ticketId, eventId, attendeeId, kind: "short" }, getQrSecret(), { expiresIn });
};

/**
 * Decode without verifying signature — useful for offline gate devices
 * that want to show ticketId/eventId even when clock skew or expiry
 * would make verifyTicketToken return null. Caller MUST still call
 * verifyTicketToken before marking checked-in.
 */
const decodeTicketTokenUnsafe = (token) => {
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
const verifyTicketTokenWithGrace = (token, graceSeconds = 300) => {
  try {
    return jwt.verify(token, getQrSecret(), { clockTolerance: graceSeconds });
  } catch {
    return null;
  }
};

/**
 * Returns seconds until expiry, or null if token is invalid / has no exp.
 * Lets the attendee wallet show "Refreshing..." or countdown without a server round-trip.
 */
const getTicketTokenTtlSeconds = (token) => {
  const payload = decodeTicketTokenUnsafe(token);
  if (!payload || typeof payload.exp !== "number") return null;
  return Math.max(0, payload.exp - Math.floor(Date.now() / 1000));
};

/**
 * True if the token expires within `thresholdSeconds` (default 5 min).
 * Wallet can proactively call POST /tickets/:id/refresh before expiry.
 */
const isTicketTokenExpiringSoon = (token, thresholdSeconds = 300) => {
  const ttl = getTicketTokenTtlSeconds(token);
  if (ttl === null) return false;
  return ttl <= thresholdSeconds;
};

/**
 * Offline structural check — no crypto, just shape + expiry, for
 * airplane-mode scanners that want to reject obviously-bad QRs instantly
 * before queuing them for online verification.
 */
const isTicketTokenStructurallyValid = (token) => {
  if (typeof token !== "string" || token.split(".").length !== 3) return false;
  const payload = decodeTicketTokenUnsafe(token);
  if (!payload) return false;
  return Boolean(payload.ticketId && payload.eventId && payload.attendeeId);
};

module.exports = {
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
