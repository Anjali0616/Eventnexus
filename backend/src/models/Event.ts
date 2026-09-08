import mongoose, { Schema, Document, Types } from "mongoose";

export interface IEventCoordinatesGeo {
  type?: "Point";
  coordinates?: number[];
}

export interface IEventCoordinates {
  lat?: number;
  lng?: number;
  // GeoJSON mirror of lat/lng (kept in sync below), indexed with
  // 2dsphere so "notify people near this event" is a real geo query
  // instead of an application-level scan.
  // No defaults — see the matching comment on User.location.geo.
  geo?: IEventCoordinatesGeo;
}

export interface IEventPrice {
  amount?: number;
  currency?: string;
}

export interface IEventAgendaItem {
  time?: string;
  title?: string;
  description?: string;
}

export interface IEventSpeakerEmbedded {
  name?: string;
  role?: string;
  bio?: string;
  photoUrl?: string;
}

export interface IEventReminderSettings {
  enabled?: boolean;
  // Minutes before event start to send a reminder. Defaults to 24h and 1h.
  offsets?: number[];
  // Hours after event end to send a feedback reminder nudge.
  feedbackDelayHours?: number;
}

export interface IEvent extends Document {
  title: string;
  description?: string;
  date: Date;
  venue: string;
  // Optional geo-coordinates of the venue, used to rank events by distance
  // from an attendee's saved location.
  coordinates?: IEventCoordinates;
  type?: "In-person" | "Hybrid" | "Virtual";
  category: string;
  capacity: number;
  // Structured price so payment amounts are computable server-side (not a
  // free-text label). amount === 0 means the event is free — registration
  // skips the payment flow entirely in that case.
  price?: IEventPrice;
  status?: "Upcoming" | "Live" | "Past" | "Draft";
  // Cover image for the event's public/detail pages. Stored as a data URL
  // (the frontend downsizes/compresses the source image client-side before
  // sending it) since no object-storage provider is configured yet.
  imageUrl?: string;
  tags?: string[];
  // Short bullet points shown as "what to expect" on the detail page.
  highlights?: string[];
  // Ordered run-of-show items for the detail page's agenda/timeline.
  agenda?: IEventAgendaItem[];
  speakers?: IEventSpeakerEmbedded[];
  // Free-text prerequisites / what to bring (e.g. "Laptop, student ID").
  requirements?: string;
  refundPolicy?: string;
  contactEmail?: string;
  contactPhone?: string;
  website?: string;
  // Reminder configuration for this event.
  // When enabled, attendees with reminderEmail=true receive in-app + email
  // reminders at the specified offsets (minutes before start) and a feedback
  // nudge after the event ends. Organizers manage this in the event workspace.
  reminderSettings?: IEventReminderSettings;
  // Co-host organizations — additional organizations that can manage this
  // event. Members with roleInOrg 'owner' or 'admin' in these organizations
  // gain organizer-level access (manage event, attendees, check-in, analytics).
  coHostOrganizations?: Types.ObjectId[];
  organizer: Types.ObjectId;
  organization: Types.ObjectId;
  registered?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

const eventSchema = new Schema<IEvent>(
  {
    title: {
      type: String,
      required: [true, "Event title is required"],
      trim: true,
    },
    description: {
      type: String,
      default: "",
    },
    date: {
      type: Date,
      required: [true, "Event date is required"],
    },
    venue: {
      type: String,
      required: [true, "Venue is required"],
      trim: true,
    },
    // Optional geo-coordinates of the venue, used to rank events by distance
    // from an attendee's saved location.
    coordinates: {
      lat: { type: Number },
      lng: { type: Number },
      // GeoJSON mirror of lat/lng (kept in sync below), indexed with
      // 2dsphere so "notify people near this event" is a real geo query
      // instead of an application-level scan.
      // No defaults — see the matching comment on User.location.geo.
      geo: {
        type: { type: String, enum: ["Point"] },
        coordinates: { type: [Number] },
      },
    },
    type: {
      type: String,
      enum: ["In-person", "Hybrid", "Virtual"],
      default: "In-person",
    },
    category: {
      type: String,
      required: [true, "Category is required"],
      trim: true,
    },
    capacity: {
      type: Number,
      required: [true, "Capacity is required"],
      min: 1,
    },
    // Structured price so payment amounts are computable server-side (not a
    // free-text label). amount === 0 means the event is free — registration
    // skips the payment flow entirely in that case.
    price: {
      amount: { type: Number, default: 0, min: 0 },
      currency: { type: String, default: "NPR", uppercase: true, trim: true },
    },
    status: {
      type: String,
      enum: ["Upcoming", "Live", "Past", "Draft"],
      default: "Draft",
    },
    // Cover image for the event's public/detail pages. Stored as a data URL
    // (the frontend downsizes/compresses the source image client-side before
    // sending it) since no object-storage provider is configured yet.
    imageUrl: {
      type: String,
      default: "",
    },
    tags: {
      type: [String],
      default: [],
    },
    // Short bullet points shown as "what to expect" on the detail page.
    highlights: {
      type: [String],
      default: [],
    },
    // Ordered run-of-show items for the detail page's agenda/timeline.
    agenda: {
      type: [
        {
          time: { type: String, trim: true },
          title: { type: String, trim: true },
          description: { type: String, trim: true, default: "" },
        },
      ],
      default: [],
    },
    speakers: {
      type: [
        {
          name: { type: String, trim: true },
          role: { type: String, trim: true, default: "" },
          bio: { type: String, trim: true, default: "" },
          photoUrl: { type: String, default: "" },
        },
      ],
      default: [],
    },
    // Free-text prerequisites / what to bring (e.g. "Laptop, student ID").
    requirements: {
      type: String,
      default: "",
    },
    refundPolicy: {
      type: String,
      default: "",
    },
    contactEmail: {
      type: String,
      trim: true,
      default: "",
    },
    contactPhone: {
      type: String,
      trim: true,
      default: "",
    },
    website: {
      type: String,
      trim: true,
      default: "",
    },
    // Reminder configuration for this event.
    // When enabled, attendees with reminderEmail=true receive in-app + email
    // reminders at the specified offsets (minutes before start) and a feedback
    // nudge after the event ends. Organizers manage this in the event workspace.
    reminderSettings: {
      enabled: { type: Boolean, default: true },
      // Minutes before event start to send a reminder. Defaults to 24h and 1h.
      offsets: { type: [Number], default: [1440, 60] },
      // Hours after event end to send a feedback reminder nudge.
      feedbackDelayHours: { type: Number, default: 24 },
    },
    // Co-host organizations — additional organizations that can manage this
    // event. Members with roleInOrg 'owner' or 'admin' in these organizations
    // gain organizer-level access (manage event, attendees, check-in, analytics).
    coHostOrganizations: [
      {
        type: Schema.Types.ObjectId,
        ref: "Organization",
      },
    ],
    organizer: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    organization: {
      type: Schema.Types.ObjectId,
      ref: "Organization",
      required: true,
    },
    registered: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

eventSchema.index({ "coordinates.geo": "2dsphere" });
eventSchema.index({ status: 1, date: 1 });
eventSchema.index({ date: 1 });
eventSchema.index({ "price.amount": 1, status: 1, date: 1 });
eventSchema.index({ registered: -1 });
eventSchema.index({ category: 1, status: 1 });
eventSchema.index({ title: "text" });
eventSchema.index({ organization: 1, status: 1, date: 1 });
eventSchema.index({ organization: 1, coHostOrganizations: 1 });
eventSchema.index({ coHostOrganizations: 1, status: 1, date: 1 });
eventSchema.index({ organization: 1, "price.amount": 1, status: 1, date: 1 });

eventSchema.pre("save", function (next) {
  if ((this as any).isModified("coordinates") && (this as any).coordinates?.lat != null && (this as any).coordinates?.lng != null) {
    (this as any).coordinates.geo = { type: "Point", coordinates: [(this as any).coordinates.lng, (this as any).coordinates.lat] };
  }
  next();
});

const Event = mongoose.model<IEvent>("Event", eventSchema);
export default Event;

// CommonJS interop for require() compatibility
// @ts-ignore
module.exports = Event;
// @ts-ignore
module.exports.default = Event;
