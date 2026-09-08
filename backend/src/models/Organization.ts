import mongoose, { Schema, Document, Types } from "mongoose";

// Tenant model. Onboarding is a two-step flow: an org admin registers the
// organization (full detail form → status "pending"), a platform superadmin
// verifies and approves it (status "active"), and only then can the org's
// users log in and manage their workspace.
export interface IOrganization extends Document {
  name: string;
  slug: string;
  owner: Types.ObjectId;
  status?: "pending" | "active" | "rejected" | "suspended";
  // --- Registration details (org self-registration form) -------------------
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  country?: string;
  type?: "Company" | "Non-Profit" | "Educational" | "Community" | "Government" | "Other";
  description?: string;
  website?: string;
  // --- Approval workflow (superadmin) --------------------------------------
  approvedBy?: Types.ObjectId;
  approvedAt?: Date;
  // Set when a superadmin rejects the registration (visible to the org admin
  // via the login error message so they know why).
  rejectionReason?: string;
  rejectedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

const organizationSchema = new Schema<IOrganization>(
  {
    name: {
      type: String,
      required: [true, "Organization name is required"],
      trim: true,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    owner: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "active", "rejected", "suspended"],
      default: "pending",
    },
    // --- Registration details (org self-registration form) -------------------
    email: {
      type: String,
      lowercase: true,
      trim: true,
    },
    phone: String,
    address: String,
    city: String,
    country: String,
    type: {
      type: String,
      enum: ["Company", "Non-Profit", "Educational", "Community", "Government", "Other"],
    },
    description: String,
    website: String,
    // --- Approval workflow (superadmin) --------------------------------------
    approvedBy: { type: Schema.Types.ObjectId, ref: "User" },
    approvedAt: { type: Date },
    // Set when a superadmin rejects the registration (visible to the org admin
    // via the login error message so they know why).
    rejectionReason: String,
    rejectedAt: { type: Date },
  },
  { timestamps: true }
);

const Organization = mongoose.model<IOrganization>("Organization", organizationSchema);
export default Organization;

// CommonJS interop for require() compatibility
// @ts-ignore
module.exports = Organization;
// @ts-ignore
module.exports.default = Organization;
