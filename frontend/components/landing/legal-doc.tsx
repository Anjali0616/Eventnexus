import type { ReactNode } from "react"
import { Navbar } from "@/components/landing/navbar"
import { Footer } from "@/components/landing/footer"
import { Reveal } from "@/components/anim/reveal"

export type LegalSection = { heading: string; body: ReactNode }

/** Shared shell for prose legal pages (Privacy, Terms). */
export function LegalDoc({
  kicker,
  title,
  intro,
  updated,
  sections,
}: {
  kicker: string
  title: string
  intro: string
  updated: string
  sections: LegalSection[]
}) {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-28">
        <section className="mx-auto max-w-3xl px-6 pb-10">
          <Reveal>
            <span className="inline-block rounded-full bg-primary/10 px-4 py-1.5 text-xs font-medium text-primary">
              {kicker}
            </span>
            <h1 className="font-display mt-5 text-balance text-4xl font-bold tracking-tight text-ink sm:text-5xl">
              {title}
            </h1>
            <p className="mt-5 max-w-xl text-pretty leading-relaxed text-muted-foreground">{intro}</p>
            <p className="mt-3 text-xs font-medium uppercase tracking-widest text-muted-foreground/70">
              Last updated {updated}
            </p>
          </Reveal>
        </section>

        <section className="mx-auto max-w-3xl px-6 pb-24">
          <ol className="space-y-8">
            {sections.map((s, i) => (
              <Reveal key={s.heading} y={16} as="li">
                <h2 className="font-display flex items-baseline gap-3 text-lg font-bold text-ink">
                  <span className="font-mono text-sm text-primary">{String(i + 1).padStart(2, "0")}</span>
                  {s.heading}
                </h2>
                <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground [&_a]:font-medium [&_a]:text-primary [&_a:hover]:underline [&_li]:ml-4 [&_li]:list-disc [&_strong]:text-ink">
                  {s.body}
                </div>
              </Reveal>
            ))}
          </ol>
        </section>
      </main>
      <Footer />
    </div>
  )
}
