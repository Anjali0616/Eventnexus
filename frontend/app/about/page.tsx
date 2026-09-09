import Link from "next/link"
import type { Metadata } from "next"
import { ArrowRight, Brain, ShieldCheck, Network, Cloud } from "lucide-react"
import { Navbar } from "@/components/landing/navbar"
import { Footer } from "@/components/landing/footer"
import { Reveal } from "@/components/anim/reveal"

export const metadata: Metadata = {
  title: "About — EventNexus",
  description:
    "EventNexus is an AI-enabled, secure, cloud-based platform for multi-organization event collaboration — and the mission behind it.",
}

const pillars = [
  {
    icon: Brain,
    title: "AI that does the busywork",
    body: "Recommendations, attendance forecasting, and promotion timing — so organizers spend their time on the experience, not the spreadsheet.",
  },
  {
    icon: ShieldCheck,
    title: "Security by default",
    body: "Role-based access enforced on every route, signed QR tickets that verify once, and audit trails on sensitive actions.",
  },
  {
    icon: Network,
    title: "Built for many organizations",
    body: "Multiple teams co-host a single event with their own scoped access, one shared registration flow, and one attendee list.",
  },
  {
    icon: Cloud,
    title: "Cloud-native scale",
    body: "Runs on AWS with containerized services and automated deploys, so a sudden registration spike is a non-event.",
  },
]

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-28">
        {/* Intro */}
        <section className="mx-auto max-w-3xl px-6 pb-14">
          <Reveal>
            <span className="inline-block rounded-full bg-primary/10 px-4 py-1.5 text-xs font-medium text-primary">
              About EventNexus
            </span>
            <h1 className="font-display mt-5 text-balance text-4xl font-bold tracking-tight text-ink sm:text-5xl">
              One platform for the whole event lifecycle
            </h1>
            <p className="mt-5 text-pretty text-base leading-relaxed text-muted-foreground">
              EventNexus is an AI-enabled, secure, cloud-based event management platform. It connects
              organizers, organizations, and attendees around a single flow — from creating and
              promoting an event, through registration and payments, to check-in and live analytics.
            </p>
            <p className="mt-4 text-pretty text-base leading-relaxed text-muted-foreground">
              It started as a final-year university project with a simple frustration behind it: running
              even a modest event means juggling half a dozen disconnected tools. EventNexus folds that
              into one coherent system, with intelligence and security built in rather than bolted on.
            </p>
          </Reveal>
        </section>

        {/* Pillars */}
        <section className="mx-auto max-w-5xl px-6">
          <div className="grid gap-5 sm:grid-cols-2">
            {pillars.map((p) => {
              const Icon = p.icon
              return (
                <Reveal key={p.title} y={20}>
                  <div className="h-full rounded-2xl border border-border bg-card p-6">
                    <span className="bg-brand-gradient flex size-10 items-center justify-center rounded-xl text-white">
                      <Icon className="size-5" />
                    </span>
                    <h2 className="font-display mt-4 text-base font-bold text-ink">{p.title}</h2>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{p.body}</p>
                  </div>
                </Reveal>
              )
            })}
          </div>
        </section>

        {/* Mission */}
        <section id="mission" className="mx-auto mt-24 max-w-3xl scroll-mt-28 px-6">
          <Reveal>
            <span className="inline-block rounded-full bg-secondary/10 px-4 py-1.5 text-xs font-medium text-secondary">
              Our Mission
            </span>
            <h2 className="font-display mt-5 text-balance text-3xl font-bold tracking-tight text-ink sm:text-4xl">
              Make great events easy to run — for everyone
            </h2>
            <p className="mt-5 text-pretty text-base leading-relaxed text-muted-foreground">
              We believe the tools that power events should be accessible to a two-person student club
              and a multi-organization conference alike. That means a free tier that is genuinely
              useful, defaults that are secure, and automation that removes work instead of adding
              dashboards to check.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-ink">
              {[
                "Lower the barrier to organizing — start free, no card required.",
                "Keep attendee data safe and under the organizer's control.",
                "Use AI to save time, not to replace judgement.",
                "Stay open about how the platform works and how data is handled.",
              ].map((m) => (
                <li key={m} className="flex items-start gap-2.5">
                  <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-secondary" />
                  {m}
                </li>
              ))}
            </ul>
          </Reveal>
        </section>

        {/* CTA */}
        <section className="mx-auto mt-24 max-w-7xl px-6 pb-8">
          <Reveal scale={0.97}>
            <div className="bg-brand-gradient relative overflow-hidden rounded-3xl px-6 py-14 text-center text-white shadow-2xl sm:px-8">
              <h2 className="font-display mx-auto max-w-2xl text-balance text-2xl font-bold leading-tight sm:text-3xl">
                See the whole flow for yourself
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-pretty text-sm text-white/80 sm:text-base">
                Browse live events, or start free and publish your first one in a minute.
              </p>
              <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
                <Link
                  href="/events"
                  className="group inline-flex items-center gap-2 rounded-full bg-white px-7 py-3 text-sm font-semibold text-ink transition-transform hover:-translate-y-0.5"
                >
                  Browse Events
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                </Link>
                <Link
                  href="/register"
                  className="rounded-full border border-white/40 px-7 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
                >
                  Create Account
                </Link>
              </div>
            </div>
          </Reveal>
        </section>
      </main>
      <Footer />
    </div>
  )
}
