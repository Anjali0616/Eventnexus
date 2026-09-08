import nodemailer from "nodemailer";
import Mail from "../models/Mail";
import { renderEmail } from "./emailTemplates";

/**
 * Email transport configuration.
 * In development, we fall back to dev-mode (console log + DB storage) if no
 * SMTP credentials are provided. In production, you MUST set SMTP_HOST,
 * SMTP_PORT, SMTP_USER, SMTP_PASS, and EMAIL_FROM environment variables.
 *
 * For Gmail: set SMTP_HOST=smtp.gmail.com, SMTP_PORT=587, and use an
 * App Password for SMTP_PASS. For other providers, adjust accordingly.
 */
let transporter: any = null;

function getTransporter(): any {
  if (transporter) return transporter;

  const {
    SMTP_HOST,
    SMTP_PORT,
    SMTP_USER,
    EMAIL_FROM,
    NODE_ENV,
  } = process.env;
  // Support both SMTP_PASS and SMTP_PASSWORD (env uses SMTP_PASSWORD, code checked SMTP_PASS)
  const SMTP_PASS: string | undefined = process.env.SMTP_PASS || process.env.SMTP_PASSWORD;

  // If no SMTP config, we stay in dev mode (console log only)
  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS) {
    if (NODE_ENV !== "production") {
      return null; // dev mode
    }
    console.warn(
      "[email] WARNING: SMTP credentials not set — emails will not be sent!"
    );
    return null;
  }

  transporter = (nodemailer as any).createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465, // true for 465, false for 587/other
    auth: {
      user: SMTP_USER,
      pass: SMTP_PASS,
    },
    // Allow self-signed certs in dev (e.g. local Mailhog)
    tls: NODE_ENV !== "production" ? { rejectUnauthorized: false } : undefined,
  });

  return transporter;
}

/**
 * Send an email using nodemailer (or dev-mode fallback).
 * All controllers call this function — they don't need to know the transport.
 *
 * @param opts
 * @param opts.to — recipient email
 * @param opts.subject — email subject
 * @param opts.template — template name (without .html extension)
 * @param opts.templateData — data for template interpolation
 * @param opts.text — plain-text body (fallback if template not found)
 * @param opts.html — HTML body (overrides template if provided)
 * @param opts.metadata — extra metadata to store in Mail log
 * @returns — the created Mail document (with messageId if sent)
 */
export const sendMail = async ({ to, subject, template, templateData, text, html, metadata }: {
  to: string;
  subject: string;
  template?: string;
  templateData?: Record<string, any>;
  text?: string;
  html?: string;
  metadata?: Record<string, any>;
}): Promise<any> => {
  let finalHtml: string | undefined = html;
  let finalText: string | undefined = text;

  // If template is provided and no explicit html/text, render from template
  if (template && !html && !text) {
    try {
      const rawFrontendUrl = process.env.FRONTEND_URL || "http://localhost:3000";
      const frontendUrl = String(rawFrontendUrl).split(",")[0].trim().replace(/\/$/, "") || "http://localhost:3000";
      const templateResult: string = renderEmail(template, {
        ...templateData,
        frontendUrl,
      });
      finalHtml = templateResult;
      // Generate text version from HTML (strip tags)
      finalText = templateResult.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
    } catch (err: any) {
      console.warn(`[email] Template "${template}" not found or failed to render, falling back to text:`, err.message);
      // If template fails, we'll use provided text or generate basic text
      if (!text) {
        finalText = `EventNexus notification: ${subject}`;
      }
    }
  }

  // Always log to DB for audit trail
  const mail: any = await (Mail as any).create({
    to,
    subject,
    template,
    text: finalText,
    html: finalHtml,
    metadata,
  });

  const transport = getTransporter();

  if (!transport) {
    // Dev mode: log to console only
    console.log("\n  ┌──────────────── [mail:dev] ───────────────┐");
    console.log(`  │ To:      ${to}`);
    console.log(`  │ Subject: ${subject}`);
    if (finalText) console.log(`  │ ${finalText.split("\n").join("\n  │ ")}`);
    console.log("  └───────────────────────────────────────────┘\n");
    return mail;
  }

  try {
    const info: any = await transport.sendMail({
      from: process.env.EMAIL_FROM || "EventNexus <noreply@eventnexus.dev>",
      to,
      subject,
      text: finalText,
      html: finalHtml,
    });

    // Update mail record with provider's message ID
    mail.messageId = info.messageId;
    mail.sentAt = new Date();
    await mail.save();

    console.log(`[email] sent to ${to} — messageId: ${info.messageId}`);
    return mail;
  } catch (err: any) {
    mail.error = err.message;
    await mail.save();
    console.error("[email] send failed:", err.message);
    // Don't throw — we don't want to break the user flow if email fails
    return mail;
  }
};

/**
 * Verify SMTP connection on startup (optional but recommended).
 * Call this from your server bootstrap if you want to fail fast on bad config.
 */
export const verifyConnection = async (): Promise<boolean> => {
  const transport = getTransporter();
  if (!transport) return false;
  try {
    await transport.verify();
    console.log("[email] SMTP connection verified");
    return true;
  } catch (err: any) {
    console.error("[email] SMTP verification failed:", err.message);
    return false;
  }
};

export default { sendMail, verifyConnection };
