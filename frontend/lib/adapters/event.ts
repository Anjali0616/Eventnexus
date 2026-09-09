import type { EventData } from "@/lib/api/events";
import { formatPrice } from "@/lib/price";

export type EventStatus = "Upcoming" | "Live" | "Past";

export interface AppEvent {
  id: string;
  title: string;
  org: string;
  date: string;
  type: "In-person" | "Hybrid" | "Virtual";
  venue: string;
  registered: number;
  capacity: number;
  predicted: number;
  status: EventStatus;
  category: string;
  matchScore?: number;
  price: string;
  gradient: string;
  /** Uploaded banner (base64 data URL) — same field the detail pages use. */
  imageUrl?: string;
}

const GRADIENTS = [
  "linear-gradient(135deg,#5b4cf5,#00c9a7)",
  "linear-gradient(135deg,#ff6b35,#5b4cf5)",
  "linear-gradient(135deg,#00c9a7,#5b4cf5)",
  "linear-gradient(135deg,#5b4cf5,#ff6b35)",
];

const pickGradient = (id: string) => {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return GRADIENTS[Math.abs(h) % GRADIENTS.length];
};

const orgName = (event: EventData): string => {
  const o = event.organizer as { name?: string } | string;
  return typeof o === "object" && o?.name ? o.name : "Organizer";
};

export function toAppEvent(event: EventData): AppEvent {
  return {
    id: event._id,
    title: event.title,
    org: orgName(event),
    date: new Date(event.date).toLocaleString("en-US", {
      dateStyle: "medium",
      timeStyle: "short",
    }),
    type: event.type,
    venue: event.venue,
    registered: event.registered,
    capacity: event.capacity,
    predicted: event.registered,
    status: (event.status === "Draft" ? "Upcoming" : event.status) as EventStatus,
    category: event.category,
    price: formatPrice(event.price),
    gradient: pickGradient(event._id),
    imageUrl: event.imageUrl || undefined,
  };
}
