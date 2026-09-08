import { useEffect } from "react";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  notificationsApi,
  type Notification,
  type NotificationListParams,
  type RealtimeNotificationPush,
} from "../api/notifications";
import { useHasToken } from "../hooks/use-has-token";
import { disconnectSocket, getSocket, getSocketAsync } from "../socket";

export const notificationKeys = {
  list: ["notifications", "list"] as const,
  listParams: (params: NotificationListParams) => ["notifications", "list", params] as const,
  detail: (id: string) => ["notifications", "detail", id] as const,
  unreadCount: ["notifications", "unread"] as const,
};

export function useNotifications(params: NotificationListParams = {}, options: { enabled?: boolean } = {}) {
  const hasToken = useHasToken();
  const enabled = options.enabled !== undefined ? options.enabled && hasToken : hasToken;
  return useQuery({
    queryKey: notificationKeys.listParams(params),
    queryFn: () => notificationsApi.list(params),
    enabled,
    placeholderData: keepPreviousData,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
}

// Live unread badge count. Refreshed by the Socket.IO channel (see
// useRealtimeNotifications); the interval is only a fallback for when the
// socket is down or the browser never established a connection.
export function useUnreadCount() {
  return useQuery({
    queryKey: notificationKeys.unreadCount,
    queryFn: notificationsApi.unreadCount,
    enabled: useHasToken(),
    refetchInterval: 60_000,
    select: (data) => data.count,
  });
}

export function useNotification(id: string | undefined) {
  return useQuery({
    queryKey: notificationKeys.detail(id ?? ""),
    queryFn: () => notificationsApi.get(id!),
    enabled: useHasToken() && !!id,
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => notificationsApi.markRead(id),
    onSuccess: ({ notification }) => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.list });
      queryClient.setQueryData(notificationKeys.detail(notification._id), { notification });
      queryClient.invalidateQueries({ queryKey: notificationKeys.unreadCount });
      toast.success("Marked as read.");
    },
    onError: (error: unknown) => {
      const msg = (error as { response?: { data?: { message?: string } } })?.response?.data?.message || "Failed to mark as read.";
      toast.error(msg);
    },
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: notificationKeys.list });
      queryClient.setQueryData(notificationKeys.unreadCount, { count: 0 });
      toast.success("All notifications marked as read.");
    },
    onError: (error: unknown) => {
      const msg = (error as { response?: { data?: { message?: string } } })?.response?.data?.message || "Failed to mark all as read.";
      toast.error(msg);
    },
  });
}

// Role → notifications section base path for deep links and detail pages.
export function notificationsSectionForRole(role?: string | null): string {
  if (role === "admin" || role === "org_admin") return "/admin/notifications";
  if (role === "organizer") return "/organizer/notifications";
  return "/notifications";
}

/**
 * Pulls the Socket.IO channel and keeps every notification query in sync:
 *
 *  - "notification:created"  → toast + invalidate list + refresh unread badge
 *  - "notification:read"     → flip the cached doc / list entry, badge update
 *  - "notifications:read-all" → clear badge, invalidate list
 *  - "unread:count"          → set the badge directly (no round trip needed)
 *
 * Mounted once in the root layout (see app/layout.tsx) so the whole app —
 * including public pages — receives pushes for the signed-in user. No-op
 * when there's no session token.
 */
export function useRealtimeNotifications() {
  const hasToken = useHasToken();
  const queryClient = useQueryClient();

  useEffect(() => {
    if (!hasToken) {
      disconnectSocket();
      return;
    }

    const onCreated = ({ notification, unread }: RealtimeNotificationPush) => {
      if (typeof unread === "number") {
        queryClient.setQueryData(notificationKeys.unreadCount, { count: unread });
      } else {
        queryClient.setQueryData(notificationKeys.unreadCount, (old: { count: number } | undefined) => ({ count: (old?.count ?? 0) + 1 }));
      }
      queryClient.invalidateQueries({ queryKey: notificationKeys.list, refetchType: "active" });
      const section = notificationsSectionForRole(
        (typeof window !== "undefined" && JSON.parse(localStorage.getItem("user") || "{}")?.role) || null
      );
      toast(notification.title, {
        description: notification.message,
        action: {
          label: "View",
          onClick: () => {
            window.location.href = `${section}/${notification._id}`;
          },
        },
      });
    };

    const onRead = ({ id, unread }: { id: string; unread: number }) => {
      queryClient.setQueryData(notificationKeys.unreadCount, { count: unread });
      queryClient.setQueryData<{ notification: Notification }>(notificationKeys.detail(id), (old) =>
        old ? { notification: { ...old.notification, read: true } } : old
      );
      queryClient.setQueriesData<{ notifications: Notification[] }>(
        { queryKey: notificationKeys.list, exact: false },
        (old) =>
          old
            ? { ...old, notifications: old.notifications.map((n) => (n._id === id ? { ...n, read: true } : n)) }
            : old
      );
    };

    const onReadAll = ({ unread }: { unread: number }) => {
      queryClient.setQueryData(notificationKeys.unreadCount, { count: unread });
      queryClient.setQueriesData<{ notifications: Notification[] }>(
        { queryKey: notificationKeys.list, exact: false },
        (old) =>
          old
            ? { ...old, notifications: old.notifications.map((n) => ({ ...n, read: true })) }
            : old
      );
    };

    const onUnread = ({ count }: { count: number }) => {
      queryClient.setQueryData(notificationKeys.unreadCount, { count });
    };

    let activeSocket: ReturnType<typeof getSocket> = null;
    let cancelled = false;

    const attach = (socket: NonNullable<ReturnType<typeof getSocket>>) => {
      if (cancelled) return;
      activeSocket = socket;
      socket.on("notification:created", onCreated);
      socket.on("notification:read", onRead);
      socket.on("notifications:read-all", onReadAll);
      socket.on("unread:count", onUnread);
    };

    const detach = () => {
      if (activeSocket) {
        activeSocket.off("notification:created", onCreated);
        activeSocket.off("notification:read", onRead);
        activeSocket.off("notifications:read-all", onReadAll);
        activeSocket.off("unread:count", onUnread);
      }
    };

    const syncSocket = getSocket();
    if (syncSocket) {
      attach(syncSocket);
    } else {
      void getSocketAsync().then((s) => {
        if (s && !cancelled) attach(s);
      });
    }

    const onReady = () => {
      const s = getSocket();
      if (s && !cancelled && s !== activeSocket) attach(s);
    };
    window.addEventListener("socket:ready", onReady);

    return () => {
      cancelled = true;
      window.removeEventListener("socket:ready", onReady);
      detach();
    };
  }, [hasToken, queryClient]);
}