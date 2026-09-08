const QRCode = require("qrcode");

/**
 * EventNexus — QR utilities (QR-only)
 * ====================================
 * Provides public-event QR helpers and ticket QR rendering.
 *
 * Two different QR families exist in the app:
 *  1) Ticket QR  — `qrToken` (signed JWT) verified at check-in. Opaque,
 *                  per-attendee, per-ticket.
 *  2) Public event QR — the event's public page URL, e.g.
 *     `https://app.example/event/<id>?qr=1&utm_source=qr&utm_medium=qr`.
 *     No auth required, lands on `/event/[id]` which shows the special QR
 *     banner when `?qr=1` is present.
 *
 * This module covers (2) and ticket QR rendering. QR is the only
 * supported shareable asset.
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
 *          compositing is done by the frontend canvas.
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
// Public event URL builder (the payload the QR encodes)
// ---------------------------------------------------------------------------

/**
 * Build the public event URL that the QR encodes.
 * Always produces a `/event/<id>` URL; tracking + qr hint params are opt-out
 * rather than opt-in so the default is the intended QR behaviour.
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
 * @param {string} [opts.utmMedium="qr"]
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
  const utmMedium = opts.utmMedium || "qr";
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

module.exports = {
  generateQRCodeDataURI,
  generateEventQrDataURI,
  buildPublicEventUrl,
  normalizeQrOptions,
  QR_DEFAULTS,
  VALID_ECC,
};
