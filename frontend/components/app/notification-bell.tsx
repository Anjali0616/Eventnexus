"use client"

import { useState } from "react"
import Link from "next/link"
import { Bell, CheckCheck, ChevronRight, Loader2 } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
  useUnreadCount,
} from "@/lib/queries/notifications"
import type { Notification } from "@/lib/api/notifications"
import { cn } from "@/lib/utils"

function sectionForRole(role: "Administrator" | "Organizer" | "Attendee"): string {
  if (role === "Administrator") return "/admin/notifications"
  if (role === "Organizer") return "/organizer/notifications"
  return "/notifications"
}

function timeAgo(date: string): string {
  const d = new Date(date)
  if (isNaN(d.getTime())) return ""
  let seconds = Math.floor((Date.now() - d.getTime()) / 1000)
  if (seconds < 0) seconds = 0
  if (seconds < 60) return "Just now"
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return days === 1 ? "Yesterday" : `${days}d ago`
  const weeks = Math.floor(days / 7)
  if (weeks < 5) return `${weeks}w ago`
  return d.toLocaleDateString()
}

export function NotificationBell({ role }: { role: "Administrator" | "Organizer" | "Attendee" }) {
  const [open, setOpen] = useState(false)
  const { data: unreadCount = 0 } = useUnreadCount()
  const { data, isLoading, isFetching } = useNotifications({ limit: 6 }, { enabled: open })
  const markAllRead = useMarkAllNotificationsRead()
  const markRead = useMarkNotificationRead()
  const notifications = data?.notifications ?? []
  const section = sectionForRole(role)

  const displayCount = unreadCount as number
  const badgeText = displayCount > 99 ? "99+" : String(displayCount)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="relative flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground transition-colors hover:text-ink"
          aria-label={`Notifications${displayCount > 0 ? ` (${badgeText} unread)` : ""}`}
          aria-live="polite"
        >
          <Bell className="size-[18px]" />
          {displayCount > 0 && (
            <span className="absolute right-1.5 top-1.5 flex size-4 items-center justify-center rounded-full bg-primary text-[9px] font-bold text-white shadow-sm ring-1 ring-white">
              {badgeText}
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-[calc(100vw-2rem)] p-0 sm:w-80">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <p className="text-sm font-semibold text-ink">Notifications</p>
          {displayCount > 0 && (
            <button
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
              className="flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:underline disabled:opacity-50"
            >
              {markAllRead.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCheck className="size-3.5" />} Mark all read
            </button>
          )}
        </div>

        <div className="max-h-80 overflow-y-auto">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
              <Loader2 className="size-4 animate-spin" /> Loading...
            </div>
          ) : notifications.length === 0 ? (
            <p className="px-4 py-8 text-center text-xs text-muted-foreground">
              No notifications yet. New event alerts will appear here.
            </p>
          ) : (
            notifications.map((notice) => (
              <Link
                key={notice._id}
                href={`${section}/${notice._id}`}
                onClick={() => {
                  setOpen(false)
                  if (!notice.read) markRead.mutate(notice._id)
                }}
                className={cn(
                  "flex w-full items-start gap-3 border-b border-border/60 px-4 py-3 text-left transition-colors last:border-0 hover:bg-muted/50",
                  !notice.read && "bg-primary/[0.04]"
                )}
              >
                <span
                  className={cn(
                    "mt-1.5 size-2 shrink-0 rounded-full",
                    notice.read ? "bg-border" : "bg-primary"
                  )}
                  aria-hidden="true"
                />
                <span className="min-w-0 flex-1">
                  <span className={cn("block truncate text-sm", notice.read ? "font-medium text-ink" : "font-semibold text-ink")}>{notice.title}</span>
                  <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-muted-foreground">
                    {notice.message}
                  </span>
                  <span className="mt-1 block text-[10px] uppercase tracking-wide text-muted-foreground/80">
                    {timeAgo(notice.createdAt)}
                  </span>
                </span>
                <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground/60" />
              </Link>
            ))
          )}
          {isFetching && !isLoading && (
            <div className="flex items-center justify-center py-2 text-[10px] text-muted-foreground/60">Updating…</div>
          )}
        </div>

        <Link
          href={section}
          onClick={() => setOpen(false)}
          className="flex w-full items-center justify-center gap-1 border-t border-border px-4 py-2.5 text-xs font-semibold text-primary transition-colors hover:bg-muted/50"
        >
          View all notifications
        </Link>
      </PopoverContent>
    </Popover>
  )
}
