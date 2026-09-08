"use client"

import { useEffect, useRef, type ReactNode } from "react"
import Link from "next/link"
import { Hexagon, ShieldCheck, Sparkles, Cloud } from "lucide-react"
import { ensureGsapAsync, prefersReducedMotion } from "@/lib/gsap"

const chips = [
  { icon: ShieldCheck, label: "Secure" },
  { icon: Sparkles, label: "AI" },
  { icon: Cloud, label: "Cloud" },
]

export function AuthShell({
  children,
  heading,
  sub,
}: {
  children: ReactNode
  heading: string
  sub: string
}) {
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (prefersReducedMotion()) return
    let ctx: any
    let cancelled = false
    void ensureGsapAsync().then((gsap) => {
      if (cancelled || !gsap) return
      ctx = gsap.context((self: any) => {
        const q = self.selector!
        const tl = gsap.timeline({ defaults: { ease: "power3.out" } })
        tl.from(q(".auth-panel"), { x: -40, opacity: 0, duration: 0.7 })
          .from(q(".auth-chip"), { y: 16, opacity: 0, stagger: 0.1, duration: 0.5 }, "-=0.3")
          .from(q(".auth-field"), { y: 20, opacity: 0, stagger: 0.08, duration: 0.5 }, "-=0.2")
        gsap.to(q(".auth-orb"), {
          scale: 1.2,
          opacity: 0.5,
          duration: 5,
          ease: "sine.inOut",
          repeat: -1,
          yoyo: true,
        })
      }, root)
    })
    return () => {
      cancelled = true
      ctx?.revert()
    }
  }, [])

  return (
    <div ref={root} className="grid min-h-screen lg:grid-cols-2">
      {/* Left art panel */}
      <div className="auth-panel relative hidden overflow-hidden bg-brand-gradient p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div
          aria-hidden
          className="auth-orb pointer-events-none absolute -right-20 top-1/3 size-96 rounded-full bg-white/20 blur-3xl"
        />
        <Link href="/" className="relative flex items-center gap-2">
          <span className="flex size-9 items-center justify-center rounded-lg bg-white/15">
            <Hexagon className="size-5" strokeWidth={2.5} />
          </span>
          <span className="font-display text-xl font-bold">EventNexus</span>
        </Link>

        <div className="relative">
          <h2 className="font-display max-w-sm text-balance text-4xl font-bold leading-tight">
            The smartest way to manage events, together.
          </h2>
          <p className="mt-4 max-w-sm text-pretty text-white/80">
            AI intelligence, enterprise security, and real-time multi-org collaboration in one
            cloud-native platform.
          </p>
          <div className="mt-8 flex gap-3">
            {chips.map((c) => (
              <span
                key={c.label}
                className="auth-chip glass inline-flex items-center gap-2 rounded-full border border-white/20 px-4 py-2 text-sm font-medium text-ink"
              >
                <c.icon className="size-4 text-primary" />
                {c.label}
              </span>
            ))}
          </div>
        </div>

        <p className="font-mono relative text-xs text-white/60">Built with MERN · Hosted on AWS</p>
      </div>

      {/* Right form */}
      <div className="flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <Link href="/" className="mb-8 flex items-center gap-2 lg:hidden">
            <span className="bg-brand-gradient flex size-8 items-center justify-center rounded-lg text-white">
              <Hexagon className="size-5" strokeWidth={2.5} />
            </span>
            <span className="font-display text-xl font-bold text-ink">EventNexus</span>
          </Link>
          <h1 className="font-display auth-field text-3xl font-bold tracking-tight text-ink">
            {heading}
          </h1>
          <p className="auth-field mt-2 text-sm text-muted-foreground">{sub}</p>
          <div className="mt-8">{children}</div>
        </div>
      </div>
    </div>
  )
}
