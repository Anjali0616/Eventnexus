import crypto from "crypto";

// Opaque 384-bit token shown to the client exactly once. The stored value is
// always the SHA-256 digest (see hashToken), never the token itself.
export const generateRefreshToken = (): string => crypto.randomBytes(48).toString("base64url");

export const generateEmailToken = (): string => crypto.randomBytes(32).toString("hex");

export const hashToken = (token: string): string => crypto.createHash("sha256").update(token).digest("hex");

// "30d", "2h", "90s" → milliseconds. Falls back to the provided default.
export const parseDuration = (value: string | number | undefined | null, fallbackMs: number): number => {
  const str = String(value || "").trim();
  const m = /^(\d+)\s*(ms|s|m|h|d|w)$/i.exec(str);
  if (!m) return fallbackMs;
  const n = parseInt(m[1], 10);
  const factor: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 };
  const unit = m[2].toLowerCase();
  return n * factor[unit];
};

export default { generateRefreshToken, generateEmailToken, hashToken, parseDuration };
