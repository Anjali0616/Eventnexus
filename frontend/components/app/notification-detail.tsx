"use client"

import { useEffect } from "react"
import Link from "next/link"
import { useParams } from "next/navigation"
import {
  Network,
  ArrowLeft,
  Bell,
  CalendarCheck2,
  CalendarDays,
  Check,
  ExternalLink,
  Info,
  Loader2,
  MapPin,
  Sparkles,
  UserCheck,
} from "lucide-react"
import { Reveal } from "@/components/anim/reveal"
import { useMarkNotificationRead, useNotification } from "@/lib/queries/notifications"
import type { Notification as NotificationType } from "@/lib/api/notifications"

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

const labelForType: Record<string, string> = {
  registration: "Registration",
  reminder: "Reminder",
  "event-update": "Event update",
  system: "System",
  "nearby-event": "Nearby event",
  "new-event": "New event",
  "event_published": "New event",
  "check-in": "Check-in",
  collaboration: "Collaboration",
}

export function NotificationDetail({ basePath }: { basePath: string }) {
  const params = useParams<{ id: string }>()
  const id = params?.id
  const { data, isLoading, isError } = useNotification(id)
  const markRead = useMarkNotificationRead()
  const notice = data?.notification

  // Opening a notification marks it read — the socket channel pushes the
  // updated state to any other open tab of the same user.
  useEffect(() => {
    if (notice && !notice.read) {
      markRead.mutate(notice._id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notice?._id, notice?.read])

  if (!id) {
    return (
      <div className="rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        Invalid notification.
      </div>
    )
  }

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-2xl border border-border bg-card py-16 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin text-primary" /> Loading notification...
      </div>
    )
  }

  if (isError || !notice) {
    return (
      <div className="rounded-2xl border border-destructive/20 bg-destructive/10 px-4 py-3 text-sm text-destructive">
        This notification could not be found.
      </div>
    )
  }

  const Icon = (iconForType[notice.type] as typeof Bell) || Bell
  const event = notice.event
  const metadata = notice.data

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <Link
        href={basePath}
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-ink"
      >
        <ArrowLeft className="size-4" /> Back to notifications
      </Link>

      <Reveal className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_2px_24px_rgba(0,0,0,0.04)]">
        <div className="border-b border-border bg-muted/30 px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-start gap-4">
              <span className={`flex size-12 shrink-0 items-center justify-center rounded-2xl ${toneForType[notice.type]}`}>
                <Icon className="size-6" />
              </span>
              <div>
                <span className="inline-block rounded-full border border-border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {labelForType[notice.type]}
                </span>
                <h1 className="font-display mt-2 text-xl font-bold tracking-tight text-ink">{notice.title}</h1>
              </div>
            </div>
            {notice.read ? (
              <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-secondary/15 px-2.5 py-1 text-[11px] font-semibold text-secondary">
                <Check className="size-3" /> Read
              </span>
            ) : (
              <button
                onClick={() => markRead.mutate(notice._id)}
                className="shrink-0 rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary transition-colors hover:bg-primary/20"
              >
                Mark as read
              </button>
            )}
          </div>
        </div>

        <div className="space-y-5 px-6 py-6">
          <p className="text-sm leading-relaxed text-ink/80">{notice.message}</p>

          <p className="text-xs text-muted-foreground">
            {new Date(notice.createdAt).toLocaleString(undefined, {
              dateStyle: "full",
              timeStyle: "short",
            })}
          </p>

          {(() => {
            const raw = event as unknown
            const rawId =
              raw && typeof raw === "object" && "_id" in (raw as Record<string, unknown>)
                ? String((raw as { _id?: unknown })._id || "")
                : typeof raw === "string"
                  ? String(raw)
                  : ""
            // Guard: never build /event/undefined — require valid 24-hex ObjectId
            const eventId = rawId && /^[0-9a-fA-F]{24}$/.test(rawId) ? rawId : null
            if (!eventId) return null
            const title =
              raw && typeof raw === "object" ? ((raw as { title?: string }).title || "Event") : "Event"
            const rawDate = raw && typeof raw === "object" ? (raw as { date?: string }).date : null
            const d = rawDate ? new Date(rawDate as string) : null
            const valid = d instanceof Date && !Number.isNaN(d.getTime())
            return (
              <Link
                href={`/event/${eventId}`}
                className="flex items-center gap-4 rounded-xl border border-border bg-background p-4 transition-colors hover:border-primary/40"
              >
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10">
                  <CalendarDays className="size-5 text-primary" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">{title}</span>
                  {valid ? (
                    <span className="block text-xs text-muted-foreground">
                      {d!.toLocaleDateString(undefined, {
                        weekday: "short",
                        month: "short",
                        day: "numeric",
                      })}
                    </span>
                  ) : (
                    <span className="block text-xs text-muted-foreground">Date not available</span>
                  )}
                </span>
                <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary">
                  View event <ExternalLink className="size-3.5" />
                </span>
              </Link>
            )
          })()}

          {(() => {
            let rawLink = notice.link ? String(notice.link).trim() : ""
            if (!rawLink || rawLink.includes("undefined") || rawLink.includes("null")) return null
            // Normalize legacy plural /events/<id> to canonical singular /event/<id>
            if (rawLink.startsWith("/events/")) rawLink = rawLink.replace(/^\/events\//, "/event/")
            if (rawLink === "/event" || rawLink === "/event/" || rawLink === "/events" || rawLink === "/events/") return null
            // If it's an event link, validate the id portion
            if (rawLink.startsWith("/event/")) {
              const idPart = rawLink.split("/")[2]?.split("?")[0]?.split("#")[0] || ""
              if (!idPart || !/^[0-9a-fA-F]{24}$/.test(idPart)) return null
            }
            const safe = /^\/[a-z0-9/_\-?=&]+$/i.test(rawLink) && !rawLink.startsWith("//") && !/^(javascript|data|vbscript):/i.test(rawLink)
            if (!safe) return null
            return (
              <Link
                href={rawLink}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-[0_8px_20px_-10px_rgba(91,76,245,0.8)] transition-transform hover:-translate-y-0.5"
              >
                <ExternalLink className="size-4" /> Open related page
              </Link>
            )
          })()}

          {metadata && (
            <div className="rounded-xl border border-border bg-background px-4 py-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Details</p>
              <dl className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {Object.entries(metadata).map(([key, value]) => (
                  <div key={key} className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-1.5">
                    <dt className="text-xs capitalize text-muted-foreground">{key.replace(/([A-Z])/g, " $1")}</dt>
                    <dd className="truncate font-mono text-xs text-ink">{String(value)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </div>
      </Reveal>
    </div>
  )
}