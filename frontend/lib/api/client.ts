import axios from "axios";

const apiClient = axios.create({
  baseURL: process.env.NEXT_PUBLIC_API_URL || "http://localhost:5000/api",
  headers: { "Content-Type": "application/json" },
});

// Local-storage keys for the access/refresh pair. The access token rides in
// the Authorization header; the refresh token is only sent to /auth/refresh.
export const TOKEN_KEY = "token";
export const REFRESH_KEY = "refreshToken";
export const USER_KEY = "user";

let refreshPromise: Promise<string | null> | null = null;

const getAccessToken = () =>
  typeof window !== "undefined" ? localStorage.getItem(TOKEN_KEY) : null;
const getRefreshToken = () =>
  typeof window !== "undefined" ? localStorage.getItem(REFRESH_KEY) : null;

// Single-flight refresh: concurrent 401s share one POST /auth/refresh call,
// and the new access token is re-issued to every waiting request.
const refreshAccessToken = async (): Promise<string | null> => {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return null;
  if (!refreshPromise) {
    refreshPromise = axios
      .post(`${apiClient.defaults.baseURL}/auth/refresh`, { refreshToken })
      .then((res) => {
        const { token, refreshToken: nextRefresh } = res.data;
        if (typeof window !== "undefined") {
          localStorage.setItem(TOKEN_KEY, token);
          if (nextRefresh) localStorage.setItem(REFRESH_KEY, nextRefresh);
        }
        return token as string;
      })
      .catch(() => {
        clearSession();
        return null;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
};

export const clearSession = () => {
  if (typeof window === "undefined") return;
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(REFRESH_KEY);
  localStorage.removeItem(USER_KEY);
};

// Keep every tab of the browser on the same account. localStorage is shared
// per origin, so when another tab logs in as a different account (or logs
// out), the session keys change out from under this tab — whose React Query
// cache still holds the previous account, letting the same browser show two
// accounts "logged in" at once. Reload so the whole browser reflects one
// account: the tab logged in under the previous account lands back on the
// login page (its server session is revoked by the backend's one-session-
// per-device policy on login).
//
// Token *rotation* (silent refresh) rewrites TOKEN_KEY/REFRESH_KEY without
// touching USER_KEY, so it never triggers a reload here — only a real
// account switch (USER_KEY replaced) or a logout (TOKEN_KEY removed) does.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === USER_KEY || (e.key === TOKEN_KEY && !e.newValue)) {
      window.location.reload();
    }
  });
}

apiClient.interceptors.request.use((config) => {
  const token = getAccessToken();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

let redirectingToLogin = false;
// Reset guard when navigating away from login (avoids swallow after first 401)
if (typeof window !== "undefined") {
  window.addEventListener("popstate", () => { redirectingToLogin = false; });
}

// Endpoints where a 401 means "these credentials are wrong", NOT "your
// session expired".
//
// Without this distinction the interceptor treated a failed sign-in exactly
// like an expired session: a wrong password returns 401, the interceptor
// tried to refresh (which cannot succeed — you are not logged in yet, so
// there is no valid refresh token), and then ran
// `window.location.href = "/login"`. That is a HARD navigation, so the whole
// page reloaded: the "Invalid email or password" message the form had just
// rendered was wiped, along with the email the user had typed. It looked
// like the page randomly refreshed instead of reporting the error.
//
// These responses must flow back to the caller untouched so the form can
// display them.
const AUTH_ENDPOINTS = [
  "/auth/login",
  "/auth/register",
  "/auth/org-register",
  "/auth/google",
  "/auth/refresh",
  "/auth/forgot-password",
  "/auth/reset-password",
  "/auth/verify-email",
];

const isAuthEndpoint = (url?: string) => {
  if (!url) return false;
  // Compare on the path only — `url` may be absolute or relative depending
  // on how the request was made.
  const path = url.startsWith("http") ? new URL(url).pathname : url;
  return AUTH_ENDPOINTS.some((endpoint) => path.includes(endpoint));
};

apiClient.interceptors.response.use(
  (response) => response,
  async (error) => {
    const { config, response } = error;
    // Global clear toast for operational errors (4xx/5xx) except 401 handled below and validation 400 which caller handles inline
    if (response && response.status >= 400 && response.status !== 401) {
      // Let caller handle 400 validation inline if they want to hide toast
      const hideToast = (config as unknown as { hideErrorToast?: boolean })?.hideErrorToast;
      const url: string = config?.url || "";
      const rawMsg: string = response.data?.message || response.data?.error || "";
      // 403 "User has no organization assigned" is expected for attendee without org
      // on org-scoped lists (speakers, org members, etc.). The UI handles empty
      // data gracefully, so suppress the global toast to avoid duplicate red toasts.
      const SILENT_403_MESSAGES = ["User has no organization assigned", "No organization context"];
      const SILENT_403_ENDPOINTS = ["/speakers", "/organizations/me", "/organizations/members", "/collaboration/invitations"];
      const isSilentOrg403 =
        !hideToast &&
        response.status === 403 &&
        (SILENT_403_MESSAGES.includes(rawMsg) || SILENT_403_ENDPOINTS.some((p) => url.includes(p)));
      if (!hideToast && !isSilentOrg403 && typeof window !== "undefined") {
        // Lazy import to avoid SSR issues
        import("sonner").then(({ toast }) => {
          const msg = rawMsg || (response.status === 403 ? "You don't have permission to do that." : response.status === 404 ? "Not found." : response.status === 409 ? "Already exists." : response.status >= 500 ? "Something went wrong on our side. Please try again." : "Request failed.");
          // Avoid duplicate toast for auth endpoints that show inline message
          const isInlineHandled = ["/auth/login", "/auth/register", "/auth/org-register", "/auth/google"].some((p) => url.includes(p));
          if (!isInlineHandled) toast.error(msg);
        });
      }
    }
    if (!response || response.status !== 401 || !config || config._retried) {
      return Promise.reject(error);
    }
    // A rejected credential is the caller's to handle and display.
    if (isAuthEndpoint(config.url)) {
      return Promise.reject(error);
    }
    if (typeof window === "undefined") {
      return Promise.reject(error);
    }

    // Try to mint a fresh access token from the refresh token. If that works,
    // replay the original request once with the new token. Only when the
    // refresh itself fails do we treat the session as dead and redirect.
    config._retried = true;
    const newToken = await refreshAccessToken();
    if (newToken) {
      config.headers.Authorization = `Bearer ${newToken}`;
      return apiClient(config);
    }
    if (!redirectingToLogin) {
      redirectingToLogin = true;
      import("sonner").then(({ toast }) => toast.error("Session expired. Please log in again."));
      window.location.href = "/login";
    }
    return Promise.reject(error);
  }
);

export default apiClient;
