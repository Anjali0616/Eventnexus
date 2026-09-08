"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import useEmblaCarousel from "embla-carousel-react"
import {
  Calendar,
  CalendarPlus,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  ExternalLink,
  Loader2,
  MapPin,
  QrCode,
  Share2,
  Ticket as TicketIcon,
  Timer,
  XCircle,
  BadgeCheck,
  Sparkles,
  ArrowRight,
} from "lucide-react"
import { AppShell } from "@/components/app/app-shell"
import { Reveal } from "@/components/anim/reveal"
import { QrCodeCanvas } from "@/components/app/qr-code"
import { useMyTickets } from "@/lib/queries/tickets"
import { useCurrentUser } from "@/lib/queries/auth"
import type { EventData } from "@/lib/api/events"
import type { Ticket } from "@/lib/api/tickets"
import { formatPrice, isFreeEvent } from "@/lib/price"
import { toast } from "sonner"

// ── helpers ───────────────────────────────────────────────────────────────

function toIcsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z"
}
function escapeIcs(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;")
}
function buildIcs(event: EventData, ticket: Ticket): string {
  const start = new Date(event.date)
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000)
  const title = event.title.replace(/\r?\n/g, " ")
  const uid = `${ticket._id}@eventnexus.local`
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//EventNexus//Ticket//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${toIcsDate(new Date())}`,
    `DTSTART:${toIcsDate(start)}`,
    `DTEND:${toIcsDate(end)}`,
    `SUMMARY:${escapeIcs(title)}`,
    `DESCRIPTION:${escapeIcs(`Ticket #${ticket._id.slice(-8).toUpperCase()} — ${event.title} at ${event.venue}. Check-in QR is inside the app.`)}`,
    `LOCATION:${escapeIcs(event.venue || "TBA")}`,
    "STATUS:CONFIRMED",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n")
}
function googleCalendarUrl(event: EventData): string {
  const start = new Date(event.date)
  const end = new Date(start.getTime() + 2 * 60 * 60 * 1000)
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").split(".")[0] + "Z"
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${fmt(start)}/${fmt(end)}`,
    details: `${event.title} — ${event.venue}`,
    location: event.venue || "",
  })
  return `https://calendar.google.com/calendar/render?${params.toString()}`
}
function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
function getCountdown(dateStr: string, now: number): { label: string; expired: boolean; soon: boolean } {
  const diff = new Date(dateStr).getTime() - now
  if (diff <= 0) return { label: "Event started", expired: true, soon: false }
  const mins = Math.floor(diff / 60000)
  const hrs = Math.floor(mins / 60)
  const days = Math.floor(hrs / 24)
  if (days > 0) {
    const h = hrs % 24
    return { label: h ? `In ${days}d ${h}h` : `In ${days} day${days === 1 ? "" : "s"}`, expired: false, soon: days === 1 }
  }
  if (hrs > 0) {
    const m = mins % 60
    return { label: m ? `In ${hrs}h ${m}m` : `In ${hrs}h`, expired: false, soon: true }
  }
  return { label: `In ${mins} min`, expired: false, soon: true }
}
function validityMeta(ticket: Ticket, event: EventData | null, now: number): { label: string; tone: string; dot: string } {
  if (ticket.status === "cancelled") return { label: "Cancelled", tone: "bg-destructive/10 text-destructive border-destructive/20", dot: "bg-destructive" }
  if (ticket.status === "checked-in") return { label: "Checked in ✓", tone: "bg-secondary/15 text-secondary border-secondary/20", dot: "bg-secondary" }
  if (!event) return { label: "Valid", tone: "bg-primary/10 text-primary border-primary/20", dot: "bg-primary" }
  const expired = new Date(event.date).getTime() <= now
  if (expired) return { label: "Expired — event passed", tone: "bg-amber-500/15 text-amber-700 border-amber-500/20", dot: "bg-amber-500" }
  return { label: "Valid for entry", tone: "bg-secondary/15 text-secondary border-secondary/20", dot: "bg-secondary" }
}

// ── Wallet card ───────────────────────────────────────────────────────────

function WalletCard({ ticket, now }: { ticket: Ticket; now: number }) {
  const event = typeof ticket.event === "object" ? (ticket.event as EventData) : null
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const free = event ? isFreeEvent(event.price) : true
  const countdown = event ? getCountdown(event.date, now) : null
  const validity = validityMeta(ticket, event, now)
  const isValid = ticket.status === "valid" && !!event && new Date(event.date).getTime() > now
  const isUpcoming = !!event && new Date(event.date).getTime() > now

  const handleDownloadPng = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) {
      toast.error("QR not ready yet")
      return
    }
    try {
      const url = canvas.toDataURL("image/png")
      const a = document.createElement("a")
      a.href = url
      a.download = `eventnexus-ticket-${ticket._id.slice(-8).toUpperCase()}.png`
      document.body.appendChild(a)
      a.click()
      a.remove()
      toast.success("Ticket PNG downloaded")
    } catch {
      toast.error("Couldn't export QR")
    }
  }, [ticket._id])

  const handleShare = useCallback(async () => {
    const shareUrl = event ? `${window.location.origin}/event/${event._id}` : window.location.href
    const text = event
      ? `${event.title} — Ticket #${ticket._id.slice(-8).toUpperCase()} • ${new Date(event.date).toLocaleDateString()} • ${event.venue}`
      : `Ticket #${ticket._id.slice(-8).toUpperCase()}`
    const payload: ShareData = { title: event?.title ?? "My EventNexus ticket", text: `${text}\n${shareUrl}`, url: shareUrl }
    try {
      if (navigator.share && navigator.canShare?.(payload)) {
        await navigator.share(payload)
        return
      }
      if (navigator.share) {
        await navigator.share({ title: payload.title, text: payload.text, url: shareUrl })
        return
      }
    } catch {
      // user cancelled — don't fall through to copy
      return
    }
    try {
      await navigator.clipboard.writeText(`${text}\n${shareUrl}`)
      toast.success("Ticket link copied")
    } catch {
      toast.error("Couldn't copy link")
    }
  }, [event, ticket._id])

  const handleAddToCalendar = useCallback(() => {
    if (!event) return
    const ics = buildIcs(event, ticket)
    downloadBlob(new Blob([ics], { type: "text/calendar;charset=utf-8" }), `${event.title.replace(/[^a-z0-9]+/gi, "_")}.ics`)
    toast.success("Calendar file downloaded — import into Apple Calendar / Outlook")
  }, [event, ticket])

  const handleGoogleCalendar = useCallback(() => {
    if (!event) return
    window.open(googleCalendarUrl(event), "_blank", "noopener,noreferrer")
  }, [event])

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden rounded-[1.4rem] border border-border bg-card shadow-sm">
      {/* Image banner */}
      <div className="relative h-36 shrink-0 overflow-hidden bg-muted">
        {event?.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={event.imageUrl} alt={event.title} className="h-full w-full object-cover" />
        ) : (
          <div className="absolute inset-0 bg-brand-gradient opacity-90" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/15 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-4 text-white">
          <div className="flex flex-wrap items-center gap-1.5">
            {event?.category && <span className="rounded-full bg-white/90 px-2.5 py-0.5 text-[11px] font-bold text-ink">{event.category}</span>}
            {event?.type && <span className="rounded-full bg-black/30 px-2.5 py-0.5 text-[11px] font-medium backdrop-blur">{event.type}</span>}
            {isValid && <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-bold text-white"><BadgeCheck className="size-3" /> Valid</span>}
            {ticket.status === "checked-in" && <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-bold text-white"><CheckCircle2 className="size-3" /> Attended</span>}
            {ticket.status === "cancelled" && <span className="rounded-full bg-destructive px-2.5 py-0.5 text-[11px] font-bold text-white">Cancelled</span>}
          </div>
          <h3 className="font-display mt-2 line-clamp-2 text-lg font-bold leading-tight">{event?.title ?? "Event"}</h3>
          {event && <p className="mt-0.5 line-clamp-1 text-xs text-white/80">{event.venue || "Venue TBA"} · {new Date(event.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</p>}
        </div>
        {/* Cutout notches like a real ticket */}
        <span className="absolute -bottom-2 -left-2 size-4 rounded-full bg-background" />
        <span className="absolute -bottom-2 -right-2 size-4 rounded-full bg-background" />
      </div>

      <div className="flex flex-1 flex-col gap-4 p-5">
        {/* Event meta */}
        {event && (
          <div className="grid grid-cols-2 gap-2">
            <div className="rounded-xl bg-muted/50 p-3">
              <Calendar className="size-3.5 text-primary" />
              <div className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">Date</div>
              <div className="text-sm font-semibold text-ink">{new Date(event.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
              <div className="text-xs text-muted-foreground">{new Date(event.date).toLocaleTimeString("en-US", { timeStyle: "short" })}</div>
            </div>
            <div className="rounded-xl bg-muted/50 p-3">
              <MapPin className="size-3.5 text-primary" />
              <div className="mt-1 text-[11px] uppercase tracking-wide text-muted-foreground">Venue</div>
              <div className="line-clamp-2 text-sm font-semibold text-ink">{event.venue || "TBA"}</div>
            </div>
          </div>
        )}

        {/* Countdown + validity */}
        <div className="flex flex-wrap items-center gap-2">
          {countdown && (
            <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${countdown.expired ? "border-amber-500/20 bg-amber-50 text-amber-700" : countdown.soon ? "border-primary/20 bg-primary/10 text-primary" : "border-border bg-muted text-ink"}`}>
              <Timer className="size-3.5" /> {countdown.label}
            </span>
          )}
          <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${validity.tone}`}>
            <span className={`size-1.5 rounded-full ${validity.dot}`} /> {validity.label}
          </span>
          {event && <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">{free ? "Free" : formatPrice(event.price)}</span>}
        </div>

        {/* QR */}
        <div className="flex flex-col items-center">
          <div className={`rounded-2xl border p-3 ${ticket.status === "cancelled" ? "border-dashed opacity-60" : isValid ? "border-secondary/20 bg-secondary/[0.04]" : "border-border bg-muted/30"}`}>
            {ticket.status === "valid" ? (
              <QrCodeCanvas ref={canvasRef} seed={ticket.qrToken} size={172} />
            ) : ticket.status === "checked-in" ? (
              <div className="flex size-[172px] flex-col items-center justify-center gap-2 text-secondary">
                <CheckCircle2 className="size-10" />
                <span className="text-xs font-bold">Checked in</span>
                {ticket.checkedInAt && <span className="text-[11px] text-muted-foreground">{new Date(ticket.checkedInAt).toLocaleString()}</span>}
              </div>
            ) : (
              <div className="flex size-[172px] flex-col items-center justify-center gap-2 text-muted-foreground">
                <XCircle className="size-10 text-destructive/60" />
                <span className="text-xs font-bold text-destructive">Cancelled</span>
                <span className="px-2 text-center text-[11px]">This QR is no longer valid</span>
              </div>
            )}
          </div>
          <p className="mt-2 font-mono text-[11px] tracking-wide text-muted-foreground">Ticket #{ticket._id.slice(-8).toUpperCase()} • {ticket.status}</p>
          {isValid && <p className="mt-1 flex items-center gap-1 text-xs font-medium text-secondary"><QrCode className="size-3.5" /> Present this at the entrance</p>}
        </div>

        {/* Actions */}
        <div className="mt-auto grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={handleDownloadPng}
            disabled={ticket.status !== "valid"}
            className="flex flex-col items-center justify-center gap-1 rounded-xl border border-border bg-background px-2 py-2.5 text-xs font-semibold text-ink transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="size-4" /> Download PNG
          </button>
          <button
            type="button"
            onClick={handleShare}
            className="flex flex-col items-center justify-center gap-1 rounded-xl border border-border bg-background px-2 py-2.5 text-xs font-semibold text-ink transition-colors hover:bg-muted"
          >
            <Share2 className="size-4" /> Share
          </button>
          <button
            type="button"
            onClick={handleAddToCalendar}
            disabled={!event || !isUpcoming}
            className="flex flex-col items-center justify-center gap-1 rounded-xl bg-primary px-2 py-2.5 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <CalendarPlus className="size-4" /> Calendar
          </button>
        </div>
        {event && isUpcoming && (
          <button
            type="button"
            onClick={handleGoogleCalendar}
            className="w-full rounded-xl border border-border bg-card py-2 text-center text-xs font-medium text-ink hover:bg-muted"
          >
            Add to Google Calendar
          </button>
        )}

        {/* Event detail link */}
        {event && (
          <Link href={`/event/${event._id}`} className="flex items-center justify-center gap-1.5 rounded-xl bg-ink px-4 py-2.5 text-sm font-semibold text-white hover:bg-ink/90">
            View event details <ExternalLink className="size-3.5" />
          </Link>
        )}

        {/* Extra context for expired/checked-in */}
        {event?.description && (
          <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">{event.description}</p>
        )}
      </div>
    </div>
  )
}

// ── Page ───────────────────────────────────────────────────────────────────

export default function AttendeeCheckInPage() {
  const { data: userData } = useCurrentUser()
  const { data, isLoading } = useMyTickets({ limit: 100 })
  const user = userData?.user
  const tickets = data?.tickets ?? []

  // Live clock for countdowns (tick every 30s — cheap, no per-second churn)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  const stats = useMemo(() => {
    const valid = tickets.filter((t) => t.status === "valid").length
    const checkedIn = tickets.filter((t) => t.status === "checked-in").length
    const cancelled = tickets.filter((t) => t.status === "cancelled").length
    const upcoming = tickets.filter((t) => {
      if (t.status !== "valid") return false
      const ev = typeof t.event === "object" ? (t.event as EventData) : null
      return ev ? new Date(ev.date).getTime() > now : false
    }).length
    return { total: tickets.length, valid, checkedIn, cancelled, upcoming }
  }, [tickets, now])

  const [filter, setFilter] = useState<"all" | "valid" | "checked-in" | "cancelled" | "upcoming">("all")
  const filtered = useMemo(() => {
    let list = [...tickets]
    if (filter === "valid") list = list.filter((t) => t.status === "valid")
    else if (filter === "checked-in") list = list.filter((t) => t.status === "checked-in")
    else if (filter === "cancelled") list = list.filter((t) => t.status === "cancelled")
    else if (filter === "upcoming") list = list.filter((t) => {
      if (t.status !== "valid") return false
      const ev = typeof t.event === "object" ? (t.event as EventData) : null
      return ev ? new Date(ev.date).getTime() > now : false
    })
    // Sort: valid upcoming nearest first, then checked-in, then cancelled
    const priority: Record<string, number> = { valid: 0, "checked-in": 1, cancelled: 2 }
    list.sort((a, b) => {
      const pa = priority[a.status] ?? 9
      const pb = priority[b.status] ?? 9
      if (pa !== pb) return pa - pb
      const da = typeof a.event === "object" ? new Date((a.event as EventData).date).getTime() : 0
      const db = typeof b.event === "object" ? new Date((b.event as EventData).date).getTime() : 0
      return da - db
    })
    return list
  }, [tickets, filter, now])

  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: false, align: "start", containScroll: "trimSnaps", dragFree: false })
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [scrollSnaps, setScrollSnaps] = useState<number[]>([])
  const scrollPrev = useCallback(() => emblaApi?.scrollPrev(), [emblaApi])
  const scrollNext = useCallback(() => emblaApi?.scrollNext(), [emblaApi])
  const scrollTo = useCallback((i: number) => emblaApi?.scrollTo(i), [emblaApi])

  useEffect(() => {
    if (!emblaApi) return
    const onSelect = () => setSelectedIndex(emblaApi.selectedScrollSnap())
    setScrollSnaps(emblaApi.scrollSnapList())
    emblaApi.on("select", onSelect)
    emblaApi.on("reInit", () => setScrollSnaps(emblaApi.scrollSnapList()))
    onSelect()
    return () => { emblaApi.off("select", onSelect) }
  }, [emblaApi])

  const filterOptions: { id: typeof filter; label: string; count: number }[] = [
    { id: "all", label: "All", count: stats.total },
    { id: "upcoming", label: "Upcoming", count: stats.upcoming },
    { id: "valid", label: "Valid", count: stats.valid },
    { id: "checked-in", label: "Attended", count: stats.checkedIn },
    { id: "cancelled", label: "Cancelled", count: stats.cancelled },
  ]

  if (isLoading) {
    return (
      <AppShell role="Attendee" userName={user?.name || "Attendee"} title="Check-in">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading your ticket wallet...
        </div>
      </AppShell>
    )
  }

  // No tickets at all
  if (tickets.length === 0) {
    return (
      <AppShell role="Attendee" userName={user?.name || "Attendee"} title="Check-in">
        <div className="space-y-6">
          <Reveal className="rounded-2xl border border-secondary/20 bg-secondary/[0.05] p-6">
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-xl bg-secondary/15 text-secondary">
                <QrCode className="size-5" />
              </span>
              <div>
                <h1 className="font-display text-xl font-bold text-ink">Your ticket wallet</h1>
                <p className="text-sm text-muted-foreground">All your EventNexus tickets, swipeable and ready to scan at the door.</p>
              </div>
            </div>
          </Reveal>
          <Reveal className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border bg-card py-16 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10"><TicketIcon className="size-7 text-primary" /></span>
            <div>
              <p className="font-display text-lg font-bold text-ink">No tickets yet</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">Join an event and your scannable QR ticket will live here — one card per event, with countdown, calendar, and sharing built in.</p>
            </div>
            <Link href="/dashboard" className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-[0_8px_20px_-10px_rgba(91,76,245,0.8)] transition-transform hover:-translate-y-0.5">
              <Sparkles className="size-4" /> Discover events
            </Link>
          </Reveal>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell role="Attendee" userName={user?.name || "Attendee"} title="Check-in">
      <div className="space-y-6">
        {/* Header */}
        <Reveal className="rounded-2xl border border-secondary/20 bg-secondary/[0.05] p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="flex size-11 items-center justify-center rounded-xl bg-secondary/15 text-secondary">
                <QrCode className="size-5" />
              </span>
              <div>
                <h1 className="font-display text-xl font-bold text-ink">Your ticket wallet</h1>
                <p className="text-sm text-muted-foreground">
                  {stats.total} ticket{stats.total === 1 ? "" : "s"} • {stats.upcoming} upcoming • swipe to browse
                </p>
              </div>
            </div>
            <Link href="/my-tickets" className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-semibold text-ink hover:bg-muted">
              Manage in My Tickets <ArrowRight className="size-4" />
            </Link>
          </div>
        </Reveal>

        {/* Stats */}
        <Reveal className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-border bg-card p-4 text-center">
            <p className="font-display text-2xl font-bold text-primary">{stats.upcoming}</p>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Upcoming</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 text-center">
            <p className="font-display text-2xl font-bold text-secondary">{stats.checkedIn}</p>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Attended</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 text-center">
            <p className="font-display text-2xl font-bold text-ink">{stats.valid}</p>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Valid</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-4 text-center">
            <p className="font-display text-2xl font-bold text-destructive/80">{stats.cancelled}</p>
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Cancelled</p>
          </div>
        </Reveal>

        {/* Filter pills */}
        <Reveal className="flex flex-wrap gap-2">
          {filterOptions.map((opt) => (
            <button
              key={opt.id}
              onClick={() => setFilter(opt.id)}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-semibold transition-colors ${filter === opt.id ? "border-ink bg-ink text-white" : "border-border bg-card text-muted-foreground hover:text-ink"}`}
            >
              {opt.label} <span className={`ml-1 rounded-full px-1.5 py-0.5 text-[11px] ${filter === opt.id ? "bg-white/20 text-white" : "bg-muted text-muted-foreground"}`}>{opt.count}</span>
            </button>
          ))}
        </Reveal>

        {/* Wallet */}
        {filtered.length === 0 ? (
          <Reveal className="rounded-2xl border border-dashed border-border bg-card py-12 text-center">
            <p className="text-sm text-muted-foreground">No tickets in this filter.</p>
            <button type="button" onClick={() => setFilter("all")} className="mt-3 text-sm font-semibold text-primary hover:underline">Show all tickets</button>
          </Reveal>
        ) : (
          <>
            <div className="relative">
              {/* Carousel viewport */}
              <div ref={emblaRef} className="overflow-hidden rounded-2xl">
                <div className="flex touch-pan-y gap-4">
                  {filtered.map((ticket) => (
                    <div key={ticket._id} className="min-w-0 flex-[0_0_100%] sm:flex-[0_0_calc(50%-8px)] lg:flex-[0_0_calc(33.333%-11px)]">
                      <WalletCard ticket={ticket} now={now} />
                    </div>
                  ))}
                </div>
              </div>

              {/* Desktop arrows */}
              {filtered.length > 1 && (
                <>
                  <button
                    type="button"
                    onClick={scrollPrev}
                    aria-label="Previous ticket"
                    className="absolute -left-3 top-1/2 hidden size-9 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card text-ink shadow-md hover:bg-muted sm:flex"
                  >
                    <ChevronLeft className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={scrollNext}
                    aria-label="Next ticket"
                    className="absolute -right-3 top-1/2 hidden size-9 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-card text-ink shadow-md hover:bg-muted sm:flex"
                  >
                    <ChevronRight className="size-4" />
                  </button>
                </>
              )}
            </div>

            {/* Dots */}
            {scrollSnaps.length > 1 && (
              <div className="flex items-center justify-center gap-2">
                {scrollSnaps.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => scrollTo(i)}
                    aria-label={`Go to ticket ${i + 1}`}
                    className={`h-2 rounded-full transition-all ${i === selectedIndex ? "w-6 bg-primary" : "w-2 bg-border hover:bg-muted-foreground/30"}`}
                  />
                ))}
                <span className="ml-2 text-xs text-muted-foreground">{selectedIndex + 1} / {filtered.length}</span>
              </div>
            )}

            {/* Hint */}
            <p className="text-center text-xs text-muted-foreground">Swipe cards sideways — each ticket has its own QR, countdown, and calendar actions.</p>

            {/* Quick list fallback (accessibility + long wallets): expand all */}
            <Reveal>
              <details className="rounded-2xl border border-border bg-card">
                <summary className="cursor-pointer list-none px-6 py-4 text-sm font-semibold text-ink">Show all tickets as a list</summary>
                <div className="grid gap-4 border-t border-border p-4 sm:grid-cols-2 lg:grid-cols-3">
                  {filtered.map((ticket) => {
                    const ev = typeof ticket.event === "object" ? (ticket.event as EventData) : null
                    return (
                      <Link key={`list-${ticket._id}`} href={ev ? `/event/${ev._id}` : "/dashboard"} className="flex items-center gap-3 rounded-xl border border-border p-3 hover:border-primary/30">
                        <span className={`size-2 shrink-0 rounded-full ${ticket.status === "valid" ? "bg-secondary" : ticket.status === "checked-in" ? "bg-primary" : "bg-destructive"}`} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-ink">{ev?.title ?? "Event"}</div>
                          <div className="text-xs text-muted-foreground">{ev ? new Date(ev.date).toLocaleDateString() : ""} • {ticket.status}</div>
                        </div>
                        <Clock className="size-4 shrink-0 text-muted-foreground" />
                      </Link>
                    )
                  })}
                </div>
              </details>
            </Reveal>
          </>
        )}
      </div>
    </AppShell>
  )
}
