import mongoose, { Schema, Document } from "mongoose";

export interface IPermission extends Document {
  // Stable identifier used in Role.permissions, e.g. "event:manage",
  // "user:manage", "audit:view", "collaboration:invite".
  code: string;
  name: string;
  description?: string;
  // "system" = fixed capability used by requirePermission across the app;
  // "organization" = tenant-level capability assignable via org roles.
  scope?: "system" | "organization";
  createdAt?: Date;
  updatedAt?: Date;
}

const permissionSchema = new Schema<IPermission>(
  {
    // Stable identifier used in Role.permissions, e.g. "event:manage",
    // "user:manage", "audit:view", "collaboration:invite".
    code: {
      type: String,
      required: [true, "Permission code is required"],
      unique: true,
      trim: true,
      lowercase: true,
    },
    name: {
      type: String,
      required: [true, "Permission name is required"],
      trim: true,
    },
    description: {
      type: String,
      default: "",
    },
    // "system" = fixed capability used by requirePermission across the app;
    // "organization" = tenant-level capability assignable via org roles.
    scope: {
      type: String,
      enum: ["system", "organization"],
      default: "system",
    },
  },
  { timestamps: true }
);

const Permission = mongoose.model<IPermission>("Permission", permissionSchema);
export default Permission;

// CommonJS interop for require() compatibility
// @ts-ignore
module.exports = Permission;
// @ts-ignore
module.exports.default = Permission;
