"use client"

import { useEffect, useRef, type ReactNode } from "react"
import { ensureGsapAsync, prefersReducedMotion } from "@/lib/gsap"

type RevealProps = {
  children: ReactNode
  className?: string
  id?: string
  /** initial vertical offset in px */
  y?: number
  /** initial horizontal offset in px */
  x?: number
  delay?: number
  duration?: number
  /** when set, animates the element's direct children with this stagger */
  stagger?: number
  /** initial scale (e.g. 0.96) */
  scale?: number
  /** scroll start position, e.g. "top 85%" */
  start?: string
  as?: "div" | "section" | "ul" | "li" | "span" | "header" | "footer" | "nav" | "tr"
}

export function Reveal({
  children,
  className,
  id,
  y = 32,
  x = 0,
  delay = 0,
  duration = 0.7,
  stagger,
  scale,
  start = "top 86%",
  as: Tag = "div",
}: RevealProps) {
  const ref = useRef<HTMLElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (prefersReducedMotion()) return

    let ctx: any
    let cancelled = false
    void ensureGsapAsync().then((gsap) => {
      if (cancelled || !gsap || !ref.current) return
      const t: any = stagger ? Array.from(el.children) : el
      ctx = gsap.context(() => {
        gsap.fromTo(
          t,
          { opacity: 0, y, x, ...(scale ? { scale } : {}) },
          {
            opacity: 1,
            y: 0,
            x: 0,
            ...(scale ? { scale: 1 } : {}),
            duration,
            delay,
            ease: "power3.out",
            stagger: stagger || 0,
            scrollTrigger: {
              trigger: el,
              start,
              toggleActions: "play none none none",
            },
          },
        )
      }, ref)
    })

    return () => {
      cancelled = true
      ctx?.revert()
    }
  }, [y, x, delay, duration, stagger, scale, start])

  return (
    <Tag ref={ref as React.Ref<never>} id={id} className={className}>
      {children}
    </Tag>
  )
}
