import mongoose, { Schema, Document, Types } from "mongoose";

// Explicit organization membership. The loose `user.organization` field is
// the tenant pointer for data scoping; OrganizationMember is the source of
// truth for *organization-level roles* (owner/admin/manager/member) and
// membership lifecycle (join / leave / removed).
export interface IOrganizationMember extends Document {
  organization: Types.ObjectId;
  user: Types.ObjectId;
  roleInOrg?: "owner" | "admin" | "manager" | "member";
  status?: "active" | "pending" | "removed";
  invitedBy?: Types.ObjectId;
  joinedAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
}

const organizationMemberSchema = new Schema<IOrganizationMember>(
  {
    organization: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    roleInOrg: {
      type: String,
      enum: ["owner", "admin", "manager", "member"],
      default: "member",
    },
    status: {
      type: String,
      enum: ["active", "pending", "removed"],
      default: "active",
    },
    invitedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    joinedAt: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

// One active membership per user per organization; a removed membership
// doesn't block re-invitation.
organizationMemberSchema.index(
  { organization: 1, user: 1 },
  { unique: true, partialFilterExpression: { status: { $ne: "removed" } } }
);
organizationMemberSchema.index({ organization: 1, roleInOrg: 1 });
organizationMemberSchema.index({ user: 1 });

const OrganizationMember = mongoose.model<IOrganizationMember>("OrganizationMember", organizationMemberSchema);
export default OrganizationMember;

// CommonJS interop for require() compatibility
// @ts-ignore
module.exports = OrganizationMember;
// @ts-ignore
module.exports.default = OrganizationMember;
