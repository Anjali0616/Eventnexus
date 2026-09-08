"use client"

import { use } from "react"
import { RoleEventDetail } from "@/components/app/role-event-detail"
import { PublicEventLanding } from "@/components/app/public-event-landing"
import { useCurrentUser } from "@/lib/queries/auth"
import { useHasTokenWithChecked } from "@/lib/hooks/use-has-token"

// This is the URL the event's public QR/poster (event-qr-poster.tsx) and
// every "share this event" link point at, so it's the page a first-time,
// signed-out visitor actually lands on.
//
// `useHasToken()` intentionally starts `false` on every render — including
// the server's, where there is no localStorage to read — and only flips
// after mount (see the hook for why: reading the token synchronously would
// make the client's first paint diverge from the server HTML and force a
// hydration error). That means PublicEventLanding, not RoleEventDetail, is
// always what a signed-out visitor AND the very first frame of every visit
// render — exactly the safe default: a focused description + Join button,
// no app chrome assuming an account that may not exist yet.
//
// Once a token is confirmed present, this swaps to RoleEventDetail, which
// already renders the description and the real Register/ticket flow for an
// authenticated attendee — that logic isn't duplicated here.
export default function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { hasToken, checked } = useHasTokenWithChecked()
  const { data: userData, isLoading, isError } = useCurrentUser()
  const user = userData?.user

  if (!checked) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  if (!hasToken || (isError && !user)) {
    return <PublicEventLanding eventId={id} />
  }

  if (hasToken && isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    )
  }

  const role =
    user?.role === "admin" || user?.role === "org_admin"
      ? "Administrator"
      : user?.role === "organizer"
        ? "Organizer"
        : "Attendee"

  return (
    <RoleEventDetail
      eventId={id}
      role={role}
      userName={user?.name || "Attendee"}
      title="Event Details"
      backHref="/dashboard"
      backLabel="Back to discover"
      ticketHref="/my-tickets"
      registerLabel="Register now"
    />
  )
}
