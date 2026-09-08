import apiClient from "./client";
import { toQueryString, type ListParams, type Pagination } from "./list";

export interface SessionTrack {
  name: string;
  sessions: SessionData[];
}

export interface SessionData {
  _id: string;
  event: string;
  organization: string;
  title: string;
  description: string;
  track: string;
  startTime: string;
  endTime: string;
  location: string;
  speakers: SpeakerRef[];
  capacity: number;
  registered: number;
  isPublic: boolean;
  status: "scheduled" | "live" | "completed" | "cancelled";
  createdAt: string;
  updatedAt: string;
}

export interface SpeakerRef {
  _id: string;
  name: string;
  title: string;
  company: string;
  photoUrl: string;
}

export interface SpeakerData {
  _id: string;
  organization: string;
  name: string;
  email: string;
  title: string;
  company: string;
  bio: string;
  photoUrl: string;
  socialLinks: {
    linkedin: string;
    twitter: string;
    website: string;
  };
  isExternal: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreateSessionPayload {
  title: string;
  description?: string;
  track?: string;
  startTime: string;
  endTime: string;
  location?: string;
  speakers?: string[];
  capacity?: number;
  isPublic?: boolean;
}

export interface CreateSpeakerPayload {
  name: string;
  email?: string;
  title?: string;
  company?: string;
  bio?: string;
  photoUrl?: string;
  socialLinks?: {
    linkedin?: string;
    twitter?: string;
    website?: string;
  };
  isExternal?: boolean;
}

export interface SessionsResponse {
  sessions: SessionData[];
  byTrack: Record<string, SessionData[]>;
  canManage: boolean;
}

export const sessionsApi = {
  getByEvent: async (eventId: string): Promise<SessionsResponse> => {
    const res = await apiClient.get(`/events/${eventId}/sessions`);
    return res.data;
  },

  getById: async (id: string): Promise<{ session: SessionData; canManage: boolean }> => {
    const res = await apiClient.get(`/events/${id}/sessions/${id}`);
    return res.data;
  },

  create: async (eventId: string, data: CreateSessionPayload): Promise<{ session: SessionData }> => {
    const res = await apiClient.post(`/events/${eventId}/sessions`, data);
    return res.data;
  },

  update: async (eventId: string, id: string, data: Partial<CreateSessionPayload>): Promise<{ session: SessionData }> => {
    const res = await apiClient.put(`/events/${eventId}/sessions/${id}`, data);
    return res.data;
  },

  delete: async (eventId: string, id: string): Promise<{ message: string }> => {
    const res = await apiClient.delete(`/events/${eventId}/sessions/${id}`);
    return res.data;
  },
};

export const speakersApi = {
  list: async (): Promise<{ speakers: SpeakerData[] }> => {
    // Attendee without org gets 403 "User has no organization assigned" — expected, not an error.
    // Hide the global error toast; the query handles empty state silently.
    const res = await apiClient.get("/speakers", { hideErrorToast: true } as unknown as Record<string, unknown>);
    return res.data;
  },

  getById: async (id: string): Promise<{ speaker: SpeakerData }> => {
    const res = await apiClient.get(`/speakers/${id}`, { hideErrorToast: true } as unknown as Record<string, unknown>);
    return res.data;
  },

  create: async (data: CreateSpeakerPayload): Promise<{ speaker: SpeakerData }> => {
    const res = await apiClient.post("/speakers", data);
    return res.data;
  },

  update: async (id: string, data: Partial<CreateSpeakerPayload>): Promise<{ speaker: SpeakerData }> => {
    const res = await apiClient.put(`/speakers/${id}`, data);
    return res.data;
  },

  delete: async (id: string): Promise<{ message: string }> => {
    const res = await apiClient.delete(`/speakers/${id}`);
    return res.data;
  },
};