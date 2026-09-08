"use client"

import { useState } from "react"
import Link from "next/link"
import { Bell, CalendarCheck2, ChevronRight, Info, Loader2, MapPin, Network, Sparkles, UserCheck } from "lucide-react"
import { Reveal } from "@/components/anim/reveal"
import { useMarkAllNotificationsRead, useMarkNotificationRead, useNotifications, useUnreadCount } from "@/lib/queries/notifications"
import type { Notification } from "@/lib/api/notifications"
import { SearchInput, FilterSelect } from "@/components/app/search-input"
import { Pagination } from "@/components/app/pagination"
import { useDebounce } from "@/lib/hooks/use-debounce"

const iconForType: Record<string, typeof Bell> = {
  registration: CalendarCheck2,
  reminder: Bell,
  "event-update": Info,
  system: Sparkles,
  "nearby-event": MapPin,
  "new-event": Sparkles,
  "event_published": Sparkles,
  "check-in": UserCheck,
  collaboration: Network,
}

const toneForType: Record<string, string> = {
  registration: "text-primary bg-primary/12",
  reminder: "text-flame bg-flame/12",
  "event-update": "text-secondary bg-secondary/15",
  system: "text-primary bg-primary/12",
  "nearby-event": "text-flame bg-flame/12",
  "new-event": "text-primary bg-primary/12",
  "event_published": "text-primary bg-primary/12",
  "check-in": "text-secondary bg-secondary/15",
  collaboration: "text-primary bg-primary/12",
}

const typeFilterOptions = [
  { label: "All types", value: "all" },
  { label: "Registrations", value: "registration" },
  { label: "Reminders", value: "reminder" },
  { label: "Event updates", value: "event-update" },
  { label: "New events", value: "new-event" },
  { label: "Check-ins", value: "check-in" },
  { label: "System", value: "system" },
  { label: "Nearby events", value: "nearby-event" },
  { label: "Collaboration", value: "collaboration" },
]

const readFilterOptions = [
  { label: "All", value: "all" },
  { label: "Unread", value: "false" },
  { label: "Read", value: "true" },
]

export function NotificationList({ basePath }: { basePath: string }) {
  const [search, setSearch] = useState("")
  const [type, setType] = useState("all")
  const [read, setRead] = useState("all")
  const [page, setPage] = useState(1)
  const debouncedSearch = useDebounce(search, 400)

  const { data, isLoading } = useNotifications({
    search: debouncedSearch,
    type,
    read,
    page,
    limit: 12,
  })
  const markRead = useMarkNotificationRead()
  const markAllRead = useMarkAllNotificationsRead()
  const { data: globalUnread = 0 } = useUnreadCount()
  const notifications = data?.notifications ?? []
  const pagination = data?.pagination
  const unreadCount = (globalUnread as number) || notifications.filter((n) => !n.read).length

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SearchInput
          value={search}
          onChange={(v) => {
            setSearch(v)
            setPage(1)
          }}
          placeholder="Search notifications..."
          className="flex-1"
        />
        <div className="flex flex-wrap gap-3">
          <FilterSelect
            value={type}
            onChange={(v) => {
              setType(v)
              setPage(1)
            }}
            options={typeFilterOptions}
          />
          <FilterSelect
            value={read}
            onChange={(v) => {
              setRead(v)
              setPage(1)
            }}
            options={readFilterOptions}
          />
        </div>
      </div>

      {unreadCount > 0 && (
        <div className="flex justify-end">
          <button
            onClick={() => markAllRead.mutate()}
            className="text-sm font-medium text-primary hover:underline"
          >
            Mark all {unreadCount} as read
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading notifications...
        </div>
      ) : (
        <Reveal stagger={0.08} y={24} className="grid gap-5 lg:grid-cols-3">
          {notifications.map((notice) => {
            const Icon = (iconForType[notice.type] as typeof Bell) || Bell
            return (
              <Link
                key={notice._id}
                href={`${basePath}/${notice._id}`}
                onClick={() => {
                  if (!notice.read) markRead.mutate(notice._id)
                }}
                className={`group relative text-left rounded-2xl border p-6 shadow-[0_2px_24px_rgba(0,0,0,0.04)] transition-colors ${
                  notice.read ? "border-border bg-card" : "border-primary/30 bg-primary/[0.03]"
                }`}
              >
                {!notice.read && (
                  <span className="absolute right-5 top-5 size-2 rounded-full bg-flame" aria-hidden="true" />
                )}
                <span className={`flex size-10 items-center justify-center rounded-xl ${toneForType[notice.type]}`}>
                  <Icon className="size-5" />
                </span>
                <h2 className="font-display mt-4 text-base font-semibold text-ink transition-colors group-hover:text-primary">
                  {notice.title}
                </h2>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{notice.message}</p>
                <p className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
                  <span>{new Date(notice.createdAt).toLocaleString()}</span>
                  <span className="inline-flex items-center gap-0.5 font-medium text-primary">
                    View details <ChevronRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </p>
              </Link>
            )
          })}
        </Reveal>
      )}

      {!isLoading && notifications.length === 0 && (
        <div className="rounded-2xl border border-dashed border-border bg-card py-16 text-center">
          <p className="text-sm text-muted-foreground">
            {debouncedSearch || type !== "all" || read !== "all"
              ? "No notifications match your search or filters."
              : "No notifications yet. You'll see live updates here as they happen."}
          </p>
        </div>
      )}

      {pagination && pagination.totalPages > 1 && (
        <Pagination pagination={pagination} onPageChange={setPage} />
      )}
    </div>
  )
}