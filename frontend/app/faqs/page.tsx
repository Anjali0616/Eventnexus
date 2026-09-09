import Link from "next/link"
import type { Metadata } from "next"
import { Navbar } from "@/components/landing/navbar"
import { Footer } from "@/components/landing/footer"
import { Reveal } from "@/components/anim/reveal"

export const metadata: Metadata = {
  title: "FAQs — EventNexus",
  description:
    "Answers to common questions about EventNexus for attendees, organizers, payments, and your data.",
}

const groups: { heading: string; items: { q: string; a: string }[] }[] = [
  {
    heading: "For attendees",
    items: [
      {
        q: "Do I need an account to browse events?",
        a: "No. Browse Events is open to everyone — search and filter freely. You only sign in when you want to register for an event, which generates your ticket and QR code.",
      },
      {
        q: "How do I register for an event?",
        a: "Open the event and hit Register. Free events confirm instantly. Paid events send you to secure checkout (card via Stripe, or eSewa for NPR). Your ticket lands in My Tickets and your inbox.",
      },
      {
        q: "How does check-in work?",
        a: "Each ticket carries a signed QR code. Staff scan it at the door from any phone; a ticket verifies exactly once, so screenshots and forwarded copies are rejected.",
      },
      {
        q: "What are Recommendations?",
        a: "As you register for events, EventNexus learns your interests and ranks upcoming events by fit, distance, and demand — with a short reason for each pick.",
      },
      {
        q: "Can I cancel a registration?",
        a: "Yes, from My Tickets, up until the event's cutoff. Cancelling frees your seat for the waitlist. Refund handling for paid events follows the organizer's policy.",
      },
    ],
  },
  {
    heading: "For organizers & organizations",
    items: [
      {
        q: "How do I start as an organization?",
        a: "Register an Organization, then invite your team. Once approved you get the organizer workspace to create events, set pricing and capacity, and track registrations.",
      },
      {
        q: "What does Collaboration do?",
        a: "Multiple organizations can co-host a single event with role-based access — each team manages its own part while sharing one registration flow and one attendee list.",
      },
      {
        q: "Which payment methods can attendees use?",
        a: "Card payments through Stripe and eSewa for NPR. NPR prices are converted to USD at checkout for card charges; the event's listed price never changes.",
      },
      {
        q: "Is there a limit on events or attendees?",
        a: "The free plan covers up to 3 active events and 150 attendees each. Pro lifts that to unlimited events and 5,000 per event; Enterprise is custom. See the Pricing page.",
      },
    ],
  },
  {
    heading: "Account, data & security",
    items: [
      {
        q: "How is my data protected?",
        a: "Traffic is served over HTTPS, access is role-based with server-side enforcement on every route, and sensitive actions are audit-logged. See the Privacy Policy for details.",
      },
      {
        q: "Can I sign in with Google?",
        a: "Yes. Google accounts are verified on creation; email/password accounts confirm their address once before using the app.",
      },
      {
        q: "How do I delete my account or data?",
        a: "Email us from the Contact page and we'll remove your account and associated personal data, subject to records we're legally required to keep.",
      },
    ],
  },
]

export default function FaqsPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-28">
        <section className="mx-auto max-w-3xl px-6 pb-12">
          <Reveal>
            <span className="inline-block rounded-full bg-primary/10 px-4 py-1.5 text-xs font-medium text-primary">
              FAQs
            </span>
            <h1 className="font-display mt-5 text-balance text-4xl font-bold tracking-tight text-ink sm:text-5xl">
              Questions, answered
            </h1>
            <p className="mt-5 max-w-xl text-pretty leading-relaxed text-muted-foreground">
              Can't find what you need?{" "}
              <Link href="/contact" className="font-medium text-primary hover:underline">
                Contact us
              </Link>{" "}
              and a real person will reply within one business day.
            </p>
          </Reveal>
        </section>

        <section className="mx-auto max-w-3xl px-6 pb-24">
          {groups.map((g) => (
            <div key={g.heading} className="mt-10 first:mt-0">
              <Reveal>
                <h2 className="font-display text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                  {g.heading}
                </h2>
              </Reveal>
              <div className="mt-4 space-y-3">
                {g.items.map((f) => (
                  <Reveal key={f.q} y={14}>
                    <details className="group rounded-2xl border border-border bg-card p-5 [&_summary]:list-none">
                      <summary className="flex cursor-pointer items-center justify-between gap-4 text-sm font-semibold text-ink">
                        {f.q}
                        <span className="shrink-0 text-lg leading-none text-muted-foreground transition-transform group-open:rotate-45">
                          +
                        </span>
                      </summary>
                      <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
                    </details>
                  </Reveal>
                ))}
              </div>
            </div>
          ))}
        </section>
      </main>
      <Footer />
    </div>
  )
}
