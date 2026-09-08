const QRCode = require("qrcode");

/**
 * EventNexus — Advanced QR + Poster utilities
 * ============================================
 * Enhances the simple ticket-QR helper with a sharable public-event QR
 * (the one posters/flyers encode) and a server-side poster composer.
 *
 * Two different QR families exist in the app:
 *  1) Ticket QR  — `qrToken` (signed JWT) verified at check-in. Opaque,
 *                  never put on a poster (it is per-attendee, per-ticket).
 *  2) Public event QR — the event's public page URL, e.g.
 *     `https://app.example/event/<id>?qr=1&utm_source=qr&utm_medium=poster`.
 *     No auth required, lands on `/event/[id]` which shows the special QR
 *     banner when `?qr=1` is present.
 *
 * This module covers (2) and poster compositing; the ticket QR stays as-is
 * but now shares the same option surface so callers have one mental model.
 *
 * ---------------------------------------------------------------------------
 * Endpoint ideas (wire these in routes/events.js when ready):
 *
 *   GET /api/events/:id/qr
 *     Query: size (number, default 300), ecc (L|M|Q|H, default M),
 *            margin (number, default 1),
 *            dark (hex/css, default #1f2937), light (hex/css, default #ffffff),
 *            logo (boolean — whether caller intends to overlay a logo; forces H),
 *            utm_source, utm_medium, utm_campaign (tracking override),
 *            qr (bool — include ?qr=1 hint, default true),
 *            format (dataUrl|png — default dataUrl).
 *     Auth: optionalAuth (public), drafts 404 for anonymous.
 *     Returns: { eventId, publicUrl, qrDataUrl, options }  or image/png stream.
 *     Rate-limit: reuse registerLimiter burst (cheap but not free).
 *
 *   GET /api/events/:id/qr.png  (alias, Content-Type image/png)
 *     Streams raw PNG bytes produced by QRCode.toBuffer so <img src> and
 *     OG image fetchers can use it directly without base64 decoding.
 *
 *   GET /api/events/:id/poster
 *     Query: format (svg|png — svg by default, png requires sharp/canvas),
 *            width, height, theme (light|dark|brand), bg, accent,
 *            qrSize, includeBranding (bool).
 *     Returns: JSON { posterDataUrl, qrDataUrl, publicUrl } when format=svg/dataUrl,
 *              or image/svg+xml | image/png stream when Accept prefers image.
 *     Notes: poster is SVG-based so it needs no native deps; if `sharp` is
 *            installed the server will rasterize to PNG on the fly.
 *
 *   POST /api/events/:id/poster  (organizer only)
 *     Body: { qrOptions, posterOptions, logoDataUrl? } — pre-renders a
 *            branded poster and optionally uploads to object storage later.
 *
 * Implementation note on `sharp` / `canvas`:
 *   Neither is a hard dependency (both need native binaries that break on
 *   t3.micro without extra setup). generatePosterDataURI below is pure-JS
 *   SVG → data URI so it works today. If `sharp` is present we attempt a
 *   PNG raster branch; if not, we fall back to SVG — callers should treat
 *   the return as "an image data URI" and not assume PNG.
 */

// ---------------------------------------------------------------------------
// Defaults & validation helpers
// ---------------------------------------------------------------------------

const VALID_ECC = ["L", "M", "Q", "H"];

const QR_DEFAULTS = Object.freeze({
  width: 300,
  margin: 1,
  errorCorrectionLevel: "M",
  type: "image/png",
  color: Object.freeze({ dark: "#1f2937", light: "#ffffff" }),
});

const POSTER_DEFAULTS = Object.freeze({
  width: 1080,
  height: 1350,
  bgColor: "#f8fafc",
  cardColor: "#ffffff",
  accentColor: "#5b4cf5",
  textColor: "#0f172a",
  mutedColor: "#64748b",
  brandName: "EventNexus",
  brandAccent: "#5b4cf5",
  qrSize: 520,
  qrPadding: 20,
  qrBg: "#ffffff",
  radius: 24,
});

/**
 * Normalize caller-provided QR options into the shape `qrcode` expects.
 * Never mutates the input. Backwards-compatible: calling with no second
 * arg behaves exactly like the original function.
 *
 * Supported aliases (all optional):
 *   size | width  → width (number, 64–2048, default 300)
 *   ecc | errorCorrection | errorCorrectionLevel → errorCorrectionLevel (L|M|Q|H)
 *   margin → margin (0–10)
 *   color | colors → { dark, light }
 *   logo → string dataUrl OR { dataUrl, sizeRatio } — forces high ECC; actual
 *          compositing is done by the poster helper or the frontend canvas.
 *   type → "image/png" | "image/jpeg" etc.
 */
function normalizeQrOptions(options = {}) {
  const raw = options || {};

  // width / size alias
  let width = raw.width ?? raw.size ?? QR_DEFAULTS.width;
  width = Number(width);
  if (!Number.isFinite(width) || width < 64) width = QR_DEFAULTS.width;
  if (width > 2048) width = 2048;
  width = Math.round(width);

  // error correction level alias
  let ecc = raw.errorCorrectionLevel ?? raw.errorCorrection ?? raw.ecc ?? QR_DEFAULTS.errorCorrectionLevel;
  ecc = String(ecc || "M").toUpperCase();
  if (!VALID_ECC.includes(ecc)) ecc = QR_DEFAULTS.errorCorrectionLevel;

  // margin
  let margin = raw.margin ?? QR_DEFAULTS.margin;
  margin = Number(margin);
  if (!Number.isFinite(margin) || margin < 0) margin = QR_DEFAULTS.margin;
  if (margin > 10) margin = 10;
  margin = Math.round(margin);

  // color
  let color = raw.color ?? raw.colors;
  if (!color || typeof color !== "object") {
    color = QR_DEFAULTS.color;
  } else {
    color = {
      dark: typeof color.dark === "string" && color.dark.trim() ? color.dark.trim() : QR_DEFAULTS.color.dark,
      light: typeof color.light === "string" && color.light.trim() ? color.light.trim() : QR_DEFAULTS.color.light,
    };
  }

  // type
  const type = typeof raw.type === "string" && raw.type ? raw.type : QR_DEFAULTS.type;

  // logo detection — any truthy logo bumps ECC to H (more redundancy to
  // survive the center occlusion) unless caller explicitly asked for H/Q.
  const hasLogo = Boolean(
    raw.logo &&
      (typeof raw.logo === "string" ? raw.logo.trim() : raw.logo.dataUrl || raw.logo.src)
  );
  if (hasLogo && (ecc === "L" || ecc === "M")) ecc = "H";

  return { width, margin, errorCorrectionLevel: ecc, color, type, hasLogo, logo: raw.logo || null };
}

// ---------------------------------------------------------------------------
// Public event URL builder (the payload the poster QR encodes)
// ---------------------------------------------------------------------------

/**
 * Build the public event URL that the poster QR encodes.
 * Always produces a `/event/<id>` URL; tracking + qr hint params are opt-out
 * rather than opt-in so the default is the intended poster behaviour.
 *
 * @param {string} eventId - 24-hex Mongo id (validated lightly, not strictly)
 * @param {object} [opts]
 * @param {string} [opts.baseUrl] - Origin, e.g. https://eventnexus.app or
 *                                  http://localhost:3000. Falls back to
 *                                  process.env.FRONTEND_URL / PUBLIC_APP_URL.
 * @param {boolean} [opts.qrHint=true] - include ?qr=1 so the landing page can
 *                                       show its QR-arrival banner.
 * @param {boolean} [opts.withTracking=true] - include utm_source/medium.
 * @param {string} [opts.utmSource="qr"]
 * @param {string} [opts.utmMedium="poster"]
 * @param {string} [opts.utmCampaign] - optional campaign slug.
 * @param {Record<string,string>} [opts.extraParams] - any extra query entries.
 * @returns {string} absolute URL when baseUrl is known, otherwise path+query.
 */
function buildPublicEventUrl(eventId, opts = {}) {
  const id = String(eventId || "").trim();
  if (!id) throw new Error("eventId is required to build public URL");

  const baseRaw =
    opts.baseUrl ||
    process.env.FRONTEND_URL ||
    process.env.PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    "";
  // FRONTEND_URL may be comma-separated (server.js CORS); take first.
  const base = String(baseRaw).split(",")[0].trim().replace(/\/$/, "");

  const withTracking = opts.withTracking !== false;
  const qrHint = opts.qrHint !== false;
  const utmSource = opts.utmSource || "qr";
  const utmMedium = opts.utmMedium || "poster";
  const utmCampaign = opts.utmCampaign || "";

  // Use URL only when we have an absolute base; otherwise build the path manually
  // so we don't inject a fake https://example.com origin into the result.
  if (base && /^https?:\/\//i.test(base)) {
    const url = new URL(`${base}/event/${id}`);
    if (qrHint) url.searchParams.set("qr", "1");
    if (withTracking) {
      url.searchParams.set("utm_source", utmSource);
      url.searchParams.set("utm_medium", utmMedium);
      if (utmCampaign) url.searchParams.set("utm_campaign", utmCampaign);
    }
    if (opts.extraParams && typeof opts.extraParams === "object") {
      for (const [k, v] of Object.entries(opts.extraParams)) {
        if (v != null && String(v).trim() !== "") url.searchParams.set(String(k), String(v));
      }
    }
    return url.toString();
  }

  // Relative fallback (e.g. in tests where env isn't set)
  const sp = new URLSearchParams();
  if (qrHint) sp.set("qr", "1");
  if (withTracking) {
    sp.set("utm_source", utmSource);
    sp.set("utm_medium", utmMedium);
    if (utmCampaign) sp.set("utm_campaign", utmCampaign);
  }
  if (opts.extraParams && typeof opts.extraParams === "object") {
    for (const [k, v] of Object.entries(opts.extraParams)) {
      if (v != null && String(v).trim() !== "") sp.set(String(k), String(v));
    }
  }
  const qs = sp.toString();
  return qs ? `/event/${id}?${qs}` : `/event/${id}`;
}

// ---------------------------------------------------------------------------
// Enhanced QR generator (backwards-compatible)
// ---------------------------------------------------------------------------

/**
 * Generate a QR code as a base64 data URI.
 *
 * Previous signature was `generateQRCodeDataURI(data)` with fixed options.
 * New signature is `generateQRCodeDataURI(data, options)` where `options`
 * is fully optional — omitting it preserves the exact previous output.
 *
 * @param {string} data - The data to encode (ticket JWT, or a public event URL).
 * @param {object} [options] - See normalizeQrOptions.
 * @param {number} [options.size] - Alias for width (px). Default 300.
 * @param {number} [options.width] - QR width in px.
 * @param {string} [options.errorCorrectionLevel] - L|M|Q|H. Default M (H if logo).
 * @param {string} [options.ecc] - Alias for errorCorrectionLevel.
 * @param {number} [options.margin] - Quiet zone modules. Default 1.
 * @param {{dark:string,light:string}} [options.color] - Module colors.
 * @param {string|object} [options.logo] - Truthy reserves center; not rendered here.
 * @returns {Promise<string|null>} data URI or null on failure.
 */
const generateQRCodeDataURI = async (data, options = {}) => {
  try {
    if (typeof data !== "string" || !data.trim()) {
      throw new Error("QR data must be a non-empty string");
    }
    const { width, margin, errorCorrectionLevel, color, type } = normalizeQrOptions(options);
    return await QRCode.toDataURL(data, {
      errorCorrectionLevel,
      type,
      margin,
      width,
      color,
    });
  } catch (err) {
    console.error("[qrCode] Failed to generate QR code:", err.message);
    return null;
  }
};

/**
 * Convenience: generate the public-event QR directly from an event id.
 * Builds the tracked public URL and then renders it as a QR data URI.
 *
 * @param {string} eventId
 * @param {object} [opts] - { baseUrl, qrOptions, urlOptions }
 * @returns {Promise<{ publicUrl:string, qrDataUrl:string|null }>}
 */
async function generateEventQrDataURI(eventId, opts = {}) {
  const publicUrl = buildPublicEventUrl(eventId, opts.urlOptions || { baseUrl: opts.baseUrl });
  const qrDataUrl = await generateQRCodeDataURI(publicUrl, opts.qrOptions || opts);
  return { publicUrl, qrDataUrl };
}

// ---------------------------------------------------------------------------
// Poster composer (server-side, no native deps required)
// ---------------------------------------------------------------------------

function escapeXml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function truncate(str, max) {
  const s = String(str ?? "").trim();
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
}

function formatPosterDate(dateInput) {
  try {
    const d = new Date(dateInput);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

function wrapWords(text, maxLen) {
  const words = String(text || "").split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (next.length > maxLen) {
      if (line) lines.push(line);
      line = w;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Generate a poster image data URI that composites event info + a QR code.
 *
 * This is intentionally SVG-first: no sharp/canvas required, works on
 * t3.micro today, and the output is sharp at any size. If `sharp` is
 * installed, callers can ask for PNG and we will rasterize server-side.
 *
 * The poster is meant to be downloadable/sharable — not a pixel-perfect
 * marketing asset, but a clean, branded handout with enough signal for a
 * passer-by to understand the event and scan.
 *
 * @param {object} event - Event doc or subset { _id, title, date, venue, category, type, description, price, imageUrl? }
 * @param {string} qrDataUrl - Data URI of the QR (from generateQRCodeDataURI). If falsy, one is generated from event._id.
 * @param {object} [posterOptions]
 * @param {number} [posterOptions.width]
 * @param {number} [posterOptions.height]
 * @param {string} [posterOptions.bgColor]
 * @param {string} [posterOptions.accentColor]
 * @param {string} [posterOptions.textColor]
 * @param {string} [posterOptions.mutedColor]
 * @param {string} [posterOptions.brandName]
 * @param {number} [posterOptions.qrSize]
 * @param {boolean} [posterOptions.includeBranding]
 * @param {string} [posterOptions.baseUrl] - used if we must generate the QR internally.
 * @param {"svg"|"png"} [posterOptions.format="svg"] - png attempts sharp rasterization.
 * @returns {Promise<string|null>} data URI (image/svg+xml or image/png) or null on failure.
 */
async function generatePosterDataURI(event, qrDataUrl, posterOptions = {}) {
  try {
    if (!event || typeof event !== "object") throw new Error("event is required");
    const title = truncate(event.title || "Untitled Event", 90);
    if (!title) throw new Error("event.title is required");

    const opts = { ...POSTER_DEFAULTS, ...posterOptions };
    const W = Math.max(600, Math.min(2400, Number(opts.width) || POSTER_DEFAULTS.width));
    const H = Math.max(800, Math.min(3000, Number(opts.height) || POSTER_DEFAULTS.height));
    const qrSize = Math.max(160, Math.min(Math.min(W, H) * 0.7, Number(opts.qrSize) || POSTER_DEFAULTS.qrSize));
    const brandName = String(opts.brandName || POSTER_DEFAULTS.brandName);

    // Ensure we have a QR data URI — generate one from the event id if missing.
    let qr = qrDataUrl;
    if (!qr || typeof qr !== "string" || !qr.startsWith("data:image")) {
      const fallbackId = event._id || event.id;
      if (!fallbackId) throw new Error("qrDataUrl missing and event has no _id to derive one");
      const publicUrl = buildPublicEventUrl(String(fallbackId), { baseUrl: opts.baseUrl });
      qr = await generateQRCodeDataURI(publicUrl, { width: qrSize, errorCorrectionLevel: "H", margin: 1 });
      if (!qr) throw new Error("failed to generate fallback QR");
    }

    const dateLabel = formatPosterDate(event.date);
    const venueLabel = truncate(event.venue || "Venue TBA", 48);
    const categoryLabel = escapeXml(truncate(event.category || "Event", 24));
    const typeLabel = escapeXml(truncate(event.type || "In-person", 20));
    const descriptionRaw = truncate(event.description || "", 220);
    const descLines = descriptionRaw ? wrapWords(descriptionRaw, 56) : [];

    // Title wrapping — SVG <text> doesn't wrap, so we emit <tspan>s.
    const titleLines = wrapWords(title, 28);
    const titleFontSize = titleLines.length > 2 ? 44 : 52;

    // Price badge
    const price = event.price;
    const isFree = !price || !price.amount || Number(price.amount) <= 0;
    const currency = String(price?.currency || "NPR").toUpperCase();
    const priceLabel = isFree
      ? "Free"
      : currency === "NPR"
      ? `Rs. ${Number(price.amount).toLocaleString("en-US")}`
      : `${currency} ${Number(price.amount).toLocaleString("en-US")}`;

    // Layout metrics
    const pad = 48;
    const topBarH = 72;
    const cardX = pad;
    const cardY = topBarH + 28;
    const cardW = W - pad * 2;
    const cardH = H - cardY - pad - 72; // leave footer room
    const qrPad = Number(opts.qrPadding) || POSTER_DEFAULTS.qrPadding;
    const qrOuter = qrSize + qrPad * 2;
    const qrX = Math.round((W - qrOuter) / 2);
    // Place QR roughly in the vertical middle of the card
    const qrY = cardY + 220;

    // Escape once for XML
    const escTitleLines = titleLines.map(escapeXml);
    const escVenue = escapeXml(venueLabel);
    const escDate = escapeXml(dateLabel);
    const escDescLines = descLines.map(escapeXml);
    const escPrice = escapeXml(priceLabel);
    const escBrand = escapeXml(brandName);

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeXml(title)} poster">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${opts.accentColor}" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="${opts.accentColor}" stop-opacity="0"/>
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="12" stdDeviation="18" flood-color="#0f172a" flood-opacity="0.12"/>
    </filter>
    <clipPath id="qrClip"><rect x="${qrX + qrPad}" y="${qrY + qrPad}" width="${qrSize}" height="${qrSize}" rx="12"/></clipPath>
  </defs>

  <!-- background -->
  <rect width="${W}" height="${H}" rx="32" fill="${opts.bgColor}"/>
  <rect width="${W}" height="${H}" rx="32" fill="url(#g)"/>

  <!-- top brand bar -->
  <rect width="${W}" height="${topBarH}" rx="32" fill="${opts.accentColor}"/>
  <rect y="${topBarH - 32}" width="${W}" height="32" fill="${opts.accentColor}"/>
  <text x="${pad}" y="${topBarH / 2 + 7}" font-family="Inter, ui-sans-serif, system-ui, -apple-system, sans-serif" font-size="22" font-weight="800" letter-spacing="-0.02em" fill="#ffffff">${escBrand}</text>
  <text x="${W - pad}" y="${topBarH / 2 + 6}" text-anchor="end" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="12" font-weight="600" letter-spacing="0.12em" fill="rgba(255,255,255,0.9)">SCAN TO JOIN</text>

  <!-- white card -->
  <g filter="url(#shadow)">
    <rect x="${cardX}" y="${cardY}" width="${cardW}" height="${cardH}" rx="${opts.radius}" fill="${opts.cardColor}" stroke="rgba(15,23,42,0.08)" stroke-width="1"/>
  </g>

  <!-- category + type pills -->
  <g transform="translate(${cardX + 28}, ${cardY + 28})">
    <rect width="${Math.min(160, categoryLabel.length * 9 + 28)}" height="28" rx="14" fill="${opts.accentColor}" opacity="0.12"/>
    <text x="14" y="19" font-family="Inter, sans-serif" font-size="11" font-weight="700" letter-spacing="0.08em" fill="${opts.accentColor}">${categoryLabel.toUpperCase()}</text>
  </g>
  <g transform="translate(${cardX + 28 + Math.min(160, categoryLabel.length * 9 + 28) + 10}, ${cardY + 28})">
    <rect width="${Math.min(120, typeLabel.length * 8 + 24)}" height="28" rx="14" fill="#f1f5f9" stroke="rgba(15,23,42,0.06)" />
    <text x="12" y="19" font-family="Inter, sans-serif" font-size="11" font-weight="600" fill="${opts.mutedColor}">${escapeXml(typeLabel)}</text>
  </g>
  <!-- price pill (right aligned) -->
  <g transform="translate(${cardX + cardW - 28 - Math.min(140, escPrice.length * 9 + 28)}, ${cardY + 28})">
    <rect width="${Math.min(140, escPrice.length * 9 + 28)}" height="28" rx="14" fill="${isFree ? "#10b981" : opts.accentColor}"/>
    <text x="14" y="19" font-family="Inter, sans-serif" font-size="11" font-weight="800" letter-spacing="0.04em" fill="#ffffff">${escPrice.toUpperCase()}</text>
  </g>

  <!-- title -->
  <text x="${W / 2}" y="${cardY + 110}" text-anchor="middle" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="${titleFontSize}" font-weight="900" letter-spacing="-0.03em" fill="${opts.textColor}">
    ${escTitleLines.map((l, i) => `<tspan x="${W / 2}" dy="${i === 0 ? 0 : 56}">${l}</tspan>`).join("")}
  </text>

  <!-- date • venue -->
  <text x="${W / 2}" y="${cardY + 110 + titleLines.length * 56 + 22}" text-anchor="middle" font-family="Inter, sans-serif" font-size="15" font-weight="500" fill="${opts.mutedColor}">${escDate ? `${escDate}  •  ${escVenue}` : escVenue}</text>

  <!-- QR white plate -->
  <rect x="${qrX}" y="${qrY}" width="${qrOuter}" height="${qrOuter}" rx="24" fill="${opts.qrBg}" stroke="rgba(15,23,42,0.08)" stroke-width="1"/>
  <!-- QR image -->
  <image href="${qr}" x="${qrX + qrPad}" y="${qrY + qrPad}" width="${qrSize}" height="${qrSize}" preserveAspectRatio="xMidYMid meet" clip-path="url(#qrClip)"/>

  <!-- scan hint -->
  <text x="${W / 2}" y="${qrY + qrOuter + 36}" text-anchor="middle" font-family="Inter, sans-serif" font-size="13" font-weight="700" letter-spacing="0.08em" fill="${opts.mutedColor}">SCAN WITH YOUR CAMERA</text>
  <text x="${W / 2}" y="${qrY + qrOuter + 58}" text-anchor="middle" font-family="Inter, sans-serif" font-size="12" font-weight="500" fill="${opts.mutedColor}">Opens the public event page — no login required to preview</text>

  ${escDescLines.length ? `<text x="${W / 2}" y="${qrY + qrOuter + 96}" text-anchor="middle" font-family="Inter, sans-serif" font-size="12.5" font-weight="500" fill="${opts.mutedColor}">${escDescLines.map((l, i) => `<tspan x="${W / 2}" dy="${i === 0 ? 0 : 18}">${l}</tspan>`).join("")}</text>` : ""}

  <!-- footer -->
  <text x="${W / 2}" y="${H - 38}" text-anchor="middle" font-family="Inter, sans-serif" font-size="11" font-weight="600" letter-spacing="0.06em" fill="${opts.mutedColor}">${escBrand}  •  ${escapeXml(opts.baseUrl || "eventnexus.app")}</text>
  <text x="${W / 2}" y="${H - 20}" text-anchor="middle" font-family="Inter, sans-serif" font-size="10" font-weight="500" fill="${opts.mutedColor}" opacity="0.8">Powered by EventNexus — scan, preview, register</text>
</svg>`;

    // SVG data URI (works everywhere, no native dep)
    const svgBase64 = Buffer.from(svg, "utf8").toString("base64");
    const svgDataUri = `data:image/svg+xml;base64,${svgBase64}`;

    // If PNG requested and sharp is available, rasterize.
    if (String(posterOptions.format || "svg").toLowerCase() === "png") {
      try {
        // Lazy require so missing sharp doesn't crash the module.
        // eslint-disable-next-line global-require, import/no-extraneous-dependencies
        const sharp = require("sharp");
        const pngBuffer = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
        return `data:image/png;base64,${pngBuffer.toString("base64")}`;
      } catch (e) {
        // sharp not installed or raster failed — fall back to SVG and log once
        console.warn("[qrCode] PNG poster requested but sharp unavailable — returning SVG:", e.message);
        return svgDataUri;
      }
    }

    return svgDataUri;
  } catch (err) {
    console.error("[qrCode] Failed to generate poster:", err.message);
    return null;
  }
}

module.exports = {
  generateQRCodeDataURI,
  generateEventQrDataURI,
  generatePosterDataURI,
  buildPublicEventUrl,
  normalizeQrOptions,
  QR_DEFAULTS,
  POSTER_DEFAULTS,
  VALID_ECC,
};
