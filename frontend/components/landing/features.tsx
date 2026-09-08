"use client"

import dynamic from "next/dynamic"

const BouncyCardsFeatures = dynamic(
  () => import("@/components/ui/bounce-card-features").then((m) => m.BouncyCardsFeatures),
  { ssr: false, loading: () => <div className="h-64 animate-pulse rounded-2xl bg-muted/20" /> }
)

export function Features() {
  return (
    <section id="features" className="bg-card/50 dark:bg-[#060608]/50 border-t border-border py-12 md:py-20">
      <BouncyCardsFeatures />
    </section>
  )
}
