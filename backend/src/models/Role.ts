import mongoose, { Schema, Document } from "mongoose";

export interface IRole extends Document {
  // "admin" | "organizer" | "attendee" (system roles), or an
  // organization-scoped role name (e.g. "event-manager") for tenants.
  name: string;
  description?: string;
  scope?: "system" | "organization";
  // Permission codes (see models/Permission.js). System roles are seeded
  // with the application's permission matrix; organization roles let an
  // admin compose custom capabilities for members of their tenant.
  permissions?: string[];
  createdAt?: Date;
  updatedAt?: Date;
}

const roleSchema = new Schema<IRole>(
  {
    // "admin" | "organizer" | "attendee" (system roles), or an
    // organization-scoped role name (e.g. "event-manager") for tenants.
    name: {
      type: String,
      required: [true, "Role name is required"],
      unique: true,
      trim: true,
      lowercase: true,
    },
    description: {
      type: String,
      default: "",
    },
    scope: {
      type: String,
      enum: ["system", "organization"],
      default: "system",
    },
    // Permission codes (see models/Permission.js). System roles are seeded
    // with the application's permission matrix; organization roles let an
    // admin compose custom capabilities for members of their tenant.
    permissions: {
      type: [String],
      default: [],
    },
  },
  { timestamps: true }
);

const Role = mongoose.model<IRole>("Role", roleSchema);
export default Role;

// CommonJS interop for require() compatibility
// @ts-ignore
module.exports = Role;
// @ts-ignore
module.exports.default = Role;
