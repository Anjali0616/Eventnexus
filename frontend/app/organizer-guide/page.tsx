import type { Metadata } from "next"
import { UserPlus, CalendarPlus, Megaphone, ScanLine, BarChart3, LifeBuoy } from "lucide-react"
import { MarketingPage } from "@/components/landing/marketing-page"

export const metadata: Metadata = {
  title: "Organizer Guide — EventNexus",
  description:
    "How to run an event on EventNexus end to end — from setting up your organization to check-in and post-event analytics.",
}

export default function OrganizerGuidePage() {
  return (
    <MarketingPage
      kicker="Organizer Guide"
      title="Run your event, start to finish"
      intro="A quick tour of the organizer workflow on EventNexus. Every step below is a screen in the organizer workspace — no external tools, no spreadsheets."
      blocksTitle="The workflow"
      numbered
      blocks={[
        {
          icon: UserPlus,
          title: "Set up your organization",
          body: "Register an organization and invite your team. Roles decide who can create events, manage registrations, and see revenue.",
        },
        {
          icon: CalendarPlus,
          title: "Create an event",
          body: "Add the details, pick a category and type, set capacity, and choose free or paid tickets (card via Stripe, eSewa for NPR). Publish when ready.",
        },
        {
          icon: Megaphone,
          title: "Let AI help promote it",
          body: "EventNexus matches your event to likely attendees and suggests the best promotion windows, so outreach reaches more people with less effort.",
        },
        {
          icon: ScanLine,
          title: "Check attendees in",
          body: "Scan the QR on each ticket from any phone at the door. Every ticket verifies exactly once — screenshots and forwards are rejected.",
        },
        {
          icon: BarChart3,
          title: "Review what happened",
          body: "Live dashboards for attendance, revenue, and channel performance, plus an AI note on when to schedule the next one.",
        },
        {
          icon: LifeBuoy,
          title: "Get help when you need it",
          body: "The in-app help panel and the Contact page connect you to a real person within one business day.",
        },
      ]}
      ctaTitle="Ready to organize?"
      ctaBody="Register your organization, then open the workspace to build your first event."
      ctas={[
        { label: "Open the organizer workspace", href: "/organizer" },
        { label: "Register an Organization", href: "/org-register" },
      ]}
    />
  )
}
