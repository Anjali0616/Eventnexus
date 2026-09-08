import mongoose, { Schema, Document, Types } from "mongoose";

// An event SCHEDULE session: a talk/workshop/slot that belongs to a specific
// Event (e.g. a "Deep Dive" track slot at a conference). This is distinct from
// an auth refresh-token session (models/Session.js). They were previously the
// same model name, which broke login; this now has its own namespace so the
// auth flow and the event-schedule CRUD can evolve independently.
export interface IEventSession extends Document {
  event: Types.ObjectId;
  organization: Types.ObjectId;
  title: string;
  description?: string;
  track?: string;
  startTime: Date;
  endTime: Date;
  location?: string;
  speakers?: Types.ObjectId[];
  capacity?: number;
  registered?: number;
  isPublic?: boolean;
  status?: "scheduled" | "live" | "completed" | "cancelled";
  createdAt?: Date;
  updatedAt?: Date;
}

const eventSessionSchema = new Schema<IEventSession>(
  {
    event: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      required: true,
    },
    organization: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    title: {
      type: String,
      required: [true, "Session title is required"],
      trim: true,
    },
    description: {
      type: String,
      default: "",
      trim: true,
    },
    track: {
      type: String,
      trim: true,
      default: "",
    },
    startTime: {
      type: Date,
      required: [true, "Session start time is required"],
    },
    endTime: {
      type: Date,
      required: [true, "Session end time is required"],
    },
    location: {
      type: String,
      trim: true,
      default: "",
    },
    speakers: [
      {
        type: Schema.Types.ObjectId,
        ref: "Speaker",
      },
    ],
    capacity: {
      type: Number,
      min: 0,
      default: 0, // 0 = unlimited
    },
    registered: {
      type: Number,
      default: 0,
    },
    isPublic: {
      type: Boolean,
      default: true,
    },
    status: {
      type: String,
      enum: ["scheduled", "live", "completed", "cancelled"],
      default: "scheduled",
    },
  },
  { timestamps: true }
);

// Indexes for efficient queries
eventSessionSchema.index({ event: 1, startTime: 1 });
eventSessionSchema.index({ organization: 1 });
eventSessionSchema.index({ track: 1 });

// Prevent overlapping sessions for same track at same event
eventSessionSchema.pre("save", async function (next) {
  if ((this as any).isModified("startTime") || (this as any).isModified("endTime") || (this as any).isModified("track")) {
    const overlap = await (this.constructor as any).findOne({
      _id: { $ne: (this as any)._id },
      event: (this as any).event,
      track: (this as any).track,
      status: { $ne: "cancelled" },
      $or: [{ startTime: { $lt: (this as any).endTime }, endTime: { $gt: (this as any).startTime } }],
    });
    if (overlap) {
      const err: any = new Error(`Session overlaps with "${overlap.title}" in track "${(this as any).track}"`);
      err.status = 400;
      return next(err);
    }
  }
  next();
});

const EventSession = mongoose.model<IEventSession>("EventSession", eventSessionSchema);
export default EventSession;

// CommonJS interop for require() compatibility
// @ts-ignore
module.exports = EventSession;
// @ts-ignore
module.exports.default = EventSession;
