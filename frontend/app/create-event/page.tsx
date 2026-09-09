import type { Metadata } from "next"
import { SlidersHorizontal, Ticket, ShieldCheck, Users, QrCode, Sparkles } from "lucide-react"
import { MarketingPage } from "@/components/landing/marketing-page"

export const metadata: Metadata = {
  title: "Create an Event — EventNexus",
  description:
    "Publish an event on EventNexus in minutes: flexible registration and pricing, secure QR tickets, and real-time capacity tracking.",
}

export default function CreateEventPage() {
  return (
    <MarketingPage
      kicker="Create an Event"
      title="Publish your event in minutes"
      intro="One form, then it's live in Browse Events — searchable, filterable, and ready to take registrations. Here's what you get."
      blocksTitle="What's included"
      blocks={[
        {
          icon: SlidersHorizontal,
          title: "Flexible registration rules",
          body: "Set capacity, category and type, dates, venue or online link, and any custom fields you need from attendees.",
        },
        {
          icon: Ticket,
          title: "Free or paid tickets",
          body: "Instant registration for free events. Paid events take card payments via Stripe and eSewa for NPR — NPR converts to USD at checkout, the listed price stays put.",
        },
        {
          icon: Users,
          title: "Live capacity tracking",
          body: "Registrations update in real time. When you publish, attendees browsing the site see it appear without refreshing.",
        },
        {
          icon: QrCode,
          title: "Automatic QR tickets",
          body: "Every registrant gets a signed QR ticket by email and in their account — nothing for you to generate or send.",
        },
        {
          icon: Sparkles,
          title: "AI reach & timing",
          body: "The recommender surfaces your event to attendees whose interests match, and suggests when to promote for the best turnout.",
        },
        {
          icon: ShieldCheck,
          title: "Secure by default",
          body: "Role-based access for your team, one-time ticket verification at the door, and audit trails on sensitive changes.",
        },
      ]}
      ctaTitle="Create your first event"
      ctaBody="Open the event builder now, or register an organization first if your team will run events together."
      ctas={[
        { label: "Open the event builder", href: "/organizer/events/create" },
        { label: "Register an Organization", href: "/org-register" },
      ]}
    />
  )
}
