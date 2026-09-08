import { toast } from "sonner";
import { getErrorMessage } from "../errors";
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { usersApi, type CreateUserPayload, type UserListParams } from "../api/users";
import { auditApi } from "../api/audit";
import { useHasToken } from "../hooks/use-has-token";

export const userKeys = {
  list: ["users", "list"] as const,
  listParams: (params: UserListParams) => ["users", "list", params] as const,
  stats: ["users", "stats"] as const,
  detail: (id: string) => ["users", "detail", id] as const,
  sessions: (id: string) => ["users", "sessions", id] as const,
  audit: (id: string) => ["users", "audit", id] as const,
};

export function useOrgUsers(params: UserListParams = {}) {
  return useQuery({
    queryKey: userKeys.listParams(params),
    queryFn: () => usersApi.list(params),
    enabled: useHasToken(),
    placeholderData: keepPreviousData,
  });
}

export function useOrgStats() {
  return useQuery({ queryKey: userKeys.stats, queryFn: usersApi.stats, enabled: useHasToken() });
}

export function useUser(id: string | null) {
  return useQuery({
    queryKey: userKeys.detail(id ?? ""),
    queryFn: () => usersApi.get(id as string),
    enabled: useHasToken() && !!id,
  });
}

export function useUserSessions(id: string | null) {
  return useQuery({
    queryKey: userKeys.sessions(id ?? ""),
    queryFn: () => usersApi.sessions(id as string),
    enabled: useHasToken() && !!id,
  });
}

// Per-user audit trail shown in the detail dialog ("reflection": every
// action this account has caused is visible right where it was managed).
export function useUserAudit(id: string | null) {
  return useQuery({
    queryKey: userKeys.audit(id ?? ""),
    queryFn: () => auditApi.forUser(id as string),
    enabled: useHasToken() && !!id,
  });
}

// Every mutation bumps the whole ["users"] cache tree — list, stats, the
// open detail, sessions and trail — so a change made anywhere is reflected
// everywhere immediately (the key factories above all share the prefix).
const invalidateUserState = (queryClient: ReturnType<typeof useQueryClient>) => {
  queryClient.invalidateQueries({ queryKey: ["users"] });
};

export function useUpdateUserRole() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) =>
      usersApi.updateRole(id, role),
    onSuccess: () => {
      invalidateUserState(queryClient);
      toast.success("Role updated successfully.");
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Failed to update role.")),
  });
}

export function useUpdateUserStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      usersApi.updateStatus(id, active),
    onSuccess: (_, vars) => {
      invalidateUserState(queryClient);
      toast.success(vars.active ? "User activated." : "User deactivated.");
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Failed to update status.")),
  });
}

export function useRevokeUserSessions() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => usersApi.revokeSessions(id),
    onSuccess: () => {
      invalidateUserState(queryClient);
      toast.success("All sessions revoked.");
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error)),
  });
}

export function useAdminResetPassword() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => usersApi.resetPassword(id),
    onSuccess: () => {
      invalidateUserState(queryClient);
      toast.success("Password reset email sent.");
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error)),
  });
}

export function useRemoveUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => usersApi.remove(id),
    onSuccess: () => {
      invalidateUserState(queryClient);
      toast.success("User removed.");
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Failed to remove user.")),
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateUserPayload) => usersApi.create(data),
    onSuccess: () => {
      invalidateUserState(queryClient);
      toast.success("User created successfully.");
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Failed to create user.")),
  });
}

// Settings mutations: after a profile/password update the cached /auth/me
// user and the localStorage copy both need refreshing so the sidebar name
// and the "googleAccount" flag stay current.
export function useUpdateMyProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => usersApi.updateMyProfile(name),
    onSuccess: (data) => {
      queryClient.setQueryData(["auth", "me"], data);
      const stored = localStorage.getItem("user");
      if (stored) {
        localStorage.setItem(
          "user",
          JSON.stringify({ ...JSON.parse(stored), name: data.user.name })
        );
      }
      toast.success("Profile updated.");
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Failed to update profile.")),
  });
}

export function useUpdateMyPassword() {
  return useMutation({
    mutationFn: (payload: { currentPassword: string; newPassword: string }) =>
      usersApi.updateMyPassword(payload),
    onSuccess: () => toast.success("Password updated. Please log in again if required."),
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Failed to update password.")),
  });
}

export function useUpdateReminderPreference() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (reminderEmail: boolean) => usersApi.updateReminderPreference(reminderEmail),
    onSuccess: (data) => {
      queryClient.setQueryData(["auth", "me"], (old: any) =>
        old ? { ...old, user: { ...old.user, reminderEmail: data.reminderEmail } } : old
      );
      const stored = localStorage.getItem("user");
      if (stored) {
        localStorage.setItem(
          "user",
          JSON.stringify({ ...JSON.parse(stored), reminderEmail: data.reminderEmail })
        );
      }
      toast.success(data.reminderEmail ? "Email reminders enabled." : "Email reminders disabled.");
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error)),
  });
}

export function useUpdateMyInterests() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (interests: string[]) => usersApi.updateMyInterests(interests),
    onSuccess: (data) => {
      queryClient.setQueryData(["auth", "me"], (old: any) =>
        old ? { ...old, user: { ...old.user, interests: data.interests } } : old
      );
      const stored = localStorage.getItem("user");
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          localStorage.setItem("user", JSON.stringify({ ...parsed, interests: data.interests }));
        } catch {}
      }
      queryClient.invalidateQueries({ queryKey: ["recommendations"] });
      toast.success("Interests updated — recommendations refreshed.");
    },
    onError: (error: unknown) => toast.error(getErrorMessage(error, "Failed to update interests.")),
  });
}