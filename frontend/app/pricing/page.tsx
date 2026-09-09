import Link from "next/link"
import type { Metadata } from "next"
import { ArrowRight, Check, Minus, Sparkles } from "lucide-react"
import { Navbar } from "@/components/landing/navbar"
import { Footer } from "@/components/landing/footer"
import { Reveal } from "@/components/anim/reveal"

export const metadata: Metadata = {
  title: "Pricing — EventNexus",
  description:
    "Simple, transparent pricing for EventNexus. Start free, upgrade when your events grow, and talk to us for multi-organization deployments.",
}

type Tier = {
  name: string
  price: string
  cadence?: string
  blurb: string
  cta: { label: string; href: string }
  featured?: boolean
  features: string[]
}

const tiers: Tier[] = [
  {
    name: "Starter",
    price: "Free",
    blurb: "For individuals and small community events getting off the ground.",
    cta: { label: "Get started free", href: "/register" },
    features: [
      "Up to 3 active events",
      "150 attendees / event",
      "QR tickets & door check-in",
      "Email notifications",
      "AI event recommendations",
      "Community support",
    ],
  },
  {
    name: "Pro",
    price: "$29",
    cadence: "/ month",
    blurb: "For organizers running frequent, paid, or larger events.",
    cta: { label: "Start Pro", href: "/register" },
    featured: true,
    features: [
      "Unlimited events",
      "5,000 attendees / event",
      "Card & eSewa payments (Stripe/eSewa)",
      "Attendance forecasting",
      "Marketing insights & timing",
      "Co-host collaboration",
      "Priority email support",
    ],
  },
  {
    name: "Enterprise",
    price: "Custom",
    blurb: "For multi-organization programs that need scale, control, and SLAs.",
    cta: { label: "Contact sales", href: "/contact" },
    features: [
      "Everything in Pro",
      "Multi-org RBAC & audit trails",
      "SSO / SAML",
      "Dedicated environment on AWS",
      "Custom integrations & API limits",
      "Onboarding & solution architect",
      "99.9% uptime SLA",
    ],
  },
]

const comparison: { label: string; starter: string | boolean; pro: string | boolean; enterprise: string | boolean }[] = [
  { label: "Active events", starter: "3", pro: "Unlimited", enterprise: "Unlimited" },
  { label: "Attendees per event", starter: "150", pro: "5,000", enterprise: "Custom" },
  { label: "Online payments", starter: false, pro: true, enterprise: true },
  { label: "AI recommendations", starter: true, pro: true, enterprise: true },
  { label: "Attendance forecasting", starter: false, pro: true, enterprise: true },
  { label: "Multi-org collaboration", starter: false, pro: "Co-hosts", enterprise: "Full RBAC" },
  { label: "SSO / SAML", starter: false, pro: false, enterprise: true },
  { label: "Audit trails", starter: false, pro: "30 days", enterprise: "Unlimited" },
  { label: "Support", starter: "Community", pro: "Priority email", enterprise: "Dedicated + SLA" },
]

const faqs = [
  {
    q: "Is there really a free plan?",
    a: "Yes. Starter is free forever for up to 3 active events and 150 attendees each — no card required. It includes QR check-in and AI recommendations.",
  },
  {
    q: "How are attendees counted?",
    a: "By confirmed registrations on active (upcoming or live) events. Past events and cancelled tickets don't count toward your limit.",
  },
  {
    q: "What payment methods can my attendees use?",
    a: "On Pro and Enterprise, paid events accept cards via Stripe and eSewa for NPR. NPR prices are converted to USD at checkout for card payments; the listed price never changes.",
  },
  {
    q: "Can I change plans later?",
    a: "Anytime. Upgrades apply immediately; downgrades take effect at the end of the billing period. Your events and data are never deleted on a downgrade.",
  },
  {
    q: "Do you offer nonprofit or education discounts?",
    a: "Yes — reach out via the contact page and we'll sort you out.",
  },
]

function Cell({ value }: { value: string | boolean }) {
  if (value === true) return <Check className="mx-auto size-4 text-secondary" strokeWidth={3} />
  if (value === false) return <Minus className="mx-auto size-4 text-muted-foreground/40" />
  return <span className="text-sm text-ink">{value}</span>
}

export default function PricingPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-28">
        {/* Hero */}
        <section className="mx-auto max-w-7xl px-6 pb-14 text-center">
          <Reveal>
            <span className="inline-block rounded-full bg-primary/10 px-4 py-1.5 text-xs font-medium text-primary">
              Pricing
            </span>
            <h1 className="font-display mx-auto mt-5 max-w-3xl text-balance text-4xl font-bold tracking-tight text-ink sm:text-5xl">
              Start free. Pay only when your events grow.
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-pretty leading-relaxed text-muted-foreground">
              No setup fees, no per-ticket cut on the Starter plan. Upgrade for payments, forecasting,
              and multi-organization collaboration.
            </p>
          </Reveal>
        </section>

        {/* Tiers */}
        <section className="mx-auto max-w-7xl px-6">
          <div className="grid gap-6 lg:grid-cols-3">
            {tiers.map((t, i) => (
              <Reveal key={t.name} y={24} scale={0.98} className="h-full">
                <div
                  className={`flex h-full flex-col rounded-3xl border p-7 ${
                    t.featured
                      ? "border-primary/40 bg-primary/[0.04] shadow-[0_24px_60px_-30px_rgba(91,76,245,0.5)]"
                      : "border-border bg-card"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <h2 className="font-display text-lg font-bold text-ink">{t.name}</h2>
                    {t.featured && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-brand-gradient px-2.5 py-1 text-[11px] font-semibold text-white">
                        <Sparkles className="size-3" /> Most popular
                      </span>
                    )}
                  </div>
                  <div className="mt-4 flex items-baseline gap-1">
                    <span className="font-display text-4xl font-bold tracking-tight text-ink">{t.price}</span>
                    {t.cadence && <span className="text-sm text-muted-foreground">{t.cadence}</span>}
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{t.blurb}</p>

                  <Link
                    href={t.cta.href}
                    className={`group mt-6 inline-flex items-center justify-center gap-2 rounded-full px-6 py-3 text-sm font-semibold transition-transform hover:-translate-y-0.5 ${
                      t.featured
                        ? "bg-primary text-primary-foreground shadow-[0_12px_32px_-10px_rgba(91,76,245,0.8)]"
                        : "border border-border text-ink hover:bg-muted"
                    }`}
                  >
                    {t.cta.label}
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                  </Link>

                  <ul className="mt-7 space-y-3">
                    {t.features.map((f) => (
                      <li key={f} className="flex items-start gap-2.5 text-sm text-ink">
                        <Check className="mt-0.5 size-4 shrink-0 text-secondary" strokeWidth={3} />
                        {f}
                      </li>
                    ))}
                  </ul>
                </div>
              </Reveal>
            ))}
          </div>
        </section>

        {/* Comparison */}
        <section className="mx-auto mt-24 max-w-5xl px-6">
          <Reveal>
            <h2 className="font-display text-center text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              Compare plans
            </h2>
          </Reveal>
          <Reveal y={20} className="mt-8 overflow-x-auto">
            <table className="w-full min-w-[640px] border-separate border-spacing-0">
              <thead>
                <tr>
                  <th className="w-2/5 py-3 text-left text-sm font-semibold text-muted-foreground">Feature</th>
                  {["Starter", "Pro", "Enterprise"].map((h) => (
                    <th key={h} className="px-4 py-3 text-center text-sm font-semibold text-ink">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparison.map((row, idx) => (
                  <tr key={row.label} className={idx % 2 ? "bg-muted/40" : ""}>
                    <td className="rounded-l-lg px-2 py-3 text-sm font-medium text-ink">{row.label}</td>
                    <td className="px-4 py-3 text-center"><Cell value={row.starter} /></td>
                    <td className="px-4 py-3 text-center"><Cell value={row.pro} /></td>
                    <td className="rounded-r-lg px-4 py-3 text-center"><Cell value={row.enterprise} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Reveal>
        </section>

        {/* FAQ */}
        <section className="mx-auto mt-24 max-w-3xl px-6">
          <Reveal>
            <h2 className="font-display text-center text-2xl font-bold tracking-tight text-ink sm:text-3xl">
              Pricing FAQ
            </h2>
          </Reveal>
          <div className="mt-8 space-y-4">
            {faqs.map((f) => (
              <Reveal key={f.q} y={16}>
                <details className="group rounded-2xl border border-border bg-card p-5 [&_summary]:list-none">
                  <summary className="flex cursor-pointer items-center justify-between gap-4 text-sm font-semibold text-ink">
                    {f.q}
                    <span className="text-muted-foreground transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{f.a}</p>
                </details>
              </Reveal>
            ))}
          </div>
        </section>

        {/* CTA */}
        <section className="mx-auto mt-24 max-w-7xl px-6 pb-8">
          <Reveal scale={0.97}>
            <div className="bg-brand-gradient relative overflow-hidden rounded-3xl px-6 py-14 text-center text-white shadow-2xl sm:px-8">
              <h2 className="font-display mx-auto max-w-2xl text-balance text-2xl font-bold leading-tight sm:text-3xl">
                Still weighing it up?
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-pretty text-sm text-white/80 sm:text-base">
                Spin up the free plan in a minute, or tell us about your program and we'll map the right fit.
              </p>
              <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
                <Link
                  href="/register"
                  className="rounded-full bg-white px-7 py-3 text-sm font-semibold text-ink transition-transform hover:-translate-y-0.5"
                >
                  Get started free
                </Link>
                <Link
                  href="/contact"
                  className="rounded-full border border-white/40 px-7 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
                >
                  Talk to us
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
