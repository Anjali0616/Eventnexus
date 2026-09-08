import mongoose, { Schema, Document, Types } from "mongoose";

export interface IFeedback extends Document {
  event: Types.ObjectId;
  attendee: Types.ObjectId;
  organization: Types.ObjectId;
  rating: number;
  comment?: string;
  // Computed at submission time — see utils/sentiment.js.
  sentiment?: "positive" | "neutral" | "negative";
  sentimentScore?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const feedbackSchema = new Schema<IFeedback>(
  {
    event: {
      type: Schema.Types.ObjectId,
      ref: "Event",
      required: true,
    },
    attendee: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    organization: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    comment: {
      type: String,
      trim: true,
      maxlength: 1000,
      default: "",
    },
    // Computed at submission time — see utils/sentiment.js.
    sentiment: {
      type: String,
      enum: ["positive", "neutral", "negative"],
      default: "neutral",
    },
    sentimentScore: {
      type: Number, // -1..1
      default: 0,
    },
  },
  { timestamps: true }
);

// One feedback submission per attendee per event.
feedbackSchema.index({ event: 1, attendee: 1 }, { unique: true });

const Feedback = mongoose.model<IFeedback>("Feedback", feedbackSchema);
export default Feedback;

// CommonJS interop for require() compatibility
// @ts-ignore
module.exports = Feedback;
// @ts-ignore
module.exports.default = Feedback;
