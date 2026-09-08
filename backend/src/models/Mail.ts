import mongoose, { Schema, Document } from "mongoose";

// Development-mode email log. In dev there is no SMTP server — "sent" emails
// (verification links, password resets, registration confirmations) are
// written here and printed to the server console so the full flow can be
// exercised locally. Swap utils/email.js sendMail() with a real provider in
// production without touching controllers.
export interface IMail extends Document {
  to: string;
  subject: string;
  template?: string;
  text?: string;
  html?: string;
  metadata?: any;
  createdAt?: Date;
  updatedAt?: Date;
}

const mailSchema = new Schema<IMail>(
  {
    to: { type: String, required: true, index: true },
    subject: { type: String, required: true },
    template: String,
    text: String,
    html: String,
    metadata: {},
  },
  { timestamps: true }
);

const Mail = mongoose.model<IMail>("Mail", mailSchema);
export default Mail;

// CommonJS interop for require() compatibility
// @ts-ignore
module.exports = Mail;
// @ts-ignore
module.exports.default = Mail;
