import apiClient from "./client";
import { toQueryString, type ListParams, type Pagination } from "./list";

export interface UserListParams extends ListParams {
  role?: string;
  // System admin (admin w/o org) passes organizationId to view another
  // tenant; org admins always see their own tenant.
  organizationId?: string;
  // "true" = active accounts only, "false" = deactivated only.
  status?: string;
}

export interface OrgUser {
  _id: string;
  name: string;
  email: string;
  role: "admin" | "org_admin" | "organizer" | "attendee";
  organization: string;
  // Live aggregates computed by the API for exactly this row (one aggregate
  // per page, not guessed from the list) — so the directory is accurate.
  active: boolean;
  emailVerifiedAt?: string | null;
  googleAccount: boolean;
  organizationName?: string | null;
  lastActiveAt?: string | null;
  activeSessions: number;
  ticketCount: number;
  hostedEventCount: number;
  createdAt: string;
}

export interface UserSessionInfo {
  _id: string;
  ip: string;
  userAgent: string;
  createdAt: string;
  lastUsedAt?: string | null;
  expiresAt: string;
  revokedAt?: string | null;
}

export interface UserDetail {
  _id: string;
  name: string;
  email: string;
  role: "admin" | "org_admin" | "organizer" | "attendee";
  active: boolean;
  emailVerifiedAt?: string | null;
  googleAccount: boolean;
  organization?: string | null;
  organizationName?: string | null;
  createdAt: string;
  activeSessions: number;
  lastActiveAt?: string | null;
  tickets: { total: number; active: number };
  hostedEventCount: number;
  savedCount: number;
  recentSessions: UserSessionInfo[];
}

export interface CreateUserPayload {
  name: string;
  email: string;
  password: string;
  role: "admin" | "org_admin" | "organizer" | "attendee";
  // The system admin (platform view) scopes the new account to a tenant.
  organizationId?: string;
}

export interface OrgStats {
  userCount: number;
  eventCount: number;
  roleCounts: { admin: number; org_admin: number; organizer: number; attendee: number };
  activeCount: number;
  deactivatedCount: number;
  newThisMonth: number;
}

export interface UsersResponse {
  users: OrgUser[];
  pagination: Pagination;
}

export interface UserStatusPayload {
  active: boolean;
}

export const usersApi = {
  list: async (params: UserListParams = {}): Promise<UsersResponse> => {
    const res = await apiClient.get(`/users${toQueryString(params)}`);
    return res.data;
  },

  stats: async (): Promise<OrgStats> => {
    const res = await apiClient.get("/users/stats");
    return res.data;
  },

  get: async (id: string): Promise<{ user: UserDetail }> => {
    const res = await apiClient.get(`/users/${id}`);
    return res.data;
  },

  sessions: async (id: string): Promise<{ sessions: UserSessionInfo[] }> => {
    const res = await apiClient.get(`/users/${id}/sessions`);
    return res.data;
  },

  updateRole: async (
    id: string,
    role: string
  ): Promise<{ user: OrgUser }> => {
    const res = await apiClient.put(`/users/${id}/role`, { role });
    return res.data;
  },

  // Deactivate (active=false — revokes every session, blocks login) or
  // reactivate an account. Returns { user, message } on success.
  updateStatus: async (
    id: string,
    active: boolean
  ): Promise<{ user: { _id: string; active: boolean }; message?: string }> => {
    const res = await apiClient.patch(`/users/${id}/status`, { active });
    return res.data;
  },

  revokeSessions: async (id: string): Promise<{ message: string }> => {
    const res = await apiClient.post(`/users/${id}/revoke-sessions`);
    return res.data;
  },

  resetPassword: async (id: string): Promise<{ message: string }> => {
    const res = await apiClient.post(`/users/${id}/reset-password`);
    return res.data;
  },

  remove: async (id: string): Promise<{ message: string }> => {
    const res = await apiClient.delete(`/users/${id}`);
    return res.data;
  },

  create: async (data: CreateUserPayload): Promise<{ user: OrgUser }> => {
    const res = await apiClient.post("/users", data);
    return res.data;
  },

  // Settings — any authenticated role can update their own profile.
  updateMyProfile: async (
    name: string
  ): Promise<{ user: import("./auth").User }> => {
    const res = await apiClient.patch("/users/me/profile", { name });
    return res.data;
  },

  updateMyPassword: async (payload: {
    currentPassword: string;
    newPassword: string;
  }): Promise<{ message: string }> => {
    const res = await apiClient.patch("/users/me/password", payload);
    return res.data;
  },

  updateReminderPreference: async (
    reminderEmail: boolean
  ): Promise<{ reminderEmail: boolean }> => {
    const res = await apiClient.patch("/users/me/reminders", { reminderEmail });
    return res.data;
  },

  updateMyInterests: async (interests: string[]): Promise<{ interests: string[] }> => {
    const res = await apiClient.patch("/users/me/interests", { interests });
    return res.data;
  },
};