import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  authApi,
  storeSession,
  type AuthResponse,
  type LoginPayload,
  type RegisterPayload,
} from "../api/auth";
import { clearSession } from "../api/client";
import { captureAndSaveLocation } from "../api/location";
import { useHasToken } from "../hooks/use-has-token";
import { resetChatbotForUserChange } from "../stores/chatbot-store";
import { getErrorMessage } from "../errors";

export const authKeys = {
  me: ["auth", "me"] as const,
};

export const roleRoutes: Record<string, string> = {
  admin: "/admin",
  org_admin: "/admin",
  organizer: "/organizer",
  attendee: "/dashboard",
};

export function useCurrentUser() {
  return useQuery({
    queryKey: authKeys.me,
    queryFn: authApi.getMe,
    retry: false,
    enabled: useHasToken(),
  });
}

// Shared success handler: persist the session and route by role.
//
// `redirectTo` is the one exception to "route by role" — set when the visitor
// arrived via the public event QR/link flow (see PublicEventLanding) and
// clicked Join while signed out. Without it they'd land on their role's
// generic dashboard after authenticating and have to find the event again;
// with it, they land straight back on the event they scanned, now able to
// register. Already validated to a same-origin `/event/<id>` path by
// sanitizeEventRedirect before it ever reaches here — see lib/event-redirect.
function useAuthSuccess(redirectTo?: string | null) {
  const queryClient = useQueryClient();
  const router = useRouter();

  return (data: AuthResponse) => {
    storeSession(data);
    localStorage.setItem("user", JSON.stringify(data.user));
    queryClient.setQueryData(authKeys.me, { user: data.user });
    resetChatbotForUserChange();
    toast.success(`Welcome back, ${data.user.name}!`);
    router.push(redirectTo || roleRoutes[data.user.role] || "/dashboard");
  };
}

export function useLogin(redirectTo?: string | null) {
  const onSuccess = useAuthSuccess(redirectTo);
  return useMutation({
    mutationFn: (data: LoginPayload) => authApi.login(data),
    onSuccess,
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Login failed. Please check your credentials.")),
  });
}

export function useRegister(redirectTo?: string | null) {
  const onSuccess = useAuthSuccess(redirectTo);
  return useMutation({
    mutationFn: (data: RegisterPayload) => authApi.register(data),
    onSuccess: (data: AuthResponse) => {
      // org-admin pending flow returns message without token — do not store session
      if ((data as unknown as { message?: string })?.message?.includes("pending") && !(data as unknown as { token?: string })?.token) {
        toast.success("Application submitted! Check your email for verification.");
        return;
      }
      onSuccess(data);
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Registration failed.")),
  });
}

export function useGoogleLogin(redirectTo?: string | null) {
  const onSuccess = useAuthSuccess(redirectTo);
  return useMutation({
    mutationFn: (credential: string) => authApi.googleLogin(credential),
    onSuccess,
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Google login failed.")),
  });
}

export function useLogout() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return () => {
    authApi
      .logout()
      .catch(() => {})
      .finally(() => {
        clearSession();
        resetChatbotForUserChange();
        queryClient.clear();
        toast.success("Logged out successfully.");
        router.push("/login");
      });
  };
}

// --- Email verification + password reset (report §7) ------------------------
export function useVerifyEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (token: string) => authApi.verifyEmail(token),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: authKeys.me });
      toast.success("Email verified! You can now use all features.");
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Verification failed. Link may be expired.")),
  });
}

export function useResendVerification() {
  return useMutation({
    mutationFn: () => authApi.resendVerification(),
    onSuccess: () => toast.success("Verification email sent. Check your inbox."),
    onError: (error: unknown) => toast.error(getErrorMessage(error)),
  });
}

export function useForgotPassword() {
  return useMutation({
    mutationFn: (email: string) => authApi.forgotPassword(email),
    onSuccess: () => toast.success("If an account exists, a reset link has been sent."),
    onError: (error: unknown) => toast.error(getErrorMessage(error)),
  });
}

export function useResetPassword() {
  return useMutation({
    mutationFn: ({ token, password }: { token: string; password: string }) =>
      authApi.resetPassword(token, password),
    onSuccess: () => toast.success("Password reset! Please log in with your new password."),
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Reset failed. Link may be expired.")),
  });
}

// --- Active sessions management ---------------------------------------------
export function useSessions() {
  return useQuery({
    queryKey: ["auth", "sessions"],
    queryFn: authApi.listSessions,
    retry: false,
    enabled: useHasToken(),
  });
}

export function useRevokeSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => authApi.revokeSession(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["auth", "sessions"] });
      toast.success("Session revoked.");
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error)),
  });
}

// --- GDPR: Data export & Account deletion ------------------------------------
export function useExportMyData() {
  return useMutation({
    mutationFn: () => authApi.exportMyData(),
    onSuccess: () => toast.success("Data export started. Your download will begin shortly."),
    onError: (error: unknown) => toast.error(getErrorMessage(error)),
  });
}

export function useDeleteMyAccount() {
  const queryClient = useQueryClient();
  const router = useRouter();
  return useMutation({
    mutationFn: () => authApi.deleteMyAccount(),
    onSuccess: () => {
      clearSession();
      resetChatbotForUserChange();
      queryClient.clear();
      toast.success("Account deleted. We're sorry to see you go.");
      router.push("/login");
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error)),
  });
}
