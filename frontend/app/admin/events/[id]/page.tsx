"use client"

import { Suspense, use } from "react"
import { CalendarDays, Loader2 } from "lucide-react"
import { RoleEventDetail } from "@/components/app/role-event-detail"
import { useCurrentUser } from "@/lib/queries/auth"

export default function AdminEventDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { data: userData } = useCurrentUser()
  const user = userData?.user

  return (
    <Suspense fallback={<div className="flex min-h-screen items-center justify-center"><Loader2 className="size-6 animate-spin text-primary" /></div>}>
      <RoleEventDetail
        eventId={id}
        role="Administrator"
        userName={user?.name || "Admin"}
        title="Event Oversight"
        backHref="/admin/events"
        backLabel="Back to events"
        ticketHref="/admin/events"
        registerLabel="Review event"
        registerIcon={CalendarDays}
      />
    </Suspense>
  )
}
