"use client"

import { useEffect, useRef } from "react"
import { ensureGsapAsync, prefersReducedMotion } from "@/lib/gsap"

type CountUpProps = {
  to: number
  prefix?: string
  suffix?: string
  decimals?: number
  duration?: number
  className?: string
}

function format(n: number, decimals: number) {
  const fixed = n.toFixed(decimals)
  // add thousands separators
  const [intPart, dec] = fixed.split(".")
  const withSep = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",")
  return dec ? `${withSep}.${dec}` : withSep
}

export function CountUp({
  to,
  prefix = "",
  suffix = "",
  decimals = 0,
  duration = 1.6,
  className,
}: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    if (prefersReducedMotion()) {
      el.textContent = prefix + format(to, decimals) + suffix
      return
    }

    let ctx: any
    let cancelled = false
    void ensureGsapAsync().then((gsap) => {
      if (cancelled || !gsap || !ref.current) return
      const obj = { val: 0 }
      ctx = gsap.context(() => {
        gsap.to(obj, {
          val: to,
          duration,
          ease: "power2.out",
          scrollTrigger: { trigger: el, start: "top 92%" },
          onUpdate: () => {
            el.textContent = prefix + format(obj.val, decimals) + suffix
          },
        })
      }, ref)
    })

    return () => {
      cancelled = true
      ctx?.revert()
    }
  }, [to, prefix, suffix, decimals, duration])

  return (
    <span ref={ref} className={className}>
      {prefix + format(0, decimals) + suffix}
    </span>
  )
}
