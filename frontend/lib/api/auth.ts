import apiClient, { REFRESH_KEY, TOKEN_KEY } from "./client";

export interface User {
  _id: string;
  name: string;
  email: string;
  role: "admin" | "org_admin" | "organizer" | "attendee";
  organization?: string;
  location?: {
    lat: number;
    lng: number;
    city?: string;
    updatedAt?: string;
  };
  interests?: string[];
  // True for accounts created via Google sign-in — no password to change.
  googleAccount?: boolean;
  // True once the email address has been confirmed (report §7).
  emailVerified?: boolean;
  // Whether to receive email reminders for events.
  reminderEmail?: boolean;
}

export interface AuthResponse {
  user: User;
  token: string;
  refreshToken: string;
}

export interface SessionInfo {
  _id: string;
  ip: string;
  userAgent: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
}

export interface RegisterPayload {
  name: string;
  email: string;
  password: string;
  role?: string;
  // Admin sign-up creates a new tenant; organizer/attendee sign-up joins one.
  organizationName?: string;
  organizationId?: string;
  interests?: string[];
}

export interface LoginPayload {
  email: string;
  password: string;
}

// Persist the access/refresh pair issued by the server.
export const storeSession = (data: { token: string; refreshToken: string }) => {
  localStorage.setItem(TOKEN_KEY, data.token);
  localStorage.setItem(REFRESH_KEY, data.refreshToken);
};

export const authApi = {
  register: async (data: RegisterPayload): Promise<AuthResponse> => {
    const res = await apiClient.post("/auth/register", data);
    return res.data;
  },

  login: async (data: LoginPayload): Promise<AuthResponse> => {
    const res = await apiClient.post("/auth/login", data);
    return res.data;
  },

  // Exchange a Google ID-token credential for an app session.
  googleLogin: async (credential: string): Promise<AuthResponse> => {
    const res = await apiClient.post("/auth/google", { credential });
    return res.data;
  },

  getMe: async (): Promise<{ user: User }> => {
    const res = await apiClient.get("/auth/me");
    return res.data;
  },

  logout: async (): Promise<void> => {
    const refreshToken = localStorage.getItem(REFRESH_KEY);
    try {
      if (refreshToken) await apiClient.post("/auth/logout", { refreshToken });
    } finally {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(REFRESH_KEY);
    }
  },

  listSessions: async (): Promise<{ sessions: SessionInfo[] }> => {
    const res = await apiClient.get("/auth/sessions");
    return res.data;
  },

  revokeSession: async (id: string): Promise<void> => {
    await apiClient.delete(`/auth/sessions/${id}`);
  },

  // --- Email verification (report §7) ---------------------------------------
  verifyEmail: async (token: string): Promise<{ message: string }> => {
    const res = await apiClient.post(`/auth/verify-email/${token}`);
    return res.data;
  },

  resendVerification: async (): Promise<{ message: string }> => {
    const res = await apiClient.post("/auth/resend-verification");
    return res.data;
  },

  forgotPassword: async (email: string): Promise<{ message: string }> => {
    const res = await apiClient.post("/auth/forgot-password", { email });
    return res.data;
  },

  resetPassword: async (token: string, password: string): Promise<{ message: string }> => {
    const res = await apiClient.post("/auth/reset-password", { token, password });
    return res.data;
  },

  // --- GDPR ------------------------------------------------------------------
  exportMyData: async (): Promise<void> => {
    // Returns blob for download
    const res = await apiClient.get("/auth/me/export", { responseType: "blob" });
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute(
      "download",
      `eventnexus-data-export-${Date.now()}.json`
    );
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);
  },

  deleteMyAccount: async (): Promise<{ message: string }> => {
    const res = await apiClient.delete("/auth/me");
    return res.data;
  },
};
