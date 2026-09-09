import Link from "next/link"
import type { ReactNode } from "react"
import { ArrowRight, type LucideIcon } from "lucide-react"
import { Navbar } from "@/components/landing/navbar"
import { Footer } from "@/components/landing/footer"
import { Reveal } from "@/components/anim/reveal"

export type MarketingBlock = { icon: LucideIcon; title: string; body: string }
export type MarketingCta = { label: string; href: string }

/**
 * Shared shell for the public "Organizations" landing pages (Organizer Guide,
 * Create an Event, Collaboration). Same Navbar + Footer + Reveal styling as
 * the About / Pricing / Contact pages; every page ends with CTAs into the real
 * in-app flow.
 */
export function MarketingPage({
  kicker,
  title,
  intro,
  blocksTitle,
  blocks,
  numbered = false,
  extra,
  ctaTitle,
  ctaBody,
  ctas,
}: {
  kicker: string
  title: string
  intro: string
  blocksTitle: string
  blocks: MarketingBlock[]
  numbered?: boolean
  extra?: ReactNode
  ctaTitle: string
  ctaBody: string
  ctas: [MarketingCta, MarketingCta]
}) {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-28">
        {/* Hero */}
        <section className="mx-auto max-w-3xl px-6 pb-14">
          <Reveal>
            <span className="inline-block rounded-full bg-primary/10 px-4 py-1.5 text-xs font-medium text-primary">
              {kicker}
            </span>
            <h1 className="font-display mt-5 text-balance text-4xl font-bold tracking-tight text-ink sm:text-5xl">
              {title}
            </h1>
            <p className="mt-5 text-pretty text-base leading-relaxed text-muted-foreground">{intro}</p>
          </Reveal>
        </section>

        {/* Blocks */}
        <section className="mx-auto max-w-5xl px-6">
          <Reveal>
            <h2 className="font-display text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              {blocksTitle}
            </h2>
          </Reveal>
          <div className="mt-6 grid gap-5 sm:grid-cols-2">
            {blocks.map((b, i) => {
              const Icon = b.icon
              return (
                <Reveal key={b.title} y={20}>
                  <div className="h-full rounded-2xl border border-border bg-card p-6">
                    <div className="flex items-center gap-3">
                      <span className="bg-brand-gradient flex size-10 items-center justify-center rounded-xl text-white">
                        <Icon className="size-5" />
                      </span>
                      {numbered && (
                        <span className="font-mono text-sm font-bold text-muted-foreground/60">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                      )}
                    </div>
                    <h3 className="font-display mt-4 text-base font-bold text-ink">{b.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{b.body}</p>
                  </div>
                </Reveal>
              )
            })}
          </div>
        </section>

        {extra && (
          <section className="mx-auto mt-20 max-w-3xl px-6">
            <Reveal>{extra}</Reveal>
          </section>
        )}

        {/* CTA */}
        <section className="mx-auto mt-24 max-w-7xl px-6 pb-8">
          <Reveal scale={0.97}>
            <div className="bg-brand-gradient relative overflow-hidden rounded-3xl px-6 py-14 text-center text-white shadow-2xl sm:px-8">
              <h2 className="font-display mx-auto max-w-2xl text-balance text-2xl font-bold leading-tight sm:text-3xl">
                {ctaTitle}
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-pretty text-sm text-white/80 sm:text-base">{ctaBody}</p>
              <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
                <Link
                  href={ctas[0].href}
                  className="group inline-flex items-center gap-2 rounded-full bg-white px-7 py-3 text-sm font-semibold text-ink transition-transform hover:-translate-y-0.5"
                >
                  {ctas[0].label}
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                </Link>
                <Link
                  href={ctas[1].href}
                  className="rounded-full border border-white/40 px-7 py-3 text-sm font-semibold text-white transition-colors hover:bg-white/10"
                >
                  {ctas[1].label}
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
