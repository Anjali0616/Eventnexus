import mongoose, { Schema, Document, Types } from "mongoose";

// A refresh-token session. The token itself is never stored — only a SHA-256
// hash — so a DB leak doesn't yield usable credentials. Rotation (every
// POST /auth/refresh mints a new pair and replaces the stored hash) plus
// reuse detection: presenting a token whose hash is no longer the stored one
// marks it as theft and revokes every session for that user.
//
// NOTE: this is the auth "session" (refresh-token), NOT an event schedule
// session. Event schedule items (talks/slots within an event) live in
// models/EventSession.js. The two were previously collapsed onto the same
// model name "Session", which made `Session.create({ user, refreshTokenHash })`
// in the login flow fail validation against the event-schedule schema
// (event/organization/title/startTime/endTime required) — login was broken.
export interface ISession extends Document {
  user: Types.ObjectId;
  refreshTokenHash: string;
  // Hash of the token this session had BEFORE its last rotation. Lets
  // reuse detection tell "a replayed, already-rotated token" (theft — the
  // previous token was presented again) apart from "garbage hash" (401
  // without escalation). Not unique: only the current hash must be.
  previousTokenHash?: string;
  ip?: string;
  userAgent?: string;
  // Coarse "same browser on the same device" key (normalized user-agent +
  // IP). Used to enforce one active session per account per device: a fresh
  // login from the same browser revokes the previous session (see
  // createSession in authController), so switching accounts can't leave
  // zombie sessions alive in the same browser. Different devices (different
  // user-agent) are never matched.
  deviceFingerprint?: string;
  expiresAt: Date;
  revokedAt?: Date;
  lastUsedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

const sessionSchema = new Schema<ISession>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    refreshTokenHash: {
      type: String,
      required: true,
      unique: true,
      select: false,
    },
    // Hash of the token this session had BEFORE its last rotation. Lets
    // reuse detection tell "a replayed, already-rotated token" (theft — the
    // previous token was presented again) apart from "garbage hash" (401
    // without escalation). Not unique: only the current hash must be.
    previousTokenHash: { type: String, select: false },
    ip: String,
    userAgent: String,
    // Coarse "same browser on the same device" key (normalized user-agent +
    // IP). Used to enforce one active session per account per device: a fresh
    // login from the same browser revokes the previous session (see
    // createSession in authController), so switching accounts can't leave
    // zombie sessions alive in the same browser. Different devices (different
    // user-agent) are never matched.
    deviceFingerprint: { type: String, index: true },
    expiresAt: {
      type: Date,
      required: true,
    },
    revokedAt: Date,
    lastUsedAt: Date,
  },
  { timestamps: true }
);

// TTL index: expired sessions are cleaned up by MongoDB automatically.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

const Session = mongoose.model<ISession>("Session", sessionSchema);
export default Session;

// CommonJS interop for require() compatibility
// @ts-ignore
module.exports = Session;
// @ts-ignore
module.exports.default = Session;
