"use client"

import { Suspense, use } from "react"
import { CalendarDays, Loader2 } from "lucide-react"
import { RoleEventDetail } from "@/components/app/role-event-detail"
import { useRequireRole } from "@/lib/hooks/use-require-role"

export default function OrganizerEventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  // Attendees must never reach an organizer workspace. The gate waits for
  // the session to resolve before deciding, and redirects a denied user
  // home instead of rendering someone else's workspace.
  const { gate, user } = useRequireRole(["organizer", "admin", "org_admin"])

  if (gate !== "allowed" || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    )
  }

  // Use actual user role from server
  const role = user.role === "admin" || user.role === "org_admin" ? "Administrator" : "Organizer"

  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><Loader2 className="size-6 animate-spin text-primary" /></div>}>
      <RoleEventDetail
        eventId={id}
        role={role}
        userName={user.name || "Organizer"}
        title="Event Workspace"
        backHref="/organizer/events"
        backLabel="Back to my events"
        ticketHref="/organizer/tickets"
        registerLabel="Open workspace"
        registerIcon={CalendarDays}
      />
    </Suspense>
  )
}
