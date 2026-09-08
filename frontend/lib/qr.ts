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

export interface DrawPosterOptions {
  event: QrEventLike;
  /** QR data URI (data:image/png;base64,...) or an already-loaded image element */
  qrDataUrl: string | HTMLImageElement;
  /** Canvas logical size (css px). Device pixel ratio is applied internally. */
  width?: number; // default 1080
  height?: number; // default 1350
  /** Theme — light is the default poster; dark inverts; brand uses accent bg */
  theme?: "light" | "dark" | "brand";
  bgColor?: string;
  accentColor?: string; // default #5b4cf5
  textColor?: string;
  mutedColor?: string;
  brandName?: string; // default EventNexus
  websiteLabel?: string;
  /** Size of the QR square inside the poster (default 520 at 1080 width) */
  qrSize?: number;
  /** Whether to render the price pill (default true) */
  showPrice?: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const QR_HINT_KEY = "qr" as const;
export const QR_HINT_VALUE = "1" as const;

export const UTM_DEFAULTS = Object.freeze({
  source: "qr",
  medium: "poster",
});

const DEFAULT_ACCENT = "#5b4cf5";

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
// Poster canvas helper (browser)
// ---------------------------------------------------------------------------

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // data: URIs don't need CORS; remote URLs might — anonymous is safest default
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = src;
  });
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number | number[]
): void {
  const radii = Array.isArray(r) ? r : [r, r, r, r];
  const [tl, tr, br, bl] = radii;
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
  ctx.lineTo(x + bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
  ctx.lineTo(x, y + tl);
  ctx.quadraticCurveTo(x, y, x + tl, y);
  ctx.closePath();
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
): number {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  let line = "";
  let curY = y;
  for (let i = 0; i < words.length; i++) {
    const test = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, curY);
      line = words[i];
      curY += lineHeight;
    } else {
      line = test;
    }
  }
  if (line) ctx.fillText(line, x, curY);
  return curY;
}

/** Pick theme colors. */
function themeColors(theme: DrawPosterOptions["theme"], overrides: Partial<DrawPosterOptions>) {
  const accent = overrides.accentColor || DEFAULT_ACCENT;
  if (theme === "dark") {
    return {
      bg: overrides.bgColor || "#0f172a",
      card: "#1e293b",
      text: overrides.textColor || "#f8fafc",
      muted: overrides.mutedColor || "#94a3b8",
      accent,
      pillBg: "rgba(255,255,255,0.12)",
      qrBg: "#ffffff",
    };
  }
  if (theme === "brand") {
    return {
      bg: accent,
      card: "#ffffff",
      text: overrides.textColor || "#0f172a",
      muted: overrides.mutedColor || "#64748b",
      accent,
      pillBg: "rgba(91,76,245,0.12)",
      qrBg: "#ffffff",
    };
  }
  // light (default)
  return {
    bg: overrides.bgColor || "#f8fafc",
    card: "#ffffff",
    text: overrides.textColor || "#0f172a",
    muted: overrides.mutedColor || "#64748b",
    accent,
    pillBg: "#f1f5f9",
    qrBg: "#ffffff",
  };
}

/**
 * Draw a branded poster onto an existing <canvas>.
 * The canvas is resized for devicePixelRatio so the exported PNG is sharp.
 *
 * Usage:
 *   const canvas = document.createElement("canvas");
 *   await drawPoster(canvas, { event, qrDataUrl });
 *   canvas.toDataURL("image/png") // or canvas.toBlob(...)
 *
 * Poster layout (top→bottom):
 *   - accent top bar (brand)
 *   - white card with category/type pills, title, date•venue
 *   - QR code centered on its own white plate
 *   - "Scan with your camera" hint + subtle description
 *   - footer with brand + site
 */
export async function drawPoster(canvas: HTMLCanvasElement, opts: DrawPosterOptions): Promise<void> {
  const { event, qrDataUrl } = opts;
  if (!event || !qrDataUrl) throw new Error("drawPoster: event and qrDataUrl are required");

  const W = Math.max(600, Math.min(2400, Math.round(opts.width ?? 1080)));
  const H = Math.max(800, Math.min(3000, Math.round(opts.height ?? 1350)));
  const dpr = typeof window !== "undefined" ? Math.min(window.devicePixelRatio || 1, 2) : 1;

  // size canvas for retina
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.scale(dpr, dpr);

  const c = themeColors(opts.theme, opts);
  const pad = 48;
  const topBarH = 72;
  const radius = 28;
  const cardX = pad;
  const cardY = topBarH + 28;
  const cardW = W - pad * 2;
  const cardH = H - cardY - pad - 72;
  const qrSize = Math.max(160, Math.min(700, Math.round(opts.qrSize ?? 520)));
  const qrPad = 20;
  const qrOuter = qrSize + qrPad * 2;
  const qrX = Math.round((W - qrOuter) / 2);
  // Vertical rhythm: enough headroom for title + meta, then QR block
  const qrY = cardY + 230;
  const brandName = opts.brandName || "EventNexus";
  const websiteLabel = opts.websiteLabel || "eventnexus.app";

  // ---- background ----
  ctx.fillStyle = c.bg;
  roundRect(ctx, 0, 0, W, H, 32);
  ctx.fill();

  // subtle accent gradient overlay (soft radial)
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, hexToRgba(c.accent, 0.08));
  grad.addColorStop(1, hexToRgba(c.accent, 0));
  ctx.fillStyle = grad;
  roundRect(ctx, 0, 0, W, H, 32);
  ctx.fill();

  // ---- top bar ----
  ctx.fillStyle = c.accent;
  // bar with bottom radius preserved into page curve: draw as full-width rect clipped by page radius
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(W, 0);
  ctx.lineTo(W, topBarH);
  ctx.lineTo(0, topBarH);
  ctx.closePath();
  ctx.fill();
  // carve top corners to match page radius (draw over with bg outside — simpler: just overlay text)
  // Instead just draw the text over the bar; clipping to page radius already applied via first bg rect, but bar extends to top corners naturally.

  ctx.fillStyle = "#ffffff";
  ctx.font = "800 22px Inter, ui-sans-serif, system-ui, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(brandName, pad, topBarH / 2);

  ctx.font = "600 11px Inter, sans-serif";
  ctx.textAlign = "right";
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  // letter-spacing emulation: canvas has no letterSpacing, so we just keep text short and right-aligned
  ctx.fillText("SCAN TO JOIN", W - pad, topBarH / 2 + 1);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  // ---- white card ----
  ctx.fillStyle = c.card;
  ctx.shadowColor = "rgba(15,23,42,0.12)";
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 12;
  roundRect(ctx, cardX, cardY, cardW, cardH, radius);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  // hairline border
  ctx.strokeStyle = "rgba(15,23,42,0.08)";
  ctx.lineWidth = 1;
  roundRect(ctx, cardX, cardY, cardW, cardH, radius);
  ctx.stroke();

  // ---- category + type pills ----
  const category = String(event.category || "Event").toUpperCase();
  const typeLabel = String(event.type || "In-person");
  const price = (event as { price?: { amount?: number; currency?: string } | null }).price;
  const isFree = !price || !price.amount || Number(price.amount) <= 0;
  const cur = String(price?.currency || "NPR").toUpperCase();
  const priceLabel = isFree ? "FREE" : (cur === "NPR" ? `RS. ${Number(price.amount).toLocaleString("en-US")}` : `${cur} ${price.amount}`).toUpperCase();

  // measure helper for pill widths
  const pillH = 28;
  const pillPadX = 14;
  const catW = Math.min(170, Math.max(70, ctx.measureText(category).width + pillPadX * 2 + 8));
  const typeW = Math.min(130, Math.max(60, ctx.measureText(typeLabel).width + pillPadX * 2));

  // Category pill (accent tint)
  const pillY = cardY + 28;
  ctx.fillStyle = hexToRgba(c.accent, 0.12);
  roundRect(ctx, cardX + 28, pillY, catW, pillH, 14);
  ctx.fill();
  ctx.fillStyle = c.accent;
  ctx.font = "700 11px Inter, sans-serif";
  ctx.textBaseline = "middle";
  ctx.fillText(category, cardX + 28 + pillPadX, pillY + pillH / 2 + 1);

  // Type pill
  ctx.fillStyle = c.pillBg;
  roundRect(ctx, cardX + 28 + catW + 10, pillY, typeW, pillH, 14);
  ctx.fill();
  ctx.strokeStyle = "rgba(15,23,42,0.06)";
  ctx.lineWidth = 1;
  roundRect(ctx, cardX + 28 + catW + 10, pillY, typeW, pillH, 14);
  ctx.stroke();
  ctx.fillStyle = c.muted;
  ctx.fillText(typeLabel, cardX + 28 + catW + 10 + 12, pillY + pillH / 2 + 1);

  // Price pill (right aligned)
  ctx.font = "800 11px Inter, sans-serif";
  const priceW = Math.min(150, ctx.measureText(priceLabel).width + pillPadX * 2);
  const priceX = cardX + cardW - 28 - priceW;
  ctx.fillStyle = isFree ? "#10b981" : c.accent;
  roundRect(ctx, priceX, pillY, priceW, pillH, 14);
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  ctx.fillText(priceLabel, priceX + pillPadX, pillY + pillH / 2 + 1);

  // ---- title (centered, wrapped) ----
  const title = String(event.title || "Untitled Event").trim();
  const titleFontSize = title.length > 64 ? 34 : title.length > 38 ? 40 : 46;
  ctx.fillStyle = c.text;
  ctx.font = `900 ${titleFontSize}px Inter, ui-sans-serif, system-ui, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  const titleX = W / 2;
  const titleY = cardY + 110;
  const titleMaxW = cardW - 64;
  const titleLineH = titleFontSize + 10;
  const titleEndY = wrapText(ctx, title, titleX, titleY, titleMaxW, titleLineH);

  // ---- date • venue line ----
  const dateStr = formatEventDateShort(event.date);
  const timeStr = formatEventTimeShort(event.date);
  const venueStr = String(event.venue || "Venue TBA").trim();
  const metaLine = dateStr ? `${dateStr}${timeStr ? `, ${timeStr}` : ""}  •  ${venueStr}` : venueStr;
  ctx.font = "500 15px Inter, sans-serif";
  ctx.fillStyle = c.muted;
  const metaY = titleEndY + 28;
  ctx.fillText(truncateWords(metaLine, 72), titleX, metaY);

  // ---- QR plate ----
  // white rounded plate with soft border
  ctx.fillStyle = c.qrBg;
  ctx.shadowColor = "rgba(15,23,42,0.1)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 8;
  roundRect(ctx, qrX, qrY, qrOuter, qrOuter, 24);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.strokeStyle = "rgba(15,23,42,0.08)";
  ctx.lineWidth = 1;
  roundRect(ctx, qrX, qrY, qrOuter, qrOuter, 24);
  ctx.stroke();

  // draw QR image
  let qrImg: HTMLImageElement | null = null;
  if (qrDataUrl instanceof HTMLImageElement) {
    qrImg = qrDataUrl;
  } else {
    try {
      qrImg = await loadImage(String(qrDataUrl));
    } catch {
      // draw placeholder
      ctx.fillStyle = "#f1f5f9";
      roundRect(ctx, qrX + qrPad, qrY + qrPad, qrSize, qrSize, 12);
      ctx.fill();
      ctx.fillStyle = c.muted;
      ctx.font = "600 12px Inter, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("QR unavailable", W / 2, qrY + qrOuter / 2);
      ctx.textAlign = "left";
    }
  }
  if (qrImg) {
    const prevSmooth = (ctx as unknown as { imageSmoothingEnabled?: boolean }).imageSmoothingEnabled;
    (ctx as unknown as { imageSmoothingEnabled: boolean }).imageSmoothingEnabled = false;
    // Clip to rounded rect for QR so its square doesn't poke corners
    ctx.save();
    roundRect(ctx, qrX + qrPad, qrY + qrPad, qrSize, qrSize, 12);
    ctx.clip();
    ctx.drawImage(qrImg, qrX + qrPad, qrY + qrPad, qrSize, qrSize);
    ctx.restore();
    (ctx as unknown as { imageSmoothingEnabled: boolean }).imageSmoothingEnabled = prevSmooth ?? true;
  }

  // ---- scan hint ----
  ctx.textAlign = "center";
  ctx.fillStyle = c.muted;
  ctx.font = "700 12px Inter, sans-serif";
  // emulate letter-spacing by upper-casing and keeping tracking modest; canvas has no native letterSpacing
  ctx.fillText("SCAN WITH YOUR CAMERA", W / 2, qrY + qrOuter + 34);
  ctx.font = "500 12px Inter, sans-serif";
  ctx.fillText("Opens the public event page — no login required to preview", W / 2, qrY + qrOuter + 56);

  // optional description (two lines max, muted)
  if (event.description) {
    const desc = truncateWords(String(event.description).trim().replace(/\s+/g, " "), 180);
    if (desc) {
      ctx.font = "500 12.5px Inter, sans-serif";
      ctx.fillStyle = c.muted;
      const descY = qrY + qrOuter + 88;
      const descLines = splitForWrap(ctx, desc, cardW - 80);
      const toShow = descLines.slice(0, 3);
      toShow.forEach((line, i) => {
        ctx.fillText(line, W / 2, descY + i * 18);
      });
    }
  }

  // ---- footer ----
  ctx.font = "600 11px Inter, sans-serif";
  ctx.fillStyle = c.muted;
  ctx.fillText(`${brandName}  •  ${websiteLabel}`, W / 2, H - 38);
  ctx.font = "500 10px Inter, sans-serif";
  ctx.fillStyle = hexToRgba(c.muted, 0.82);
  ctx.fillText("Powered by EventNexus — scan, preview, register", W / 2, H - 20);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

function splitForWrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = test;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function hexToRgba(hex: string, alpha: number): string {
  const h = String(hex || "").trim().replace(/^#/, "");
  if (h.length === 3) {
    const r = parseInt(h[0] + h[0], 16);
    const g = parseInt(h[1] + h[1], 16);
    const b = parseInt(h[2] + h[2], 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  if (h.length === 6) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    return `rgba(${r},${g},${b},${alpha})`;
  }
  return hex;
}

// ---------------------------------------------------------------------------
// Convenience: create an offscreen poster canvas and return a PNG data URL
// ---------------------------------------------------------------------------

/**
 * Create an offscreen canvas, draw the poster, and return a PNG data URL.
 * Handy when you don't want to manage the <canvas> element yourself.
 */
export async function generatePosterDataUrl(
  event: QrEventLike,
  qrDataUrl: string | HTMLImageElement,
  opts: Omit<DrawPosterOptions, "event" | "qrDataUrl"> = {}
): Promise<string> {
  const canvas = typeof document !== "undefined" ? document.createElement("canvas") : (null as unknown as HTMLCanvasElement);
  if (!canvas) throw new Error("DOM canvas unavailable (server context) — use drawPoster with an OffscreenCanvas or server-side poster helper");
  await drawPoster(canvas, { event, qrDataUrl, ...opts });
  return canvas.toDataURL("image/png");
}

/**
 * Trigger a PNG download of the poster (browser only).
 */
export async function downloadPoster(
  event: QrEventLike,
  qrDataUrl: string | HTMLImageElement,
  filename?: string,
  opts: Omit<DrawPosterOptions, "event" | "qrDataUrl"> = {}
): Promise<void> {
  const dataUrl = await generatePosterDataUrl(event, qrDataUrl, opts);
  if (typeof document === "undefined") return;
  const safe = String(event.title || "event")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  const name = filename || `${safe || "event"}-poster.png`;
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => document.body.removeChild(a), 0);
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
