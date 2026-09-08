// EventNexus — QR + sharing utilities
// ---------------------------------------------------------------------------
// Frontend counterpart to backend/src/utils/qrCode.js. Focuses on the
// *public-event* QR (not the per-ticket JWT QR). That QR encodes the event's
// public page URL with tracking so posters, slides, and forwarded links are
// attributable and so `/event/[id]` can show a "you scanned a QR" banner.
//
// Canonical QR payload shape:
//   https://<origin>/event/<24-hex-id>?qr=1&utm_source=qr&utm_medium=poster&utm_campaign=<optional>
//
// `?qr=1` is the hint the event page checks (useSearchParams().get("qr")==="1")
// to render its special banner. The utm params are for analytics, not for
// routing — stripping them still lands on the same event.
//
// This module has no runtime dependencies beyond the DOM. It is safe to
// import in both client components and (with baseUrl) on the server.
// ---------------------------------------------------------------------------

import type { EventData } from "./api/events";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Minimal event shape any of these helpers accept — subset of EventData. */
export type QrEventLike = Pick<EventData, "_id" | "title" | "date" | "venue" | "category" | "type"> &
  Partial<Pick<EventData, "description" | "imageUrl" | "price" | "organization" | "tags">> & {
    // Allow `id` alias and plain-string price from older callers
    id?: string;
    price?: EventData["price"] | null;
  };

export interface BuildPublicUrlOptions {
  /** Override origin, e.g. https://eventnexus.app . Defaults to window.location.origin. */
  baseUrl?: string;
  /** Include ?qr=1 hint (default true) — keep true for poster QRs. */
  qrHint?: boolean;
  /** Include utm_source/medium (default true). Set false for a clean link. */
  withTracking?: boolean;
  utmSource?: string; // default "qr"
  utmMedium?: string; // default "poster"
  utmCampaign?: string;
  /** Extra query entries to merge (e.g. { ref: "organizer123" }) */
  extraParams?: Record<string, string | number | boolean | undefined | null>;
}

export interface ShareTextOptions {
  includeDate?: boolean; // default true
  includeVenue?: boolean; // default true
  includePrice?: boolean; // default false
  maxDescriptionChars?: number; // default 120, 0 to omit
  hashtag?: string | string[]; // appended, e.g. "#EventNexus"
}

export interface MailtoOptions {
  to?: string;
  subject: string;
  body: string;
}

export interface IcsOptions {
  /** Duration in minutes when the event has no explicit end (default 120). */
  durationMinutes?: number;
  /** Organizer display name/email for ORGANIZER; */
  organizerName?: string;
  organizerEmail?: string;
  /** Calendar/prod id */
  prodId?: string;
}


// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const QR_HINT_KEY = "qr" as const;
export const QR_HINT_VALUE = "1" as const;

export const UTM_DEFAULTS = Object.freeze({
  source: "qr",
  medium: "qr",
});


// ---------------------------------------------------------------------------
// Origin / URL helpers
// ---------------------------------------------------------------------------

/** Resolve the origin to use for absolute URLs. */
export function getDefaultOrigin(): string {
  if (typeof window !== "undefined" && window.location?.origin) return window.location.origin;
  // Next public env is baked at build time
  const envOrigin =
    (typeof process !== "undefined" && (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL)) || "";
  if (envOrigin) return String(envOrigin).replace(/\/$/, "");
  return "";
}

/**
 * Build the public event URL that the poster QR encodes.
 * Default includes `?qr=1&utm_source=qr&utm_medium=poster` so scans land
 * on `/event/[id]` with the banner hint and tracking.
 *
 * @example
 * buildPublicUrl("64a...") // "https://app.example/event/64a...?qr=1&utm_source=qr&utm_medium=poster"
 * buildPublicUrl("64a...", { withTracking: false }) // ".../event/64a...?qr=1"
 */
export function buildPublicUrl(eventId: string, opts: BuildPublicUrlOptions = {}): string {
  const id = String(eventId || "").trim();
  if (!id) throw new Error("eventId is required");

  const rawBase = opts.baseUrl ?? getDefaultOrigin();
  // FRONTEND_URL-style comma list: take first
  const base = String(rawBase || "").split(",")[0].trim().replace(/\/$/, "");
  const qrHint = opts.qrHint !== false;
  const withTracking = opts.withTracking !== false;
  const utmSource = opts.utmSource || UTM_DEFAULTS.source;
  const utmMedium = opts.utmMedium || UTM_DEFAULTS.medium;
  const utmCampaign = opts.utmCampaign || "";

  const params = new URLSearchParams();
  if (qrHint) params.set(QR_HINT_KEY, QR_HINT_VALUE);
  if (withTracking) {
    params.set("utm_source", utmSource);
    params.set("utm_medium", utmMedium);
    if (utmCampaign) params.set("utm_campaign", utmCampaign);
  }
  if (opts.extraParams) {
    for (const [k, v] of Object.entries(opts.extraParams)) {
      if (v == null || String(v).trim() === "") continue;
      params.set(String(k), String(v));
    }
  }
  const qs = params.toString();
  const path = `/event/${id}${qs ? `?${qs}` : ""}`;

  if (base && /^https?:\/\//i.test(base)) return `${base}${path}`;
  // relative fallback (SSR without origin) — still includes hint+tracking
  return path;
}

/** Alias that makes tracking intent explicit at the call site. */
export const buildTrackedPublicUrl = buildPublicUrl;

/** True when the current location was reached via a QR scan (`?qr=1`). */
export function isQrVisit(search: string | URLSearchParams): boolean {
  const sp = typeof search === "string" ? new URLSearchParams(search.startsWith("?") ? search : `?${search}`) : search;
  return sp.get(QR_HINT_KEY) === QR_HINT_VALUE;
}

/** Convenience for `useSearchParams()` in client components. */
export function hasQrHint(searchParams: URLSearchParams | null | undefined): boolean {
  if (!searchParams) return false;
  return searchParams.get(QR_HINT_KEY) === QR_HINT_VALUE;
}

/** Parse tracking params from a QR landing URL. */
export function parseQrTracking(search: string | URLSearchParams): {
  isQrVisit: boolean;
  utmSource?: string;
  utmMedium?: string;
  utmCampaign?: string;
} {
  const sp = typeof search === "string" ? new URLSearchParams(search) : search;
  return {
    isQrVisit: sp.get(QR_HINT_KEY) === QR_HINT_VALUE,
    utmSource: sp.get("utm_source") || undefined,
    utmMedium: sp.get("utm_medium") || undefined,
    utmCampaign: sp.get("utm_campaign") || undefined,
  };
}

// ---------------------------------------------------------------------------
// Share text / social helpers
// ---------------------------------------------------------------------------

function formatEventDateShort(dateInput: string | Date): string {
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  } catch {
    return "";
  }
}

function formatEventTimeShort(dateInput: string | Date): string {
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  } catch {
    return "";
  }
}

function truncateWords(str: string, maxChars: number): string {
  const s = String(str || "").trim().replace(/\s+/g, " ");
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars - 1).trimEnd() + "…";
}

/**
 * Build the human-readable share text for an event.
 * Example: "🎟️ Tech Summit 2026 — Sep 10, 2026 at Kathmandu • Join me: https://.../event/..."
 */
export function buildShareText(event: QrEventLike, publicUrl: string, opts: ShareTextOptions = {}): string {
  const includeDate = opts.includeDate !== false;
  const includeVenue = opts.includeVenue !== false;
  const includePrice = Boolean(opts.includePrice);
  const maxDesc = opts.maxDescriptionChars ?? 120;
  const hashtags = opts.hashtag ? (Array.isArray(opts.hashtag) ? opts.hashtag : [opts.hashtag]) : [];

  const title = String(event.title || "Untitled Event").trim();
  const dateLabel = includeDate ? formatEventDateShort(event.date) : "";
  const timeLabel = includeDate ? formatEventTimeShort(event.date) : "";
  const venue = includeVenue ? String(event.venue || "").trim() : "";

  // price snippet
  let priceSnippet = "";
  if (includePrice) {
    const price = (event as { price?: { amount?: number; currency?: string } | null }).price;
    const amount = Number(price?.amount ?? 0);
    const cur = String(price?.currency || "NPR").toUpperCase();
    priceSnippet = !amount ? "Free" : cur === "NPR" ? `Rs. ${amount.toLocaleString("en-US")}` : `${cur} ${amount}`;
  }

  const bits: string[] = [`🎟️ ${title}`];
  if (dateLabel) bits[0] += ` — ${dateLabel}${timeLabel ? `, ${timeLabel}` : ""}`;
  if (venue) bits.push(`📍 ${venue}`);
  if (priceSnippet) bits.push(`💰 ${priceSnippet}`);
  if (maxDesc > 0 && event.description) {
    const desc = truncateWords(event.description, maxDesc);
    if (desc) bits.push(desc);
  }

  let text = bits.join("\n");
  text += `\n\nJoin me: ${publicUrl}`;
  if (hashtags.length) text += `\n${hashtags.join(" ")}`;
  return text;
}

/** Build a WhatsApp share URL that opens wa.me with prefilled text. */
export function buildWhatsAppUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** Convenience: share an event via WhatsApp (builds text + URL). */
export function buildWhatsAppShareUrl(event: QrEventLike, publicUrl: string, opts?: ShareTextOptions): string {
  const text = buildShareText(event, publicUrl, opts);
  return buildWhatsAppUrl(text);
}

/** Build a Telegram share URL. */
export function buildTelegramShareUrl(publicUrl: string, text: string): string {
  return `https://t.me/share/url?url=${encodeURIComponent(publicUrl)}&text=${encodeURIComponent(text)}`;
}

/** Build an X/Twitter intent URL. */
export function buildXShareUrl(text: string, publicUrl: string): string {
  const payload = `${text} ${publicUrl}`;
  return `https://twitter.com/intent/tweet?text=${encodeURIComponent(payload)}`;
}

export function buildMailtoUrl(opts: MailtoOptions): string {
  const to = opts.to ? encodeURIComponent(opts.to) : "";
  const subject = encodeURIComponent(opts.subject);
  const body = encodeURIComponent(opts.body);
  return `mailto:${to}?subject=${subject}&body=${body}`;
}

export function buildMailtoShare(
  event: QrEventLike,
  publicUrl: string,
  opts: { to?: string; shareTextOptions?: ShareTextOptions } = {}
): string {
  const subject = `Join me at ${event.title}`;
  const body = buildShareText(event, publicUrl, opts.shareTextOptions);
  return buildMailtoUrl({ to: opts.to, subject, body });
}

// ---------------------------------------------------------------------------
// Calendar (.ics) generation — RFC 5545
// ---------------------------------------------------------------------------

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Format a Date as UTC `YYYYMMDDTHHMMSSZ` for ICS. */
export function formatIcsDateUTC(date: Date): string {
  return (
    `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}` +
    `T${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}Z`
  );
}

function escapeIcsText(str: string): string {
  return String(str ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,");
}

function foldIcsLine(line: string): string {
  // RFC 5545 §3.1: lines SHOULD be folded at 75 octets (CRLF + space).
  // Simple char-based fold is sufficient for ASCII event titles/descriptions.
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  while (rest.length > 75) {
    parts.push(rest.slice(0, 75));
    rest = " " + rest.slice(75);
  }
  if (rest) parts.push(rest);
  return parts.join("\r\n");
}

/**
 * Build an .ics file content string for an event.
 * Duration defaults to 2 hours when no end is known (single-day events).
 */
export function buildIcsContent(event: QrEventLike, opts: IcsOptions = {}): string {
  const durationMinutes = Number.isFinite(opts.durationMinutes) ? (opts.durationMinutes as number) : 120;
  const prodId = opts.prodId || "-//EventNexus//Event//EN";
  const start = new Date(event.date);
  if (isNaN(start.getTime())) throw new Error("Invalid event date for ICS");

  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  const now = new Date();
  const uidBase = String((event as { _id?: string; id?: string })._id || (event as { id?: string }).id || `${Date.now()}`);
  const uid = `${uidBase}@eventnexus.app`;
  const dtstamp = formatIcsDateUTC(now);
  const dtstart = formatIcsDateUTC(start);
  const dtend = formatIcsDateUTC(end);

  const summary = escapeIcsText(event.title || "Event");
  const descriptionRaw = [
    event.description ? String(event.description).trim() : "",
    `Category: ${event.category || "Event"}`,
    `Type: ${event.type || "In-person"}`,
    `Venue: ${event.venue || ""}`,
    buildPublicUrl(uidBase, { baseUrl: getDefaultOrigin() || "https://eventnexus.app" }),
  ]
    .filter(Boolean)
    .join("\\n\\n");
  const description = escapeIcsText(descriptionRaw);
  const location = escapeIcsText(event.venue || "");
  const organizerLine = opts.organizerEmail
    ? `ORGANIZER;CN=${escapeIcsText(opts.organizerName || "Organizer")}:mailto:${escapeIcsText(opts.organizerEmail)}`
    : "";

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${prodId}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    `SUMMARY:${summary}`,
    `DESCRIPTION:${description}`,
    location ? `LOCATION:${location}` : "",
    organizerLine,
    "STATUS:CONFIRMED",
    "SEQUENCE:0",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean);

  return lines.map(foldIcsLine).join("\r\n") + "\r\n";
}

/** Wrap ICS content as a `data:text/calendar` URI suitable for <a download>. */
export function buildIcsDataUri(event: QrEventLike, opts?: IcsOptions): string {
  const ics = buildIcsContent(event, opts);
  // Use base64 so newlines/unicode survive attribute encoding
  const b64 = typeof window !== "undefined" ? window.btoa(unescape(encodeURIComponent(ics))) : Buffer.from(ics, "utf8").toString("base64");
  return `data:text/calendar;charset=utf-8;base64,${b64}`;
}

/** Build a Google Calendar "Add to calendar" link (no file download needed). */
export function buildGoogleCalendarUrl(event: QrEventLike, opts: IcsOptions = {}): string {
  const durationMinutes = opts.durationMinutes ?? 120;
  const start = new Date(event.date);
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  const fmt = (d: Date) =>
    `${d.getUTCFullYear()}${pad2(d.getUTCMonth() + 1)}${pad2(d.getUTCDate())}T${pad2(d.getUTCHours())}${pad2(
      d.getUTCMinutes()
    )}${pad2(d.getUTCSeconds())}Z`;
  const text = event.title || "Event";
  const details = event.description ? truncateWords(event.description, 400) : "";
  const location = event.venue || "";
  const sp = new URLSearchParams({
    action: "TEMPLATE",
    text,
    dates: `${fmt(start)}/${fmt(end)}`,
    details,
    location,
  });
  return `https://calendar.google.com/calendar/render?${sp.toString()}`;
}

/** Trigger a download of the event's .ics file (browser only). */
export function downloadIcs(event: QrEventLike, filename?: string, opts?: IcsOptions): void {
  if (typeof document === "undefined") return;
  const ics = buildIcsContent(event, opts);
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const safeTitle = String(event.title || "event")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  const name = filename || `${safeTitle || "event"}.ics`;
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 0);
}

// ---------------------------------------------------------------------------
// Small helpers for the QR banner & analytics
// ---------------------------------------------------------------------------

/** True when `search` (from window.location.search) indicates a QR scan. */
export function shouldShowQrBanner(search: string | URLSearchParams | null | undefined): boolean {
  if (!search) return false;
  return isQrVisit(typeof search === "string" ? search : search.toString());
}

/** All share URLs at once — convenient for a share sheet. */
export function buildShareUrls(
  event: QrEventLike,
  opts: BuildPublicUrlOptions & { shareTextOptions?: ShareTextOptions } = {}
): {
  publicUrl: string;
  shareText: string;
  whatsapp: string;
  telegram: string;
  email: string;
  icsDataUri: string;
  googleCalendar: string;
} {
  const id = String((event as { _id?: string; id?: string })._id || (event as { id?: string }).id || "");
  const publicUrl = buildPublicUrl(id, opts);
  const shareText = buildShareText(event, publicUrl, opts.shareTextOptions);
  return {
    publicUrl,
    shareText,
    whatsapp: buildWhatsAppUrl(shareText),
    telegram: buildTelegramShareUrl(publicUrl, shareText),
    email: buildMailtoShare(event, publicUrl, { shareTextOptions: opts.shareTextOptions }),
    icsDataUri: buildIcsDataUri(event),
    googleCalendar: buildGoogleCalendarUrl(event),
  };
}
