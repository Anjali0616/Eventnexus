"use client"

import { Suspense, use, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import {
  ArrowLeft,
  Calendar,
  Check,
  Clock,
  CreditCard,
  Globe,
  ListChecks,
  Loader2,
  LogIn,
  Mail,
  MapPin,
  Phone,
  RotateCcw,
  Share2,
  ShieldCheck,
  Sparkles,
  Ticket,
  Users,
  Wallet,
  X,
  XCircle,
} from "lucide-react"
import { Reveal } from "@/components/anim/reveal"
import { Logo } from "@/components/ui/logo"
import { QrCode } from "@/components/app/qr-code"
import { EventQrPoster } from "@/components/app/event-qr-poster"
import { VenueMap } from "@/components/app/venue-map"
import { useEvent } from "@/lib/queries/events"
import { useMyTickets, useRegisterForEvent, useCancelTicket } from "@/lib/queries/tickets"
import { useCurrentUser, roleRoutes } from "@/lib/queries/auth"
import { usePaymentConfig, useCreateCheckoutSession, useInitiateEsewaPayment } from "@/lib/queries/payments"
import { submitEsewaForm } from "@/lib/esewa"
import { formatPrice, isFreeEvent } from "@/lib/price"

// Reuses the single shared role→home map (lib/queries/auth) rather than a
// local copy: this duplicate was missing "org_admin", so an org admin got
// `undefined` for their dashboard href — a dead link.
const roleHome = roleRoutes

// Stripe redirects here with ?checkout=cancelled when the buyer abandons the
// checkout page — surface that clearly instead of a silent return to the
// event (previously nothing acknowledged the cancelled payment attempt).
function CheckoutCancelledBanner() {
  const params = useSearchParams()
  const [dismissed, setDismissed] = useState(false)
  if (params.get("checkout") !== "cancelled" || dismissed) return null
  return (
    <div className="flex items-center justify-between gap-3 rounded-2xl border border-amber-400/40 bg-amber-500/10 p-4 text-sm text-amber-700 dark:text-amber-300">
      <span className="flex items-center gap-2">
        <XCircle className="size-4 shrink-0" />
        You left checkout without paying — no charge was made. You can still register or buy a ticket below.
      </span>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="shrink-0 rounded-lg p-1 transition-colors hover:bg-amber-500/20"
      >
        <X className="size-4" />
      </button>
    </div>
  )
}

// Public, unauthenticated event page — the landing spot for the QR code on
// event posters/flyers. Anyone can view it; the sidebar CTA adapts to
// whether the visitor is signed out, a signed-in attendee, or the
// organizer/admin who owns the event.
export default function PublicEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: eventId } = use(params)

  const { data: eventData, isLoading, isError } = useEvent(eventId)
  const { data: userData } = useCurrentUser()
  const { data: ticketData } = useMyTickets({ limit: 100 })
  const { data: paymentConfig } = usePaymentConfig()
  const registerMutation = useRegisterForEvent()
  const cancelMutation = useCancelTicket()
  const checkoutMutation = useCreateCheckoutSession()
  const esewaMutation = useInitiateEsewaPayment()
  const [confirmingCancel, setConfirmingCancel] = useState(false)
  const [showShareFeedback, setShowShareFeedback] = useState(false)

  const event = eventData?.event
  const user = userData?.user
  const tickets = ticketData?.tickets ?? []

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    )
  }

  if (isError || !event) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background px-6 text-center">
        <p className="font-display text-lg font-bold text-ink">Event not found</p>
        <p className="text-sm text-muted-foreground">This event may have been removed or the link is incorrect.</p>
        <Link href="/events" className="text-sm font-semibold text-primary hover:underline">Browse events</Link>
      </div>
    )
  }

  const isAttendeeUser = user?.role === "attendee"
  const isStaffUser = user?.role === "organizer" || user?.role === "admin" || user?.role === "org_admin"

  const registeredTicket = tickets.find((t) => {
    const ev = typeof t.event === "object" ? t.event : null
    return ev?._id === eventId
  })
  const isRegistered = !!registeredTicket && registeredTicket.status !== "cancelled"

  const pct = event.capacity > 0 ? Math.round((event.registered / event.capacity) * 100) : 0
  const isFull = event.registered >= event.capacity
  const isPast = new Date(event.date) <= new Date()
  const free = isFreeEvent(event.price)

  const publicUrl = typeof window !== "undefined" ? window.location.href : ""

  const handleShare = async () => {
    if (!publicUrl) return
    if (navigator.share) {
      try {
        await navigator.share({ title: event.title, text: `Check out ${event.title} on EventNexus!`, url: publicUrl })
        return
      } catch (e: any) {
        if (e?.name === "AbortError") return
      }
    }
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
      setShowShareFeedback(true)
      setTimeout(() => setShowShareFeedback(false), 2000)
    } catch {
      try { window.prompt("Copy this link:", publicUrl) } catch {}
    }
  }

  const handlePrimaryAction = () => {
    if (isRegistered) return
    if (!free) {
      checkoutMutation.mutate(eventId, { onSuccess: (res) => { window.location.href = res.url } })
      return
    }
    registerMutation.mutate(eventId)
  }

  const handlePayWithStripe = () => {
    checkoutMutation.mutate(eventId, { onSuccess: (res) => { window.location.href = res.url } })
  }

  const handlePayWithEsewa = () => {
    esewaMutation.mutate(eventId, { onSuccess: (res) => submitEsewaForm(res.action, res.fields) })
  }

  const handleCancel = () => {
    if (!registeredTicket) return
    cancelMutation.mutate(registeredTicket._id, { onSuccess: () => setConfirmingCancel(false) })
  }

  const primaryLabel = isRegistered ? "You're registered" : isPast ? "Event concluded" : isFull ? "Event full" : !free ? `Buy ticket — ${formatPrice(event.price)}` : "Register now"
  const primaryPending = registerMutation.isPending || checkoutMutation.isPending
  const primaryDisabled = primaryPending || isRegistered || isPast || (isFull && !isRegistered)

  const showPaymentChoice = !isRegistered && !isFull && !isPast && !free
  const isNprEvent = ((event.price?.currency || "NPR") as string).toUpperCase() === "NPR"
  const usdEstimate =
    isNprEvent && paymentConfig?.nprUsdRate && event.price?.amount != null
      ? Math.max(0.5, Math.round((Number(event.price.amount) / paymentConfig.nprUsdRate) * 100) / 100).toFixed(2)
      : null

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-card/60 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-5xl items-center justify-between px-6">
          <Link href="/" className="flex items-center transition-opacity hover:opacity-80">
            <Logo className="h-7" />
          </Link>

          {user ? (
            <Link
              href={roleHome[user.role] || "/dashboard"}
              className="flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-muted"
            >
              Go to my dashboard
            </Link>
          ) : (
            <div className="flex items-center gap-2">
              <Link href="/login" className="rounded-full px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-muted">
                Sign in
              </Link>
              <Link
                href="/register"
                className="bg-brand-gradient rounded-full px-4 py-2 text-sm font-semibold text-primary-foreground shadow-[0_8px_20px_-10px_rgba(91,76,245,0.8)]"
              >
                Create free account
              </Link>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-ink">
          <ArrowLeft className="size-4" /> Back to EventNexus
        </Link>

        <Suspense fallback={null}>
          <CheckoutCancelledBanner />
        </Suspense>

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
                {isPast && <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-medium backdrop-blur">Concluded</span>}
              </div>
              <h1 className="font-display mt-3 text-3xl font-bold">{event.title}</h1>
              <p className="mt-1 text-sm text-white/85">
                Hosted by {(typeof event.organizer === "object" && event.organizer?.name) || "Organizer"}
              </p>
              {!!event.tags?.length && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {event.tags.map((t) => (
                    <span key={t} className="rounded-full bg-white/15 px-2.5 py-0.5 text-[11px] font-medium backdrop-blur">
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Reveal>

        {isStaffUser && (
          <Reveal>
            <div className="flex items-center gap-3 rounded-2xl border border-primary/20 bg-primary/[0.04] p-4 text-sm text-ink">
              <ShieldCheck className="size-4 shrink-0 text-primary" />
              <span>
                You&apos;re signed in as {user?.role}. This is the public view — manage this event from your{" "}
                <Link href={roleHome[user!.role]} className="font-semibold text-primary hover:underline">
                  dashboard
                </Link>
                .
              </span>
            </div>
          </Reveal>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
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

            <Reveal>
              <EventQrPoster eventId={eventId} eventTitle={event.title} />
            </Reveal>
          </div>

          <div>
            <Reveal x={20} y={0}>
              <div className="sticky top-8 rounded-2xl border border-border bg-card p-6 shadow-[0_2px_24px_rgba(0,0,0,0.05)]">
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
                    <div className={`h-full rounded-full ${isFull ? "bg-flame" : "bg-primary"}`} style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                </div>

                {isRegistered && registeredTicket && registeredTicket.status === "valid" && (
                  <div className="mt-4 flex flex-col items-center rounded-xl border border-border bg-muted/30 p-4">
                    <QrCode seed={registeredTicket.qrToken} size={120} />
                    <p className="mt-2 text-center text-[11px] text-muted-foreground">
                      Ticket #{registeredTicket._id.slice(-8).toUpperCase()} — present at check-in
                    </p>
                  </div>
                )}

                {!user && (
                  <div className="mt-5 rounded-xl border border-dashed border-primary/30 bg-primary/[0.03] p-4 text-center">
                    <LogIn className="mx-auto size-4 text-primary" />
                    <p className="mt-2 text-xs text-muted-foreground">Sign in to register — it takes under a minute.</p>
                    <div className="mt-3 flex gap-2">
                      <Link href="/login" className="flex-1 rounded-lg border border-border py-2 text-center text-xs font-medium text-ink hover:bg-muted">
                        Sign in
                      </Link>
                      <Link href="/register" className="bg-brand-gradient flex-1 rounded-lg py-2 text-center text-xs font-semibold text-primary-foreground">
                        Create account
                      </Link>
                    </div>
                  </div>
                )}

                {isAttendeeUser && (
                  <>
                    {showPaymentChoice ? (
                      <div className="mt-5 space-y-2">
                        <button
                          onClick={handlePayWithEsewa}
                          disabled={esewaMutation.isPending || checkoutMutation.isPending}
                          className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#60bb46] px-4 py-3 text-sm font-semibold text-white transition-all hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-60"
                        >
                          {esewaMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Wallet className="size-4" />}
                          Pay with eSewa — {formatPrice(event.price)}
                        </button>
                        <button
                          onClick={handlePayWithStripe}
                          disabled={checkoutMutation.isPending || esewaMutation.isPending || paymentConfig?.enabled === false || !paymentConfig}
                          className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm font-semibold text-ink transition-all hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-60"
                        >
                          {checkoutMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
                          Pay by card{usdEstimate ? ` — ~$${usdEstimate}` : ` — ${formatPrice(event.price)}`}
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
                          isRegistered
                            ? "bg-secondary text-secondary-foreground"
                            : isFull
                              ? "bg-muted text-muted-foreground cursor-not-allowed"
                              : "bg-primary text-primary-foreground hover:-translate-y-0.5 shadow-[0_8px_20px_-10px_rgba(91,76,245,0.8)]"
                        }`}
                      >
                        {primaryPending ? <Loader2 className="size-4 animate-spin" /> : isRegistered ? <Check className="size-4" /> : <Ticket className="size-4" />}
                        {primaryLabel}
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

                    {isRegistered && (
                      <Link href="/my-tickets" className="mt-2 block rounded-xl border border-border py-2.5 text-center text-sm font-medium text-ink transition-colors hover:bg-muted">
                        View my ticket
                      </Link>
                    )}

                    {isRegistered && !isPast && registeredTicket?.status === "valid" && (
                      <div className="mt-2">
                        {confirmingCancel ? (
                          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3">
                            <p className="text-xs text-ink">Cancel your registration?</p>
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
                  </>
                )}

                <button
                  onClick={handleShare}
                  className="relative mt-3 flex w-full items-center justify-center gap-1.5 rounded-lg border border-border py-2 text-sm font-medium text-ink transition-colors hover:bg-muted"
                >
                  <Share2 className="size-4" /> {showShareFeedback ? "Copied!" : "Share this event"}
                </button>

                <div className="mt-5 rounded-xl bg-primary/5 p-3.5">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-primary">
                    <Sparkles className="size-3.5" /> AI Insight
                  </div>
                  <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
                    {isPast
                      ? `This event has concluded with ${event.registered}/${event.capacity} registered (${pct}% of capacity).`
                      : pct > 80
                        ? `Nearly full at ${pct}% capacity — register soon to secure a spot.`
                        : `${Math.max(0, event.capacity - event.registered)} spots left, ${pct}% full.`}
                  </p>
                </div>
              </div>
            </Reveal>
          </div>
        </div>
      </main>
    </div>
  )
}
