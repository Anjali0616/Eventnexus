"use client"

import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import {
  ArrowLeft,
  Calendar,
  Clock,
  Hexagon,
  Loader2,
  MapPin,
  Ticket,
  Users,
  QrCode,
  Sparkles,
  Check,
  Share2,
} from "lucide-react"
import { Reveal } from "@/components/anim/reveal"
import { useEvent } from "@/lib/queries/events"
import { formatPrice, isFreeEvent } from "@/lib/price"
import { hasQrHint, buildShareText, buildWhatsAppUrl } from "@/lib/qr"
import { useHasToken } from "@/lib/hooks/use-has-token"
import { useCurrentUser } from "@/lib/queries/auth"

// The landing experience for a signed-out visitor who scans an event's QR
// code (see event-qr-poster.tsx) or opens its public link cold.
//
// Before this, `/event/[id]` always rendered RoleEventDetail inside the full
// AppShell — sidebar, topbar search, notification bell, chatbot FAB — even
// for someone who had never opened the app before and wasn't signed in. That
// shell is built for a returning user managing their account; for a
// first-time scanner it's dead weight (half the sidebar links require an
// account they don't have yet) and buries the two things that actually
// matter — what is this event, and how do I join — under app chrome.
//
// This is a focused, standalone page instead: no sidebar, one clear
// description, one clear action. "Join Event" sends a signed-out visitor to
// register (carrying a validated `redirect` back to this exact event — see
// lib/event-redirect.ts), so completing the sign-up returns them straight
// here instead of dropping them on a generic dashboard.
//
// Once authenticated, `/event/[id]/page.tsx` switches to the full
// RoleEventDetail experience, which already owns the real registration flow
// (capacity checks, payment, ticket issuance) — this page never duplicates
// that logic, it only gets a signed-out visitor to the point of being able
// to use it.
export function PublicEventLanding({ eventId }: { eventId: string }) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const isQrScan = hasQrHint(searchParams)
  const hasToken = useHasToken()
  const { data: userData } = useCurrentUser()
  const currentUser = userData?.user
  const { data, isLoading, isError } = useEvent(eventId)
  const event = data?.event

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
        <p className="text-sm text-muted-foreground">
          This event may have been removed, or the link is incorrect.
        </p>
        <Link href="/events" className="text-sm font-semibold text-primary hover:underline">
          Browse events instead
        </Link>
      </div>
    )
  }

  const free = isFreeEvent(event.price)
  const eventDate = new Date(event.date)
  const isPast = eventDate <= new Date()
  const isFull = event.registered >= event.capacity
  // Preserve QR context through auth flow so banner stays after login/register
  const qrSuffix = isQrScan ? "?qr=1" : ""
  const redirectParam = `?redirect=${encodeURIComponent(`/event/${eventId}${qrSuffix}`)}`
  const handleJoinClick = () => {
    // Already logged in — never create a new account or switch role.
    // Send them straight to the authenticated event page where register happens as ticket, not account.
    if (hasToken && currentUser) {
      router.push(`/event/${eventId}${qrSuffix}`)
      return
    }
    router.push(`/register${redirectParam}`)
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Minimal header — brand + a way back out, deliberately not the full
          app sidebar/topbar a first-time visitor has no use for yet. */}
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <Link href="/" className="flex items-center gap-2 transition-opacity hover:opacity-80">
            <span className="bg-brand-gradient flex size-8 items-center justify-center rounded-lg text-white">
              <Hexagon className="size-5" strokeWidth={2.5} />
            </span>
            <span className="font-display text-lg font-bold text-ink">EventNexus</span>
          </Link>
          <Link
            href={`/login${redirectParam}`}
            className="text-sm font-medium text-muted-foreground transition-colors hover:text-ink"
          >
            Already have an account? Log in
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-6 py-10">
        {isQrScan && event && (
          <Reveal>
            <div className="mb-6 flex items-center gap-3 rounded-2xl border border-primary/20 bg-primary/5 px-4 py-3">
              <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-white">
                <QrCode className="size-4" />
              </span>
              <div className="flex-1">
                <p className="text-sm font-semibold text-ink flex items-center gap-1.5">
                  <Sparkles className="size-3.5 text-primary" /> You scanned the QR for “{event.title}”
                </p>
                <p className="text-xs text-muted-foreground">Preview the event below and tap Join to register instantly. No extra steps.</p>
              </div>
              <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs font-medium text-primary border border-primary/20">
                <Check className="size-3" /> QR verified
              </span>
            </div>
          </Reveal>
        )}
        <Reveal>
          {event.imageUrl && (
            <div className="mb-6 aspect-video w-full overflow-hidden rounded-2xl bg-muted">
              {/* eslint-disable-next-line @next/next/no-img-element -- data URLs, next/image can't optimize these */}
              <img src={event.imageUrl} alt={event.title} className="size-full object-cover" />
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary">
              {event.category}
            </span>
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
              {event.type}
            </span>
            {isPast && (
              <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">
                Concluded
              </span>
            )}
          </div>

          <h1 className="font-display mt-3 text-3xl font-bold tracking-tight text-ink">
            {event.title}
          </h1>

          {/* Key facts up top — a scanner glancing at their phone shouldn't
              have to read the full description to find the date. */}
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-xl border border-border bg-card p-3">
              <Calendar className="size-4 text-primary" />
              <p className="mt-1.5 text-xs font-medium text-ink">
                {eventDate.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {eventDate.toLocaleDateString("en-US", { year: "numeric" })}
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-3">
              <Clock className="size-4 text-primary" />
              <p className="mt-1.5 text-xs font-medium text-ink">
                {eventDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
              </p>
              <p className="text-[11px] text-muted-foreground">Start time</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-3">
              <MapPin className="size-4 text-primary" />
              <p className="mt-1.5 truncate text-xs font-medium text-ink" title={event.venue}>
                {event.venue}
              </p>
              <p className="text-[11px] text-muted-foreground">Venue</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-3">
              <Users className="size-4 text-primary" />
              <p className="mt-1.5 text-xs font-medium text-ink">
                {isFull ? "Full" : `${event.capacity - event.registered} left`}
              </p>
              <p className="text-[11px] text-muted-foreground">of {event.capacity} spots</p>
            </div>
          </div>

          {/* The description — this is the piece that used to be buried
              under a whole app shell instead of being front and center. */}
          <div className="mt-8 rounded-2xl border border-border bg-card p-6">
            <h2 className="font-display text-lg font-bold text-ink">About this event</h2>
            <p className="mt-3 whitespace-pre-line text-sm leading-relaxed text-muted-foreground">
              {event.description ||
                `Join us for ${event.title}, a ${event.category.toLowerCase()} gathering bringing together builders, leaders, and innovators.`}
            </p>

            {event.highlights && event.highlights.length > 0 && (
              <ul className="mt-4 space-y-1.5">
                {event.highlights.map((h, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-ink">
                    <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
                    {h}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* QR-aware quick details — when scanned, surface full event meta so user can decide before registering */}
          {isQrScan && (
            <div className="mt-6 rounded-2xl border border-border bg-card p-5">
              <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
                <QrCode className="size-4 text-primary" /> Scan & Go
              </h3>
              <p className="mt-1 text-xs text-muted-foreground">
                This link came from a QR poster. You’re viewing the full event detail — venue, agenda, and registration — all in one place. No extra app needed.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => {
                    const url = window.location.href
                    if (navigator.share) navigator.share({ title: event.title, text: `Join me at ${event.title}`, url }).catch(() => {})
                    else navigator.clipboard.writeText(url)
                  }}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted"
                >
                  <Share2 className="size-3.5" /> Share this event
                </button>
                <Link href={`/events`} className="inline-flex items-center gap-1.5 rounded-lg bg-muted px-3 py-1.5 text-xs font-medium hover:bg-muted/80">
                  Explore more
                </Link>
              </div>
            </div>
          )}

          {/* One clear action. Registration itself (capacity, payment,
              ticket issuance) happens after auth, in RoleEventDetail — this
              button's only job is getting a signed-out visitor there and
              back to this exact event. */}
          <div className="sticky bottom-6 mt-8">
            <div className="rounded-2xl border border-border bg-card p-5 shadow-2xl">
              <div className="flex flex-wrap items-center justify-between gap-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Price
                  </p>
                  <p className="font-display text-xl font-bold text-ink">
                    {free ? "Free" : formatPrice(event.price)}
                  </p>
                </div>
                <button
                  onClick={handleJoinClick}
                  disabled={isPast || isFull}
                  className="flex items-center gap-2 rounded-xl bg-primary px-6 py-3 text-sm font-semibold text-primary-foreground shadow-[0_8px_20px_-10px_rgba(91,76,245,0.8)] transition-transform hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-50"
                >
                  <Ticket className="size-4" />
                  {isPast ? "Event concluded" : isFull ? "Event full" : hasToken && currentUser ? "View Event & Register" : "Join Event"}
                </button>
              </div>
            </div>
          </div>

          <Link
            href="/events"
            className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-ink"
          >
            <ArrowLeft className="size-4" /> Browse more events
          </Link>
        </Reveal>
      </div>
    </div>
  )
}
