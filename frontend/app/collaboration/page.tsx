import type { Metadata } from "next"
import { Network, KeyRound, ListChecks, Handshake, Bell, Building2 } from "lucide-react"
import { MarketingPage } from "@/components/landing/marketing-page"

export default function CollaborationPage() {
  return (
    <MarketingPage
      kicker="Collaboration"
      title="Run one event across many organizations"
      intro="Conferences, festivals, and joint programmes rarely belong to a single team. EventNexus lets multiple organizations co-host a single event while keeping their own scope, their own people, and one shared attendee list."
      blocksTitle="How co-hosting works"
      blocks={[
        {
          icon: Handshake,
          title: "Invite co-hosts",
          body: "The lead organizer invites other organizations to a shared event. Each accepts and joins with its own team.",
        },
        {
          icon: KeyRound,
          title: "Scoped access per team",
          body: "Role-based permissions decide what each co-host can edit — sessions, speakers, check-in, or analytics — without touching the rest.",
        },
        {
          icon: ListChecks,
          title: "One registration flow",
          body: "Attendees see a single event and register once. There's one capacity, one ticket type set, and one source of truth for numbers.",
        },
        {
          icon: Network,
          title: "Shared attendee list",
          body: "Every co-host works from the same live registration and check-in data, so nobody is reconciling exports after the fact.",
        },
        {
          icon: Bell,
          title: "Coordinated updates",
          body: "Changes and announcements propagate to all teams and attendees, with a record of who changed what.",
        },
        {
          icon: Building2,
          title: "Independent billing",
          body: "Each organization keeps its own plan and its own dashboard — collaboration is on the event, not the account.",
        },
      ]}
      ctaTitle="Plan a joint event"
      ctaBody="Open the collaboration workspace, or register your organization to start inviting co-hosts."
      ctas={[
        { label: "Open collaboration", href: "/organizer/collaboration" },
        { label: "Register an Organization", href: "/org-register" },
      ]}
    />
  )
}

export const metadata: Metadata = {
  title: "Collaboration — EventNexus",
  description:
    "Co-host a single event across multiple organizations on EventNexus — scoped access per team, one registration flow, one shared attendee list.",
}
