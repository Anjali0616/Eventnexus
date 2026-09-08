"use client"

import { use } from "react"
import { useRouter } from "next/navigation"
import { ArrowLeft, Loader2 } from "lucide-react"
import Link from "next/link"
import { AppShell } from "@/components/app/app-shell"
import { EventWizard } from "@/components/app/event-wizard"
import { useEvent, useUpdateEvent } from "@/lib/queries/events"
import { useRequireRole } from "@/lib/hooks/use-require-role"

export default function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  // Attendees must never reach the event editor. The gate waits for the
  // session to resolve before deciding — the previous inline check ran
  // while `user` was still undefined, so it neither reliably blocked the
  // wrong role nor reliably allowed the right one.
  const { gate, user } = useRequireRole(["organizer", "admin", "org_admin"])
  const { data: eventData, isLoading, isError } = useEvent(id)
  const updateEvent = useUpdateEvent()

  if (gate !== "allowed" || !user) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    )
  }

  const role = user.role === "admin" || user.role === "org_admin" ? "Administrator" : "Organizer"
  const event = eventData?.event

  if (isLoading) {
    return (
      <AppShell role={role} userName={user.name || "Organizer"} title="Edit Event">
        <div className="flex items-center justify-center py-24">
          <Loader2 className="size-6 animate-spin text-primary" />
        </div>
      </AppShell>
    )
  }

  if (isError || !event) {
    return (
      <AppShell role={role} userName={user?.name || "Organizer"} title="Edit Event">
        <div className="flex flex-col items-center justify-center py-24 text-center">
          <p className="font-display text-lg font-bold text-ink">Event not found</p>
          <p className="mt-1 text-sm text-muted-foreground">This event may have been removed.</p>
          <Link href="/organizer/events" className="mt-4 text-sm font-semibold text-primary hover:underline">Back to events</Link>
        </div>
      </AppShell>
    )
  }

  return (
    <AppShell role={role} userName={user?.name || "Organizer"} title="Edit Event">
      <div className="space-y-6">
        <Link
          href={`/organizer/events/${id}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-ink"
        >
          <ArrowLeft className="size-4" /> Back to event workspace
        </Link>
        <EventWizard
          mode="edit"
          initialData={event}
          isPending={updateEvent.isPending}
          submitLabel="Save Changes"
          submitError={
            updateEvent.isError
              ? (updateEvent.error as any)?.response?.data?.message || "Failed to save changes."
              : ""
          }
          onSubmit={(payload) =>
            updateEvent.mutate(
              { id, data: payload },
              { onSuccess: () => router.push(`/organizer/events/${id}`) }
            )
          }
        />
      </div>
    </AppShell>
  )
}
