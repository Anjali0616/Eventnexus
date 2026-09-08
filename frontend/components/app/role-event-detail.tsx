"use client"

import { useRef, useState } from "react"
import { useSearchParams, useRouter } from "next/navigation"
import Link from "next/link"
import {
  ArrowLeft,
  ArrowUpRight,
  Bell,
  Brain,
  Calendar,
  Check,
  Clock,
  CreditCard,
  Edit,
  Globe,
  Heart,
  ListChecks,
  Loader2,
  Mail,
  MapPin,
  Phone,
  Plus,
  QrCode as QrIcon,
  RotateCcw,
  Share2,
  Sparkles,
  Ticket,
  Trash2,
  Users,
  Wallet,
  X,
  type LucideIcon,
} from "lucide-react"
import { AppShell } from "@/components/app/app-shell"
import { Reveal } from "@/components/anim/reveal"
import { toast } from "sonner"
import { QrCode } from "@/components/app/qr-code"
import { FeedbackForm } from "@/components/app/feedback-form"
import { FeedbackSummaryPanel } from "@/components/app/feedback-summary"
import { NetworkingPanel } from "@/components/app/networking-panel"
import { VenueMap } from "@/components/app/venue-map"
import { EventQrPoster } from "@/components/app/event-qr-poster"
import { SessionsPanel } from "@/components/app/sessions-panel"
import { RemindersPanel } from "@/components/app/reminders-panel"
import { AttendeeRoster } from "@/components/app/attendee-roster"
import { EventAiInsights } from "@/components/app/event-ai-insights"
import { useEvent, useUpdateEvent, useDeleteEvent } from "@/lib/queries/events"
import { useMyTickets, useRegisterForEvent, useCancelTicket } from "@/lib/queries/tickets"
import { useCurrentUser } from "@/lib/queries/auth"
import { useUpdateLocation } from "@/lib/queries/location"
import { usePaymentConfig, useCreateCheckoutSession, useInitiateEsewaPayment } from "@/lib/queries/payments"
import { useSavedEvents, useAddSavedEvent, useRemoveSavedEvent } from "@/lib/queries/saved"
import { submitEsewaForm } from "@/lib/esewa"
import { formatPrice, isFreeEvent } from "@/lib/price"
import { isSaved, toggleSaved } from "@/lib/saved-events"
import { useEventSessions, useCreateSession, useUpdateSession, useDeleteSession, useOrganizationSpeakers } from "@/lib/queries/sessions"

type RoleEventDetailProps = {
  eventId: string
  role: "Administrator" | "Organizer" | "Attendee"
  userName: string
  title: string
  backHref: string
  backLabel: string
  ticketHref: string
  registerLabel?: string
  registerIcon?: LucideIcon
}

// Haversine distance in km — mirrors the backend's utils/geo.js so the
// event detail page can show "X km away" without an extra API round-trip.
function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
}

export function RoleEventDetail({
  eventId,
  role,
  userName,
  title,
  backHref,
  backLabel,
  ticketHref,
  registerLabel = "Open tickets",
  registerIcon: RegisterIcon = Ticket,
}: RoleEventDetailProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const isQrScan = searchParams?.get("qr") === "1"
  const isAttendee = role === "Attendee"
  const isAdmin = role === "Administrator"

  const { data: eventData, isLoading, isError } = useEvent(eventId)
  // Fetch the full ticket list, not the default page — registration state
  // must be computed from every ticket the user owns, otherwise an attendee
  // with more tickets than the default page size sees "Register" on an
  // event they've already joined (and the server correctly 400s).
  const { data: ticketData } = useMyTickets({ limit: 100 })
  const { data: userData } = useCurrentUser()
  const { data: paymentConfig } = usePaymentConfig()
  const registerMutation = useRegisterForEvent()
  const cancelMutation = useCancelTicket()
  const checkoutMutation = useCreateCheckoutSession()
  const esewaMutation = useInitiateEsewaPayment()
  const updateLocation = useUpdateLocation()
  const updateEvent = useUpdateEvent()
  const deleteEvent = useDeleteEvent()
  const { data: sessionsData } = useEventSessions(eventId)
  const createSession = useCreateSession(eventId)
  const updateSession = useUpdateSession(eventId)
  const deleteSession = useDeleteSession(eventId)
  // Speakers are org-scoped (requireOrgAdmin → 403 for attendee without org). The SessionsPanel only needs them when the viewer can actually manage sessions, so skip the fetch for Attendees to avoid expected 403 + global toast.
  const { data: orgSpeakers } = useOrganizationSpeakers({ enabled: !isAttendee })
  // Save/bookmark. Signed-in users get the server-side saved list (follows
  // the account across devices); guests fall back to localStorage via the
  // same helper the /saved-events page uses.
  const [localSaved, setLocalSaved] = useState(() => isSaved(eventId))
  const { data: savedData } = useSavedEvents()
  const addSaved = useAddSavedEvent()
  const removeSaved = useRemoveSavedEvent()
  const saved = savedData
    ? savedData.savedEvents.some((e) => e._id === eventId)
    : localSaved
  const toggleSave = () => {
    if (!currentUser) {
      setLocalSaved(toggleSaved(eventId))
      return
    }
    if (saved) removeSaved.mutate(eventId)
    else addSaved.mutate(eventId)
  }

  const [showShareFeedback, setShowShareFeedback] = useState(false)
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)

  // Organizer/admin workspace tabs — the workspace concept, proper: one hub
  // with clear sections instead of one long scrolling page of panels.
  const workspaceTabs = [
    { id: "Overview", icon: Sparkles },
    { id: "Schedule", icon: Calendar },
    { id: "Attendees & Payments", icon: Users },
    { id: "Reminders", icon: Bell },
    { id: "AI Insights", icon: Brain },
  ] as const
  const [wsTab, setWsTab] = useState<(typeof workspaceTabs)[number]["id"]>("Overview")
  const rosterSectionRef = useRef<HTMLDivElement>(null)

  const event = eventData?.event
  const tickets = ticketData?.tickets ?? []
  const currentUser = userData?.user

  const registeredTicket = tickets.find((t) => {
    const ev = typeof t.event === "object" ? t.event : null
    return ev?._id === eventId
  })
  const isRegistered = !!registeredTicket && registeredTicket.status !== "cancelled"

  if (isLoading) {
    return (
      <AppShell role={role} userName={userName} title={title}>
        <div className="flex items-center justify-center py-24">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      </AppShell>
    )
  }

  if (isError || !event) {
    return (
      <AppShell role={role} userName={userName} title={title}>
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <h2 className="text-lg font-semibold">Event not found</h2>
          <p className="mt-1 text-sm text-muted-foreground">This event may have been removed or the link is incorrect.</p>
          <Link href={backHref} className="mt-4 text-sm font-medium text-primary hover:underline">Go back</Link>
        </div>
      </AppShell>
    )
  }

  const pct = event.capacity > 0 ? Math.round((event.registered / event.capacity) * 100) : 0
  const isFull = event.registered >= event.capacity
  const isPast = new Date(event.date) <= new Date()
  const free = isFreeEvent(event.price)

  // Mirrors the backend's canManageEvent exactly (eventController.js) so
  // the management tabs (Attendees & Payments, Schedule, Reminders, AI
  // Insights) are simply never shown to a non-attendee viewer who can't
  // actually use them — an organizer/org admin/system admin browsing an
  // event outside their own scope used to see the tab, click it, and get
  // a raw 403 error box instead of the tab not being there at all.
  const organizerId = event.organizer && typeof event.organizer === "object" ? (event.organizer as any)._id : event.organizer
  const eventOrgId = event.organization && typeof event.organization === "object" ? (event.organization as any)._id : event.organization
  const coHostIds = (event.coHostOrganizations ?? []).map((o) => (o && typeof o === "object" ? (o as any)._id : o)).filter(Boolean)
  const isOwner = !!currentUser && organizerId === currentUser._id
  const isSystemAdmin = currentUser?.role === "admin" && !currentUser.organization
  const isOrgAdmin =
    currentUser?.role === "org_admin" && !!currentUser.organization && eventOrgId === currentUser.organization
  const isCoHostAdmin =
    currentUser?.role === "org_admin" && !!currentUser.organization && coHostIds.includes(currentUser.organization)
  const canManage = isOwner || isSystemAdmin || isOrgAdmin || isCoHostAdmin
  // Mirrors the backend's separate, stricter isOwningOrgManager — co-host
  // admins can manage everything else about an event but must never delete
  // it (deletion is an ownership action).
  const canDelete = isOwner || isSystemAdmin || isOrgAdmin

  const userHasLocation = currentUser?.location?.lat != null
  const distance =
    userHasLocation && event.coordinates?.lat != null
      ? distanceKm(currentUser!.location as any, event.coordinates as any)
      : null

  const handlePrimaryAction = async () => {
    if (!isAttendee) {
      // The workspace primary action opens the operational tab in place —
      // jumping to the roster + check-in shortcut rather than leaving the
      // event hub. The QR-scan hub stays reachable from the roster card.
      // Only when the viewer can actually manage THIS event — otherwise
      // this used to unconditionally jump to a tab that isn't even in the
      // now-filtered tab bar and would just 403 on fetch.
      if (canManage) {
        setWsTab("Attendees & Payments")
        requestAnimationFrame(() =>
          rosterSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
        )
      }
      return
    }
    if (isRegistered) {
      router.push(ticketHref)
      return
    }
    if (!free) {
      checkoutMutation.mutate(eventId, {
        onSuccess: (res) => {
          window.location.href = res.url
        },
      })
      return
    }
    registerMutation.mutate(eventId, {
      onSuccess: () => {
        router.push(ticketHref)
      },
    })
  }

  const handlePayWithStripe = () => {
    checkoutMutation.mutate(eventId, {
      onSuccess: (res) => {
        window.location.href = res.url
      },
    })
  }

  const handlePayWithEsewa = () => {
    esewaMutation.mutate(eventId, {
      onSuccess: (res) => submitEsewaForm(res.action, res.fields),
    })
  }

  const handleCancel = () => {
    if (!registeredTicket) return
    cancelMutation.mutate(registeredTicket._id, {
      onSuccess: () => setConfirmingCancel(false),
    })
  }

  // Permanently removes the event (cascades its tickets and notifications
  // server-side) and returns to the management list.
  const handleDelete = () => {
    deleteEvent.mutate(eventId, {
      onSuccess: () => router.push(backHref),
    })
  }

  // /event/:id (singular) is the one real event-detail route — it renders
  // fine with no session (RoleEventDetail defaults to the Attendee view
  // when useCurrentUser() has no user), so it's safe to share/QR-encode
  // directly; there's no separate "public" route anymore.
  const publicUrl = typeof window !== "undefined" ? `${window.location.origin}/event/${eventId}` : ""

  const handleShare = async () => {
    if (!publicUrl) {
      toast.error("Link not ready")
      return
    }
    if (navigator.share) {
      try {
        await navigator.share({
          title: event.title,
          text: `Check out ${event.title} on EventNexus!`,
          url: publicUrl,
        })
        return
      } catch (e: any) {
        // AbortError means user cancelled share sheet — don't fallback to copy
        if (e?.name === "AbortError") return
      }
    }
    // Fallback to clipboard with http support
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(publicUrl)
      } else {
        const ta = document.createElement("textarea")
        ta.value = publicUrl
        ta.setAttribute("readonly", "")
        ta.style.position = "fixed"
        ta.style.opacity = "0"
        document.body.appendChild(ta)
        ta.select()
        const ok = document.execCommand("copy")
        document.body.removeChild(ta)
        if (!ok) throw new Error("copy failed")
      }
      toast.success("Link copied")
      setShowShareFeedback(true)
      setTimeout(() => setShowShareFeedback(false), 2000)
    } catch {
      try { window.prompt("Copy this link:", publicUrl) } catch {}
      toast.error("Copy failed — please copy manually")
    }
  }

  const aiInsight = (() => {
    const fillRate = event.capacity > 0 ? event.registered / event.capacity : 0
    const daysUntil = Math.max(0, Math.ceil((new Date(event.date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)))

    if (isPast) {
      return `This event has concluded with ${event.registered}/${event.capacity} registered (${pct}% of capacity).`
    }
    if (fillRate > 0.8) return `${event.title} is nearly full at ${pct}% capacity. Register soon to secure a spot.`
    if (fillRate > 0.5) {
      return `Filling steadily at ${pct}% capacity, with ${daysUntil} day${daysUntil === 1 ? "" : "s"} to go — spots are going fast.`
    }
    if (fillRate > 0.2) {
      return `${event.capacity - event.registered} spots left. Good availability, but early registration is recommended.`
    }
    return "Plenty of availability right now — a great time to register."
  })()

  const canLeaveFeedback = isAttendee && isPast && isRegistered

  const primaryLabel = (() => {
    if (!isAttendee) return registerLabel
    if (isRegistered) return "View my ticket"
    if (isPast) return "Event concluded"
    if (isFull) return "Event full"
    if (!free) return `Buy ticket — ${formatPrice(event.price)}`
    return registerLabel
  })()

  const primaryPending = isAttendee && (registerMutation.isPending || checkoutMutation.isPending)
  // For a non-attendee, this button jumps to the roster tab — disabled when
  // they can't manage this event, since there's now nowhere for it to go.
  const primaryDisabled = isAttendee ? primaryPending || isPast || (isFull && !isRegistered) : !canManage

  // Paid events offer a choice of rail instead of a single generic "Buy
  // ticket" button: eSewa settles natively in NPR (works out of the box —
  // see utils/esewa.js's sandbox defaults), Stripe can't settle in NPR so
  // Stripe can't settle NPR, so NPR events are billed in converted USD (see currency.js: floor $0.50).
  // eSewa only handles NPR — hide eSewa for non-NPR events
  const isNprEvent = ((event.price?.currency || "NPR") as string).toUpperCase() === "NPR"
  const showPaymentChoice = isAttendee && !isRegistered && !isFull && !isPast && !free
  const usdEstimate =
    isNprEvent && paymentConfig?.nprUsdRate && event.price?.amount != null
      ? Math.max(0.5, Math.round((Number(event.price.amount) / paymentConfig.nprUsdRate) * 100) / 100).toFixed(2)
      : null
  return (
    <AppShell role={role} userName={userName} title={title}>
      <div className="space-y-6">
        {isQrScan && (
          <div className="flex items-center gap-3 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3">
            <span className="flex size-8 items-center justify-center rounded-xl bg-primary text-white">
              <QrIcon className="size-4" />
            </span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-ink flex items-center gap-1.5">
                <Sparkles className="size-3.5 text-primary" /> QR scan verified — {event.title}
              </p>
              <p className="text-xs text-muted-foreground">
                {isRegistered ? "Your ticket is ready below. Present the QR at check-in." : "Full event details and registration are right here."}
              </p>
            </div>
          </div>
        )}
        <Link
          href={backHref}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-ink"
        >
          <ArrowLeft className="size-4" /> {backLabel}
        </Link>

        <Reveal y={18}>
          <div className="relative h-64 overflow-hidden rounded-2xl bg-primary/10">
            {event.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={event.imageUrl} alt={event.title} className="h-full w-full object-cover" />
            ) : (
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.3),transparent_55%)]" />
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 p-6 text-white">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-ink">{event.category}</span>
                <span className="rounded-full bg-black/25 px-3 py-1 text-xs font-medium backdrop-blur">{event.type}</span>
                {distance != null && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-black/25 px-3 py-1 text-xs font-medium backdrop-blur">
                    <MapPin className="size-3" /> {distance < 1 ? `${Math.round(distance * 1000)}m away` : `${distance.toFixed(1)} km away`}
                  </span>
                )}
                {isPast && (
                  <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-medium backdrop-blur">Concluded</span>
                )}
              </div>
              <h1 className="font-display mt-3 text-3xl font-bold">{event.title}</h1>
              <p className="mt-1 text-sm text-white/85">
                Hosted by{" "}
                {(typeof event.organizer === "object" && event.organizer?.name) || "Organizer"}
              </p>
              {event.tags?.length ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {event.tags.map((t) => (
                    <span key={t} className="rounded-full bg-white/[0.15] px-2.5 py-0.5 text-[11px] font-medium backdrop-blur">
                      {t}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </Reveal>

        {!isAttendee && (
          <Reveal y={12} className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-card p-1">
            {/* Only "Overview" is shown to a non-attendee who can't manage
                THIS specific event (e.g. a system admin/org admin browsing
                an event outside their own scope) — the other tabs all fetch
                management-only data server-side and would just 403. */}
            {workspaceTabs.filter((t) => t.id === "Overview" || canManage).map((t) => {
              const active = wsTab === t.id
              const Icon = t.icon
              return (
                <button
                  key={t.id}
                  onClick={() => setWsTab(t.id)}
                  className={`flex shrink-0 items-center gap-1.5 rounded-lg px-3.5 py-2 text-sm font-semibold transition-all ${
                    active ? "bg-ink text-white" : "text-muted-foreground hover:bg-muted hover:text-ink"
                  }`}
                >
                  <Icon className="size-4" /> {t.id}
                </button>
              )
            })}
          </Reveal>
        )}

        {/* Event management: edit the listing or delete it. Only shown to a
            viewer who can actually act on THIS event — matches the backend's
            canManageEvent/isOwningOrgManager exactly, so this never renders
            a button that's guaranteed to 403 on click. */}
        {canManage && (
          <Reveal y={12} className="flex flex-wrap items-center gap-2">
            <Link
              href={`/organizer/events/${eventId}/edit`}
              className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:border-primary/40 hover:text-primary"
            >
              <Edit className="size-3.5" /> Edit event
            </Link>
            {canDelete &&
              (confirmingDelete ? (
                <div className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2">
                  <span className="text-xs font-medium text-ink">Delete this event permanently?</span>
                  <button
                    onClick={handleDelete}
                    disabled={deleteEvent.isPending}
                    className="flex items-center gap-1 rounded-lg bg-destructive px-2.5 py-1 text-xs font-semibold text-destructive-foreground disabled:opacity-60"
                  >
                    {deleteEvent.isPending && <Loader2 className="size-3 animate-spin" />}
                    Yes, delete
                  </button>
                  <button
                    onClick={() => setConfirmingDelete(false)}
                    className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-ink hover:bg-muted"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmingDelete(true)}
                  className="flex items-center gap-1.5 rounded-xl border border-border bg-card px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:border-destructive/40 hover:text-destructive"
                >
                  <Trash2 className="size-3.5" /> Delete
                </button>
              ))}
            {deleteEvent.isError && (
              <span className="text-xs text-destructive">
                {(deleteEvent.error as any)?.response?.data?.message || "Couldn't delete the event."}
              </span>
            )}
          </Reveal>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            {isAttendee || wsTab === "Overview" ? (
              <>
            <Reveal>
              <div className="rounded-2xl border border-border bg-card p-6">
                <h2 className="font-display text-lg font-bold text-ink">About this event</h2>
                <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                  {event.description || `Join us for ${event.title}, a ${(event.category || "Event").toLowerCase()} gathering bringing together builders, leaders, and innovators.`}
                </p>
                <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
                  {[
                    { icon: Calendar, label: "Date", value: new Date(event.date).toLocaleDateString("en-US", { dateStyle: "medium" }) },
                    { icon: Clock, label: "Time", value: new Date(event.date).toLocaleTimeString("en-US", { timeStyle: "short" }) },
                    { icon: MapPin, label: "Venue", value: event.venue },
                    { icon: Users, label: "Registered", value: `${event.registered}/${event.capacity}` },
                  ].map((meta) => (
                    <div key={meta.label} className="rounded-xl bg-muted/50 p-3">
                      <meta.icon className="size-4 text-primary" />
                      <div className="mt-2 text-xs text-muted-foreground">{meta.label}</div>
                      <div className="text-sm font-semibold text-ink">{meta.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>

            {!!event.highlights?.length && (
              <Reveal>
                <div className="rounded-2xl border border-border bg-card p-6">
                  <h2 className="flex items-center gap-1.5 font-display text-lg font-bold text-ink">
                    <Sparkles className="size-4 text-primary" /> What to expect
                  </h2>
                  <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                    {event.highlights.map((h, idx) => (
                      <li key={idx} className="flex items-start gap-2 rounded-xl bg-muted/40 p-3 text-sm text-ink">
                        <Check className="mt-0.5 size-4 shrink-0 text-secondary" /> {h}
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            )}

            {!!event.agenda?.length && (
              <Reveal>
                <div className="rounded-2xl border border-border bg-card p-6">
                  <h2 className="flex items-center gap-1.5 font-display text-lg font-bold text-ink">
                    <ListChecks className="size-4 text-primary" /> Agenda
                  </h2>
                  <ol className="mt-4 space-y-4 border-l-2 border-border pl-4">
                    {event.agenda.map((item, idx) => (
                      <li key={idx} className="relative">
                        <span className="absolute -left-[21px] top-1 size-2.5 rounded-full bg-primary" />
                        <div className="text-xs font-semibold uppercase tracking-wide text-primary">{item.time}</div>
                        <div className="text-sm font-semibold text-ink">{item.title}</div>
                        {item.description && <p className="mt-0.5 text-sm text-muted-foreground">{item.description}</p>}
                      </li>
                    ))}
                  </ol>
                </div>
              </Reveal>
            )}

            {!!event.speakers?.length && (
              <Reveal>
                <div className="rounded-2xl border border-border bg-card p-6">
                  <h2 className="font-display text-lg font-bold text-ink">Speakers & Hosts</h2>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    {event.speakers.map((sp, idx) => (
                      <div key={idx} className="flex gap-3 rounded-xl bg-muted/40 p-4">
                        <div className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 font-display text-sm font-bold text-primary">
                          {sp.name.slice(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <div className="text-sm font-semibold text-ink">{sp.name}</div>
                          {sp.role && <div className="text-xs text-primary">{sp.role}</div>}
                          {sp.bio && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{sp.bio}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </Reveal>
            )}

            {(event.requirements || event.refundPolicy || event.contactEmail || event.contactPhone || event.website) && (
              <Reveal>
                <div className="rounded-2xl border border-border bg-card p-6">
                  <h2 className="font-display text-lg font-bold text-ink">Good to know</h2>
                  <div className="mt-4 space-y-4">
                    {event.requirements && (
                      <div>
                        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">What to bring</div>
                        <p className="mt-1 text-sm text-ink">{event.requirements}</p>
                      </div>
                    )}
                    {event.refundPolicy && (
                      <div className="flex gap-2">
                        <RotateCcw className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                        <div>
                          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Refund policy</div>
                          <p className="mt-1 text-sm text-ink">{event.refundPolicy}</p>
                        </div>
                      </div>
                    )}
                    {(event.contactEmail || event.contactPhone || event.website) && (
                      <div className="flex flex-wrap gap-3 border-t border-border pt-4 text-sm">
                        {event.contactEmail && (
                          <a href={`mailto:${event.contactEmail}`} className="flex items-center gap-1.5 text-primary hover:underline">
                            <Mail className="size-3.5" /> {event.contactEmail}
                          </a>
                        )}
                        {event.contactPhone && (
                          <a href={`tel:${event.contactPhone}`} className="flex items-center gap-1.5 text-primary hover:underline">
                            <Phone className="size-3.5" /> {event.contactPhone}
                          </a>
                        )}
                        {event.website && (
                          <a href={event.website} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1.5 text-primary hover:underline">
                            <Globe className="size-3.5" /> Website
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </Reveal>
            )}

            {event.coordinates?.lat != null && event.coordinates?.lng != null && (
              <Reveal>
                <VenueMap lat={event.coordinates.lat} lng={event.coordinates.lng} venue={event.venue} />
              </Reveal>
            )}

            {canManage && (
              <Reveal>
                <EventQrPoster eventId={eventId} eventTitle={event.title} event={event} ticket={registeredTicket ?? null} role={role} />
              </Reveal>
            )}

            {/* Attendee sees agenda as read-only (already above), not the organizer SessionsPanel CRUD */}
            {false && isAttendee && (
              <Reveal>
                <SessionsPanel event={event} sessions={sessionsData} createSession={createSession} updateSession={updateSession} deleteSession={deleteSession} orgSpeakers={orgSpeakers?.speakers ?? []} />
              </Reveal>
            )}
              </>
            ) : null}

            {!isAttendee && wsTab === "Schedule" && (
              <SessionsPanel event={event} sessions={sessionsData} createSession={createSession} updateSession={updateSession} deleteSession={deleteSession} orgSpeakers={orgSpeakers?.speakers ?? []} />
            )}

            {!isAttendee && wsTab === "Reminders" && (
              <RemindersPanel event={event} onUpdate={updateEvent.mutate} />
            )}

            {!isAttendee && wsTab === "Attendees & Payments" && (
              <div ref={rosterSectionRef} className="scroll-mt-24 rounded-2xl border border-border bg-card p-6">
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <Users className="size-5 text-primary" />
                    <h2 className="font-display text-lg font-bold text-ink">Attendance & Payments</h2>
                  </div>
                  {!isAdmin && (
                    <Link
                      href={ticketHref}
                      className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                    >
                      Full check-in workspace <ArrowUpRight className="size-3.5" />
                    </Link>
                  )}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  Every registration for this event with its ticket status, payment rail, and
                  ledger amount — searchable and filterable.
                </p>
                <AttendeeRoster eventId={eventId} isOpen />
              </div>
            )}

            {!isAttendee && wsTab === "AI Insights" && (
              <EventAiInsights eventId={eventId} />
            )}

            {!isAttendee && wsTab === "Overview" && <FeedbackSummaryPanel eventId={eventId} />}

            {isAttendee && canLeaveFeedback && (
              <Reveal>
                <FeedbackForm eventId={eventId} />
              </Reveal>
            )}

            {isAttendee && !isPast && (
              <Reveal>
                <NetworkingPanel eventId={eventId} isRegistered={isRegistered} />
              </Reveal>
            )}
          </div>

          <div>
            <Reveal x={20} y={0}>
              <div className="sticky top-24 rounded-2xl border border-border bg-card p-6 shadow-[0_2px_24px_rgba(0,0,0,0.05)]">
                <div className="flex items-baseline justify-between">
                  <span className="font-display text-3xl font-extrabold text-ink">{formatPrice(event.price)}</span>
                  <span className="text-xs text-muted-foreground">per ticket</span>
                </div>

                <div className="mt-4">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{pct}% full</span>
                    <span>{Math.max(0, event.capacity - event.registered)} spots left</span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className={`h-full rounded-full transition-all ${isFull ? "bg-flame" : "bg-primary"}`}
                      style={{ width: `${Math.min(100, pct)}%` }}
                    />
                  </div>
                </div>

                {isAttendee && isRegistered && registeredTicket && registeredTicket.status === "valid" && (
                  <div className="mt-4 flex flex-col items-center rounded-xl border border-border bg-muted/30 p-4">
                    <QrCode seed={registeredTicket.qrToken} size={120} />
                    <p className="mt-2 text-center text-[11px] text-muted-foreground">
                      Ticket #{registeredTicket._id.slice(-8).toUpperCase()} — present at check-in
                    </p>
                  </div>
                )}

                {showPaymentChoice ? (
                  <div className="mt-5 space-y-2">
                    {isNprEvent && (
                      <button
                        onClick={handlePayWithEsewa}
                        disabled={esewaMutation.isPending || checkoutMutation.isPending}
                        className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#60bb46] px-4 py-3 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-60"
                      >
                        {esewaMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Wallet className="size-4" />}
                        Pay with eSewa — {formatPrice(event.price)}
                      </button>
                    )}
                    <button
                      onClick={handlePayWithStripe}
                      disabled={checkoutMutation.isPending || esewaMutation.isPending || paymentConfig?.enabled === false || !paymentConfig}
                      className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm font-semibold text-ink transition-all hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-60"
                    >
                      {checkoutMutation.isPending ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <CreditCard className="size-4" />
                      )}
                      Pay by card{usdEstimate ? ` — ~$${usdEstimate}` : ` — ${formatPrice(event.price)}`}{!isNprEvent ? "" : ""}
                    </button>
                    {isNprEvent && (
                      <p className="text-center text-[11px] text-muted-foreground">
                        Card payments are billed in USD (Stripe doesn&apos;t settle in NPR); eSewa charges the exact NPR price.
                      </p>
                    )}
                    {paymentConfig?.enabled === false && (
                      <p className="text-center text-[11px] text-amber-600">Card payments aren&apos;t configured on this server yet.</p>
                    )}
                  </div>
                ) : (
                  <button
                    onClick={handlePrimaryAction}
                    disabled={primaryDisabled}
                    className={`mt-5 flex w-full items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold transition-all ${
                      isAttendee && isRegistered
                        ? "bg-secondary text-secondary-foreground"
                        : isAttendee && (isFull || isPast)
                          ? "bg-muted text-muted-foreground cursor-not-allowed"
                          : "bg-primary text-primary-foreground hover:-translate-y-0.5 shadow-[0_8px_20px_-10px_rgba(91,76,245,0.8)]"
                    }`}
                  >
                    {primaryPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : isAttendee && isRegistered ? (
                      <>
                        <Check className="size-4" /> {primaryLabel}
                      </>
                    ) : (
                      <>
                        <RegisterIcon className="size-4" /> {primaryLabel}
                      </>
                    )}
                  </button>
                )}

                {(registerMutation.isError || checkoutMutation.isError || esewaMutation.isError) && (
                  <p className="mt-2 text-xs text-amber-600">
                    {(registerMutation.error as any)?.response?.data?.message ||
                      (checkoutMutation.error as any)?.response?.data?.message ||
                      (esewaMutation.error as any)?.response?.data?.message ||
                      "Something went wrong"}
                  </p>
                )}

                {isAttendee && isRegistered && !isPast && registeredTicket?.status === "valid" && (
                  <div className="mt-2">
                    {confirmingCancel ? (
                      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
                        <p className="text-xs text-ink">Cancel your registration? This frees your spot for someone else.</p>
                        {cancelMutation.isError && (
                          <p className="mt-1 text-xs text-destructive">
                            {(cancelMutation.error as any)?.response?.data?.message || "Couldn't cancel"}
                          </p>
                        )}
                        <div className="mt-2 flex gap-2">
                          <button
                            onClick={handleCancel}
                            disabled={cancelMutation.isPending}
                            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-destructive px-3 py-2 text-xs font-semibold text-destructive-foreground disabled:opacity-60"
                          >
                            {cancelMutation.isPending && <Loader2 className="size-3.5 animate-spin" />}
                            Yes, cancel
                          </button>
                          <button
                            onClick={() => setConfirmingCancel(false)}
                            className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium text-ink hover:bg-muted"
                          >
                            <X className="size-3.5" /> Keep it
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setConfirmingCancel(true)}
                        className="w-full rounded-xl border border-border py-2 text-center text-xs font-medium text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
                      >
                        Cancel registration
                      </button>
                    )}
                  </div>
                )}

                <Link
                  href={isAttendee ? ticketHref : "#"}
                  onClick={(e) => {
                    if (!isAttendee) {
                      e.preventDefault()
                      setWsTab("Attendees & Payments")
                      requestAnimationFrame(() =>
                        rosterSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
                      )
                    }
                  }}
                  className="mt-2 block rounded-xl border border-border py-2.5 text-center text-sm font-medium text-ink transition-colors hover:bg-muted"
                >
                  {isAttendee && isRegistered
                    ? "View my ticket"
                    : isAttendee
                      ? "View related workspace"
                      : "Open workspace"}
                </Link>

                <div className="mt-3 flex gap-2">
                  <button
                    onClick={toggleSave}
                    disabled={addSaved.isPending || removeSaved.isPending}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg border py-2 text-sm font-medium transition-colors disabled:opacity-60 ${
                      saved ? "border-flame bg-flame/10 text-flame" : "border-border text-ink hover:bg-muted"
                    }`}
                  >
                    <Heart className={`size-4 ${saved ? "fill-flame" : ""}`} /> {saved ? "Saved" : "Save"}
                  </button>
                  <button
                    onClick={handleShare}
                    className="relative flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-sm font-medium text-ink transition-colors hover:bg-muted"
                  >
                    <Share2 className="size-4" /> {showShareFeedback ? "Copied!" : "Share"}
                  </button>
                </div>

                <div className="mt-5 rounded-xl bg-primary/5 p-3.5">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                    <Sparkles className="size-3.5" /> AI Insight
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{aiInsight}</p>
                </div>

                {isAttendee && !userHasLocation && (
                  <div className="mt-4 rounded-xl border border-dashed border-primary/30 bg-primary/[0.03] p-3.5">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                      <MapPin className="size-3.5" /> Enable location
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      Share your location to get distance info and better recommendations.
                    </p>
                    <button
                      onClick={() => updateLocation.mutate()}
                      disabled={updateLocation.isPending}
                      className="mt-2 w-full rounded-lg border border-primary/30 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                    >
                      {updateLocation.isPending ? (
                        <Loader2 className="mx-auto size-3.5 animate-spin" />
                      ) : (
                        "Update my location"
                      )}
                    </button>
                  </div>
                )}
              </div>
            </Reveal>
          </div>
        </div>
      </div>
    </AppShell>
  )
}