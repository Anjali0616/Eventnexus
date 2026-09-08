const crypto = require("crypto");

// eSewa's ePay v2 integration. The values below are eSewa's own published
// UAT/sandbox test credentials (documented publicly in eSewa's merchant
// integration guide for developers to test against) — they work out of the
// box against the test gateway with no signup, so paid NPR events are
// testable immediately. Point ESEWA_* env vars at production credentials +
// the production gateway URLs when going live.
const ESEWA_PRODUCT_CODE = process.env.ESEWA_PRODUCT_CODE || "EPAYTEST";
const ESEWA_SECRET_KEY = process.env.ESEWA_SECRET_KEY || "8gBm/:&EnhH.1/q";
const ESEWA_FORM_URL =
  process.env.ESEWA_FORM_URL || "https://rc-epay.esewa.com.np/api/epay/main/v2/form";
const ESEWA_STATUS_URL =
  process.env.ESEWA_STATUS_URL || "https://rc.esewa.com.np/api/epay/transaction/status/";

const SIGNED_FIELD_NAMES = "total_amount,transaction_uuid,product_code";

const sign = (message) =>
  crypto.createHmac("sha256", ESEWA_SECRET_KEY).update(message).digest("base64");

const isValidObjectId = (id) => /^[0-9a-fA-F]{24}$/.test(String(id));

// eSewa's total_amount must be formatted exactly as sent in the signed
// message and the form field, comma-free, matching what it echoes back.
//
// The comma strip is load-bearing, not defensive tidying: eSewa echoes the
// amount back on its success callback WITH a thousands separator once it
// reaches four figures ("1,792.0"). Feeding that straight to Number() yields
// NaN, which then propagated two ways — the server-to-server status check
// was built with `total_amount=NaN` (eSewa answers NOT_FOUND, so the
// callback bailed out as "unconfirmed" and no ticket was ever issued for a
// payment the attendee had actually completed), and the ticket's stored
// payment.amount became NaN. Every event priced at 1000 NPR or more was
// affected; cheaper ones slipped through, which is why it looked intermittent.
const toAmountNumber = (amount) =>
  typeof amount === "number" ? amount : Number(String(amount ?? "").replace(/,/g, "").trim());

const formatAmount = (amount) => toAmountNumber(amount).toFixed(2);

// Encodes eventId + attendeeId directly into the transaction UUID instead of
// tracking a separate "pending payment" row — the UUID round-trips through
// eSewa's signed response, so anyone tampering with it breaks the signature
// check in verifyResponse below, making this as trustworthy as a DB lookup
// would be, with no extra collection to manage. Adds random entropy to prevent enumeration.
const buildTransactionUuid = (eventId, attendeeId) => {
  const rand = crypto.randomBytes(4).toString("hex");
  return `${eventId}-${attendeeId}-${Date.now()}-${rand}`;
};

const parseTransactionUuid = (transactionUuid) => {
  const parts = String(transactionUuid).split("-");
  if (parts.length < 3) return { eventId: null, attendeeId: null, timestamp: null };
  const eventId = parts[0];
  const attendeeId = parts[1];
  const timestamp = parts[2];
  // Validate ObjectId format to prevent injection/CastError
  if (!isValidObjectId(eventId) || !isValidObjectId(attendeeId)) return { eventId: null, attendeeId: null, timestamp: null };
  // Optional TTL check: reject UUID older than 24h to limit replay window
  const tsNum = Number(timestamp);
  if (timestamp && !Number.isNaN(tsNum) && Date.now() - tsNum > 24 * 60 * 60 * 1000) {
    return { eventId: null, attendeeId: null, timestamp: null };
  }
  return { eventId, attendeeId, timestamp };
};

// Builds the full set of hidden form fields the frontend auto-submits (as a
// real HTML form POST, not fetch/XHR — this is how eSewa's ePay v2 expects
// checkout to be initiated) to ESEWA_FORM_URL.
const buildPaymentForm = ({ amount, eventId, attendeeId, successUrl, failureUrl }) => {
  const total_amount = formatAmount(amount);
  const transaction_uuid = buildTransactionUuid(eventId, attendeeId);
  const message = `total_amount=${total_amount},transaction_uuid=${transaction_uuid},product_code=${ESEWA_PRODUCT_CODE}`;
  const signature = sign(message);

  return {
    action: ESEWA_FORM_URL,
    fields: {
      amount: total_amount,
      tax_amount: "0",
      total_amount,
      transaction_uuid,
      product_code: ESEWA_PRODUCT_CODE,
      product_service_charge: "0",
      product_delivery_charge: "0",
      success_url: successUrl,
      failure_url: failureUrl,
      signed_field_names: SIGNED_FIELD_NAMES,
      signature,
    },
  };
};

// Verifies the base64 `data` query param eSewa appends to success_url.
// Must pin signed_field_names and product_code; otherwise an attacker
// could claim only a subset of fields is signed and tamper total_amount.
const verifyResponse = (data) => {
  const signedFieldNames = String(data.signed_field_names || "");
  if (signedFieldNames !== SIGNED_FIELD_NAMES) return false;
  if (String(data.product_code || "") !== ESEWA_PRODUCT_CODE) return false;
  // Validate total_amount is numeric before signing check
  if (data.total_amount != null && Number.isNaN(toAmountNumber(data.total_amount))) return false;
  const fields = signedFieldNames.split(",");
  const message = fields.map((f) => `${f}=${data[f]}`).join(",");
  const expected = sign(message);
  const sig = String(data.signature || "");
  // Constant-time compare to prevent timing oracle
  try {
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(sig, "utf8");
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
};

// Server-to-server confirmation — required because the browser redirect
// alone is client-controlled and shouldn't be trusted to issue a ticket by
// itself, mirroring why Stripe tickets are only issued from its webhook.
const checkStatus = async ({ transactionUuid, totalAmount }) => {
  const url = `${ESEWA_STATUS_URL}?product_code=${ESEWA_PRODUCT_CODE}&total_amount=${formatAmount(totalAmount)}&transaction_uuid=${transactionUuid}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`eSewa status check responded ${res.status}`);
    return res.json();
  } finally {
    clearTimeout(timeout);
  }
};

module.exports = {
  ESEWA_PRODUCT_CODE,
  buildPaymentForm,
  buildTransactionUuid,
  parseTransactionUuid,
  verifyResponse,
  checkStatus,
  // Exported so the payment controller records the same normalized number on
  // the ticket that the status check was performed with.
  toAmountNumber,
};
