// Validates a "come back here after signing in" path for the QR/poster flow
// (scan → public event landing → Join → auth → land back on that event).
//
// Deliberately narrow rather than accepting any `redirect` string: an
// unchecked redirect taken from a URL query param is a classic open-redirect
// vector (`?redirect=https://evil.example` or `?redirect=//evil.example`
// both parse as "valid" strings if all you check is non-emptiness). Only a
// same-origin `/event/<24-hex-id>` path is accepted — the one destination
// this flow ever needs — so the param can't be turned into anything else.
const EVENT_PATH_RE = /^\/event\/[0-9a-f]{24}$/i;
const ALLOWED_QR_PARAMS = new Set(["qr", "utm_source", "utm_medium", "utm_campaign"]);

export function sanitizeEventRedirect(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Block absolute URLs and protocol-relative
  if (/^(https?:)?\/\//i.test(raw) || raw.includes("://")) return null;
  try {
    const u = new URL(raw, "http://dummy");
    // Must be same-origin path, no host tricks
    if (u.host !== "dummy") return null;
    if (!EVENT_PATH_RE.test(u.pathname)) return null;
    // Rebuild with only allowed query params (preserve qr context, drop anything else)
    const allowed = new URLSearchParams();
    for (const [k, v] of u.searchParams.entries()) {
      if (ALLOWED_QR_PARAMS.has(k)) allowed.set(k, v);
    }
    const qs = allowed.toString();
    return qs ? `${u.pathname}?${qs}` : u.pathname;
  } catch {
    return null;
  }
}
