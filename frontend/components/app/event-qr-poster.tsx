"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  QrCode as QrCodeIcon,
  Share2,
  Ticket as TicketIcon,
  Calendar,
  MapPin,
  Tag,
  Wallet,
  Link2,
  Hexagon,
  Loader2,
  Zap,
  Sparkles,
} from "lucide-react"
import { QrCodeCanvas } from "@/components/app/qr-code"
import { useEvent } from "@/lib/queries/events"
import { useMyTickets, useRegisterForEvent } from "@/lib/queries/tickets"
import { useCurrentUser } from "@/lib/queries/auth"
import { formatPrice, isFreeEvent } from "@/lib/price"
import { buildPublicUrl } from "@/lib/qr"
import type { EventData } from "@/lib/api/events"
import type { Ticket } from "@/lib/api/tickets"
import { toast } from "sonner"

function slugify(title: string) {
  return title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "event"
}

// ---------------------------------------------------------------------------
// Props (backward compatible)
// ---------------------------------------------------------------------------

export interface EventQrPosterProps {
  eventId: string
  eventTitle: string
  /** Optional full event to avoid an extra fetch; falls back to useEvent(). */
  event?: EventData | null
  /** Optional pre-resolved ticket; otherwise resolved from useMyTickets(). */
  ticket?: Ticket | null
  /** Viewer role for CTA logic. When omitted, derived from useCurrentUser(). */
  role?: string
  /** Custom register handler. Defaults to mutation + toast. */
  onRegister?: () => void
}

// ---------------------------------------------------------------------------
// Component — minimal QR share/copy only (poster UI removed)
// ---------------------------------------------------------------------------

export function EventQrPoster({
  eventId,
  eventTitle,
  event: eventProp,
  ticket: ticketProp,
  role: roleProp,
  onRegister,
}: EventQrPosterProps) {
  const router = useRouter()
  const qrCanvasRef = useRef<HTMLCanvasElement>(null)
  const ticketCanvasRef = useRef<HTMLCanvasElement>(null)

  const [activeTab, setActiveTab] = useState<"share" | "ticket">("share")
  const [copied, setCopied] = useState(false)
  const [shareFeedback, setShareFeedback] = useState(false)

  const publicUrl = useMemo(() => {
    try {
      const origin = typeof window !== "undefined" ? window.location.origin : ""
      return buildPublicUrl(eventId, { baseUrl: origin || undefined, qrHint: true, withTracking: true })
    } catch {
      return typeof window !== "undefined" ? `${window.location.origin}/event/${eventId}` : `/event/${eventId}`
    }
  }, [eventId])

  const { data: eventData } = useEvent(eventId)
  const { data: ticketData } = useMyTickets({ limit: 100 })
  const { data: userData } = useCurrentUser()
  const registerMutation = useRegisterForEvent()

  const event: EventData | null = (eventProp as EventData | null) ?? eventData?.event ?? null
  const displayTitle = event?.title ?? eventTitle
  const displayDate = event?.date ? new Date(event.date) : null
  const displayVenue = event?.venue ?? "Venue TBA"
  const displayCategory = event?.category ?? "Event"
  const displayPrice = event?.price ? formatPrice(event.price) : "Free"
  const displayOrganizer =
    event && typeof event.organizer === "object" && (event.organizer as any)?.name
      ? (event.organizer as any).name
      : "Organizer"

  const tickets = ticketData?.tickets ?? []
  const resolvedTicket: Ticket | null =
    (ticketProp as Ticket | null) ??
    (tickets.find((t) => {
      const ev = typeof t.event === "object" ? (t.event as any) : null
      return ev?._id === eventId
    }) as Ticket | undefined) ??
    null
  const isRegistered = !!resolvedTicket && resolvedTicket.status !== "cancelled"
  const ticketToken = resolvedTicket?.qrToken ?? ""
  const currentUser = userData?.user as any
  const isAttendee =
    roleProp === "Attendee" ||
    currentUser?.role === "attendee" ||
    currentUser?.role === "Attendee" ||
    (!roleProp && !currentUser)

  const isPast = displayDate ? displayDate.getTime() <= Date.now() : false
  const isFull = event ? event.registered >= event.capacity : false
  const free = event ? isFreeEvent(event.price) : true

  useEffect(() => {
    if (!isRegistered && activeTab === "ticket") setActiveTab("share")
  }, [isRegistered, activeTab])

  const qrDisplaySize = 200

  // --- Actions ---------------------------------------------------------------

  const handleCopy = async (value: string = publicUrl) => {
    if (!value) {
      toast.error("Nothing to copy")
      return
    }
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value)
      } else {
        const ta = document.createElement("textarea")
        ta.value = value
        ta.setAttribute("readonly", "")
        ta.style.position = "fixed"
        ta.style.opacity = "0"
        document.body.appendChild(ta)
        ta.select()
        const ok = document.execCommand("copy")
        document.body.removeChild(ta)
        if (!ok) throw new Error("execCommand failed")
      }
      setCopied(true)
      toast.success("Link copied")
      setTimeout(() => setCopied(false), 1800)
    } catch {
      try {
        window.prompt("Copy this link:", value)
      } catch {}
      toast.error("Copy failed — please copy manually")
    }
  }

  const handleDownloadQr = () => {
    const canvas = activeTab === "ticket" ? ticketCanvasRef.current : qrCanvasRef.current
    if (!canvas) {
      toast.error("QR not ready yet")
      return
    }
    const link = document.createElement("a")
    const suffix = activeTab === "ticket" ? "ticket-qr" : "event-qr"
    link.download = `${slugify(displayTitle)}-${suffix}.png`
    link.href = canvas.toDataURL("image/png")
    link.click()
    toast.success("QR downloaded")
  }

  const handleNativeShare = async () => {
    const shareUrl = publicUrl
    const title = displayTitle
    const text = `Check out ${displayTitle} on EventNexus — ${displayCategory} at ${displayVenue}.`
    if (navigator.share) {
      try {
        await navigator.share({ title, text, url: shareUrl })
        return
      } catch (err: any) {
        if (err?.name === "AbortError") return
      }
    }
    await handleCopy(shareUrl)
    setShareFeedback(true)
    setTimeout(() => setShareFeedback(false), 1800)
  }

  const handleRegister = () => {
    if (onRegister) {
      onRegister()
      return
    }
    if (!currentUser) {
      router.push(`/register?redirect=${encodeURIComponent(`/event/${eventId}`)}`)
      return
    }
    if (!event || isPast || isFull) return
    registerMutation.mutate(eventId, {
      onSuccess: () => setActiveTab("ticket"),
    })
  }

  const TicketBadge = () => {
    if (!isRegistered || !resolvedTicket) return null
    const st = resolvedTicket.status
    const label = st === "checked-in" ? "Checked in" : st === "cancelled" ? "Cancelled" : "Valid"
    const cls =
      st === "checked-in"
        ? "bg-secondary/15 text-secondary border-secondary/20"
        : st === "cancelled"
          ? "bg-destructive/10 text-destructive border-destructive/20"
          : "bg-primary/10 text-primary border-primary/20"
    return (
      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
        {label}
      </span>
    )
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_2px_24px_rgba(0,0,0,0.04)]">
      {/* Header */}
      <div className="border-b border-border bg-muted/20 px-5 py-4 sm:px-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex gap-3">
            <span className="bg-brand-gradient hidden size-9 shrink-0 items-center justify-center rounded-xl text-white shadow sm:flex">
              <QrCodeIcon className="size-4" />
            </span>
            <div>
              <h2 className="flex items-center gap-1.5 font-display text-[15px] font-bold leading-none text-ink">
                <QrCodeIcon className="size-3.5 text-primary sm:hidden" />
                {activeTab === "ticket" ? "Your ticket" : "Public event QR"}
                {isRegistered && activeTab === "share" && (
                  <span className="hidden items-center gap-1 rounded-full bg-secondary/10 px-2 py-0.5 text-[10px] font-semibold text-secondary sm:inline-flex">
                    <Check className="size-3" /> You’re in
                  </span>
                )}
              </h2>
              <p className="mt-1 max-w-[52ch] text-xs leading-relaxed text-muted-foreground">
                {activeTab === "ticket"
                  ? `Ticket #${resolvedTicket!._id.slice(-8).toUpperCase()} for “${displayTitle}” — present this at check-in.`
                  : `Scan to open “${displayTitle}” on EventNexus.`}
              </p>
            </div>
          </div>
          <span className="hidden shrink-0 items-center gap-1 rounded-full bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground shadow-sm ring-1 ring-border sm:inline-flex">
            <Link2 className="size-3" /> event/{eventId.slice(-6)}
          </span>
        </div>

        {/* Tabs when registered */}
        {isRegistered && (
          <div className="mt-4 inline-flex gap-1 rounded-xl bg-card p-1 ring-1 ring-border">
            <button
              onClick={() => setActiveTab("share")}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                activeTab === "share" ? "bg-ink text-white shadow" : "text-muted-foreground hover:text-ink"
              }`}
            >
              <Share2 className="size-3.5" /> Share event
            </button>
            <button
              onClick={() => setActiveTab("ticket")}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                activeTab === "ticket" ? "bg-ink text-white shadow" : "text-muted-foreground hover:text-ink"
              }`}
            >
              <TicketIcon className="size-3.5" /> My ticket <TicketBadge />
            </button>
          </div>
        )}
      </div>

      <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[1.05fr_1fr]">
        {/* Left: event detail card + QR */}
        <div className="space-y-4">
          {/* Event detail card */}
          <div className="overflow-hidden rounded-2xl border border-border bg-muted/20">
            {event?.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={event.imageUrl} alt={displayTitle} className="h-28 w-full object-cover sm:h-32" />
            ) : (
              <div className="bg-brand-gradient relative h-28 w-full sm:h-32">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.26),transparent_55%)]" />
                <div className="absolute bottom-3 left-3 flex items-center gap-2">
                  <span className="rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-ink">{displayCategory}</span>
                  <span className="hidden rounded-full bg-black/20 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur sm:inline-flex">
                    {event?.type ?? "In-person"}
                  </span>
                </div>
              </div>
            )}
            <div className="space-y-3 p-4">
              <div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">{displayCategory}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{event?.type ?? "In-person"}</span>
                  {isPast && <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[11px] font-medium">Concluded</span>}
                  {isFull && !isPast && <span className="rounded-full bg-flame/10 px-2 py-0.5 text-[11px] font-semibold text-flame">Full</span>}
                </div>
                <h3 className="font-display mt-2 line-clamp-2 text-[15px] font-bold leading-snug text-ink">{displayTitle}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">by {displayOrganizer}</p>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="rounded-xl bg-card px-2.5 py-2 ring-1 ring-border">
                  <Calendar className="size-3.5 text-primary" />
                  <div className="mt-1 font-semibold text-ink">
                    {displayDate ? displayDate.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "TBA"}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {displayDate ? displayDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "—"}
                  </div>
                </div>
                <div className="rounded-xl bg-card px-2.5 py-2 ring-1 ring-border">
                  <MapPin className="size-3.5 text-primary" />
                  <div className="mt-1 truncate font-semibold text-ink" title={displayVenue}>
                    {displayVenue}
                  </div>
                  <div className="text-[11px] text-muted-foreground">Venue</div>
                </div>
                <div className="rounded-xl bg-card px-2.5 py-2 ring-1 ring-border">
                  <Wallet className="size-3.5 text-primary" />
                  <div className="mt-1 font-semibold text-ink">{displayPrice}</div>
                  <div className="text-[11px] text-muted-foreground">{free ? "No payment" : "Per ticket"}</div>
                </div>
              </div>

              {event?.description && (
                <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">{event.description}</p>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                {event && (
                  <>
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 font-medium text-muted-foreground">
                      <Tag className="size-3" /> {event.registered}/{event.capacity}
                    </span>
                    {event.tags?.slice(0, 3).map((t) => (
                      <span key={t} className="rounded-full bg-card px-2 py-1 ring-1 ring-border">
                        {t}
                      </span>
                    ))}
                  </>
                )}
              </div>

              <div className="flex items-center gap-2 pt-2">
                <Link
                  href={publicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-ink px-3 py-2 text-xs font-semibold text-white transition hover:bg-ink/90"
                >
                  <ExternalLink className="size-3.5" /> View public page
                </Link>
                <button
                  onClick={() => handleCopy(publicUrl)}
                  className="inline-flex items-center gap-1 rounded-xl border border-border bg-card px-3 py-2 text-xs font-medium text-ink hover:bg-muted"
                  title="Copy link"
                >
                  {copied ? <Check className="size-3.5 text-secondary" /> : <Copy className="size-3.5" />}
                </button>
              </div>

              {publicUrl && (
                <div className="break-all rounded-xl bg-ink px-3 py-2 font-mono text-[11px] leading-relaxed text-white/90">
                  {publicUrl}
                </div>
              )}
            </div>
          </div>

          {/* Register CTA — prominent when attendee is not yet registered */}
          {activeTab === "share" && !isRegistered && isAttendee && (
            <div
              className={`rounded-2xl border p-4 ${
                isPast || isFull ? "border-border bg-muted/30" : "border-primary/20 bg-primary/[0.04]"
              }`}
            >
              <div className="flex items-start gap-3">
                <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${isPast || isFull ? "bg-muted text-muted-foreground" : "bg-primary text-white"}`}>
                  {isPast ? <Calendar className="size-4" /> : isFull ? <Tag className="size-4" /> : <Zap className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-ink">
                    {isPast ? "This event has concluded" : isFull ? "Event is full" : free ? "Join this event — it's free" : `Secure your spot — ${displayPrice}`}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {isPast
                      ? "Registration is closed. Browse other upcoming events."
                      : isFull
                        ? "All spots are taken. Check back for cancellations or explore similar events."
                        : "Scan the QR or use the button below — you'll get an instant ticket with a scannable QR for check-in."}
                  </p>
                  {!isPast && !isFull && (
                    <button
                      onClick={handleRegister}
                      disabled={registerMutation.isPending}
                      className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-[0_8px_20px_-10px_rgba(91,76,245,0.45)] transition hover:-translate-y-0.5 disabled:opacity-60 sm:w-auto"
                    >
                      {registerMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <TicketIcon className="size-4" />}
                      {registerMutation.isPending ? "Registering…" : free ? "Register now — Free" : `Register — ${displayPrice}`}
                    </button>
                  )}
                  {registerMutation.isError && (
                    <p className="mt-2 text-xs text-amber-600">
                      {(registerMutation.error as any)?.response?.data?.message || "Registration failed"}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Ticket status callout when on ticket tab */}
          {activeTab === "ticket" && isRegistered && resolvedTicket && (
            <div className="rounded-2xl border border-secondary/20 bg-secondary/[0.06] p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-secondary">
                <Sparkles className="size-3.5" /> You’re registered
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>
                  Ticket #{resolvedTicket._id.slice(-8).toUpperCase()} • {resolvedTicket.status === "checked-in" ? "Checked in" : "Valid — present at door"}
                </span>
                <TicketBadge />
              </div>
              {resolvedTicket.status === "checked-in" && resolvedTicket.checkedInAt && (
                <p className="mt-1 text-[11px] text-muted-foreground">Checked in {new Date(resolvedTicket.checkedInAt).toLocaleString()}</p>
              )}
            </div>
          )}
        </div>

        {/* Right: QR stage + minimal actions */}
        <div className="space-y-4">
          {/* QR stage */}
          <div className="relative flex flex-col items-center gap-3 rounded-2xl border border-border bg-card p-5 sm:p-6">
            <div className="flex w-full items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <Hexagon className="size-3 text-primary" /> {activeTab === "ticket" ? "Ticket QR" : "Event QR"}
              </span>
            </div>

            <div className="relative">
              {activeTab === "ticket" && isRegistered ? (
                <QrCodeCanvas
                  ref={ticketCanvasRef}
                  seed={ticketToken}
                  size={qrDisplaySize}
                  level="M"
                  fgColor="#1a1a2e"
                  bgColor="#ffffff"
                  bordered
                  includeMargin={false}
                  title={`Ticket ${resolvedTicket!._id.slice(-8)}`}
                />
              ) : (
                <QrCodeCanvas
                  ref={qrCanvasRef}
                  seed={publicUrl}
                  size={qrDisplaySize}
                  level="M"
                  fgColor="#1a1a2e"
                  bgColor="#ffffff"
                  bordered
                  includeMargin={false}
                  title={displayTitle}
                />
              )}
            </div>

            <div className="text-center">
              <div className="font-mono text-[11px] font-medium text-muted-foreground">
                {activeTab === "ticket" && isRegistered
                  ? `Ticket #${resolvedTicket!._id.slice(-8).toUpperCase()}`
                  : publicUrl.replace(/^https?:\/\//, "")}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {activeTab === "ticket" ? "Scan at check-in desk" : "Scan to open • Register on the spot"}
              </div>
            </div>

            {/* Quick stats row under QR when event data is present */}
            {event && activeTab === "share" && (
              <div className="grid w-full grid-cols-3 gap-2 pt-2 text-center text-xs">
                <div className="rounded-xl bg-card p-2 ring-1 ring-border">
                  <div className="font-bold text-ink">{event.registered}</div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Joined</div>
                </div>
                <div className="rounded-xl bg-card p-2 ring-1 ring-border">
                  <div className="font-bold text-ink">{Math.max(0, event.capacity - event.registered)}</div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Left</div>
                </div>
                <div className="rounded-xl bg-card p-2 ring-1 ring-border">
                  <div className="font-bold text-ink">{displayPrice}</div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Price</div>
                </div>
              </div>
            )}
          </div>

          {/* Minimal action bar — QR share/copy only */}
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleCopy(activeTab === "ticket" ? (ticketToken || publicUrl) : publicUrl)}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2.5 text-xs font-semibold text-ink hover:bg-muted"
              >
                {copied ? <Check className="size-3.5 text-secondary" /> : <Copy className="size-3.5" />}
                {copied ? "Copied" : "Copy link"}
              </button>
              <button
                onClick={handleDownloadQr}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2.5 text-xs font-semibold text-ink hover:bg-muted"
              >
                <Download className="size-3.5" /> Download QR
              </button>
            </div>

            <button
              onClick={handleNativeShare}
              className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-ink px-3 py-2.5 text-xs font-semibold text-white shadow hover:bg-ink/90"
            >
              <Share2 className="size-3.5" /> Share
            </button>

            <div className="flex items-center justify-center pt-1">
              <a
                href={publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
              >
                <ExternalLink className="size-3" /> Open public page
              </a>
            </div>
            {shareFeedback && <p className="text-center text-xs font-medium text-secondary">Link copied — share it anywhere</p>}
          </div>
        </div>
      </div>
    </div>
  )
}
