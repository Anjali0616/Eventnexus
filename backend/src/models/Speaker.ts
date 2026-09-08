import mongoose, { Schema, Document, Types } from "mongoose";

export interface ISpeakerSocialLinks {
  linkedin?: string;
  twitter?: string;
  website?: string;
}

export interface ISpeaker extends Document {
  organization: Types.ObjectId;
  name: string;
  email?: string;
  title?: string;
  company?: string;
  bio?: string;
  photoUrl?: string;
  socialLinks?: ISpeakerSocialLinks;
  isExternal?: boolean;
  createdAt?: Date;
  updatedAt?: Date;
}

const speakerSchema = new Schema<ISpeaker>(
  {
    organization: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    name: {
      type: String,
      required: [true, "Speaker name is required"],
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    title: {
      type: String,
      trim: true,
      default: "",
    },
    company: {
      type: String,
      trim: true,
      default: "",
    },
    bio: {
      type: String,
      trim: true,
      default: "",
    },
    photoUrl: {
      type: String,
      default: "",
    },
    socialLinks: {
      linkedin: { type: String, default: "" },
      twitter: { type: String, default: "" },
      website: { type: String, default: "" },
    },
    isExternal: {
      type: Boolean,
      default: true, // external speakers vs internal team members
    },
  },
  { timestamps: true }
);

speakerSchema.index({ organization: 1, name: 1 });
speakerSchema.index({ email: 1 }, { sparse: true });

const Speaker = mongoose.model<ISpeaker>("Speaker", speakerSchema);
export default Speaker;

// CommonJS interop for require() compatibility
// @ts-ignore
module.exports = Speaker;
// @ts-ignore
module.exports.default = Speaker;
