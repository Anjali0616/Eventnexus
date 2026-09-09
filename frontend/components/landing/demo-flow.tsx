"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Play,
  Search,
  Calendar,
  MapPin,
  Users,
  Ticket,
  QrCode,
  Sparkles,
  Check,
  ChevronLeft,
  ChevronRight,
  Pause,
} from "lucide-react"

type Step = {
  key: string
  title: string
  caption: string
  frame: ReactNode
}

const AUTOPLAY_MS = 4200

/** A single stylised app "screen" used inside each demo step. */
function Screen({ children }: { children: ReactNode }) {
  return (
    <div className="relative h-full w-full overflow-hidden rounded-xl border border-white/10 bg-[#0a0b10] text-[11px] text-[#a9adc1]">
      <div className="flex h-8 items-center gap-1.5 border-b border-white/5 bg-[#08090d] px-3">
        <span className="size-2 rounded-full bg-[#ff5f57]" />
        <span className="size-2 rounded-full bg-[#febc2e]" />
        <span className="size-2 rounded-full bg-[#28c840]" />
        <span className="ml-3 text-[10px] text-white/30">app.eventnexus.tech</span>
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

function EventCard({ title, meta, accent }: { title: string; meta: string; accent?: boolean }) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        accent ? "border-primary/40 bg-primary/10" : "border-white/5 bg-white/[0.03]"
      }`}
    >
      <div className="h-12 rounded-md bg-brand-gradient opacity-80" />
      <div className="mt-2 text-[11px] font-semibold text-white">{title}</div>
      <div className="mt-0.5 text-[10px] text-white/40">{meta}</div>
    </div>
  )
}

const steps: Step[] = [
  {
    key: "discover",
    title: "Discover events",
    caption: "Browse everything happening — filter by category, date, price or how close it is to you.",
    frame: (
      <Screen>
        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
          <Search className="size-3.5 text-white/40" />
          <span className="text-[10px] text-white/40">Search events…</span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <EventCard title="Product Summit 2026" meta="Mar 14 · Kathmandu" />
          <EventCard title="AI Builders Meetup" meta="Mar 20 · Online" accent />
          <EventCard title="Design Systems Day" meta="Apr 02 · Pokhara" />
          <EventCard title="Founders Brunch" meta="Apr 06 · Lalitpur" />
          <EventCard title="Cloud Native Con" meta="Apr 11 · Kathmandu" />
          <EventCard title="Growth Workshop" meta="Apr 18 · Online" />
        </div>
      </Screen>
    ),
  },
  {
    key: "details",
    title: "See the details",
    caption: "Open an event for the full picture — schedule, venue, capacity and live registration count.",
    frame: (
      <Screen>
        <div className="h-20 rounded-lg bg-brand-gradient opacity-80" />
        <div className="mt-3 text-sm font-bold text-white">AI Builders Meetup</div>
        <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-white/50">
          <span className="flex items-center gap-1.5"><Calendar className="size-3" /> Mar 20, 2026 · 6:00 PM</span>
          <span className="flex items-center gap-1.5"><MapPin className="size-3" /> Online — link on register</span>
          <span className="flex items-center gap-1.5"><Users className="size-3" /> 128 / 200 registered</span>
          <span className="flex items-center gap-1.5"><Sparkles className="size-3 text-secondary" /> ~172 expected</span>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-[64%] rounded-full bg-brand-gradient" />
        </div>
      </Screen>
    ),
  },
  {
    key: "register",
    title: "Register in one click",
    caption: "Free events register instantly. Paid ones go straight to secure checkout — eSewa or card.",
    frame: (
      <Screen>
        <div className="text-sm font-bold text-white">AI Builders Meetup</div>
        <div className="mt-1 text-[10px] text-white/40">Free · 72 spots left</div>
        <button className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-[11px] font-semibold text-primary-foreground">
          <Check className="size-3.5" /> Register now
        </button>
        <div className="mt-3 rounded-lg border border-secondary/30 bg-secondary/10 p-2.5 text-[10px] text-secondary">
          You're in — ticket &amp; QR generated instantly.
        </div>
      </Screen>
    ),
  },
  {
    key: "ticket",
    title: "Get your ticket",
    caption: "A scannable QR ticket lands in your account and inbox — ready for check-in at the door.",
    frame: (
      <Screen>
        <div className="mx-auto mt-1 w-44 rounded-xl border border-white/10 bg-white p-3 text-center text-ink">
          <div className="text-[10px] font-semibold text-primary">EVENTNEXUS · TICKET</div>
          <div className="mx-auto mt-2 grid size-24 grid-cols-6 gap-0.5">
            {Array.from({ length: 36 }).map((_, i) => (
              <span key={i} className={`rounded-[1px] ${(i * 7) % 3 === 0 ? "bg-ink" : "bg-transparent"}`} />
            ))}
          </div>
          <div className="mt-2 flex items-center justify-center gap-1 text-[10px] font-semibold">
            <Ticket className="size-3" /> AI Builders Meetup
          </div>
          <div className="text-[9px] text-muted-foreground">Seat GA · Mar 20</div>
        </div>
        <div className="mt-3 flex items-center justify-center gap-1.5 text-[10px] text-white/40">
          <QrCode className="size-3" /> Scan at entry to check in
        </div>
      </Screen>
    ),
  },
  {
    key: "recommend",
    title: "Get smarter picks",
    caption: "The more you attend, the sharper your recommendations get — ranked by fit, distance and demand.",
    frame: (
      <Screen>
        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-primary">
          <Sparkles className="size-3.5" /> Recommended for you
        </div>
        <div className="mt-3 space-y-2">
          {[
            { t: "Cloud Native Con", r: "Matches your last 3 events · 4 km away", s: 96 },
            { t: "Growth Workshop", r: "Popular with people like you", s: 89 },
            { t: "Design Systems Day", r: "New in a category you follow", s: 81 },
          ].map((x) => (
            <div key={x.t} className="flex items-center gap-3 rounded-lg border border-white/5 bg-white/[0.03] p-2.5">
              <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-gradient text-[10px] font-bold text-white">
                {x.s}
              </div>
              <div className="min-w-0">
                <div className="text-[11px] font-semibold text-white">{x.t}</div>
                <div className="truncate text-[10px] text-white/40">{x.r}</div>
              </div>
            </div>
          ))}
        </div>
      </Screen>
    ),
  },
]

export function DemoFlow({ trigger }: { trigger: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [i, setI] = useState(0)
  const [paused, setPaused] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const go = (next: number) => setI((next + steps.length) % steps.length)

  useEffect(() => {
    if (!open || paused) return
    timer.current = setTimeout(() => setI((v) => (v + 1) % steps.length), AUTOPLAY_MS)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [open, paused, i])

  // Reset to the first step whenever the dialog is reopened.
  useEffect(() => {
    if (open) {
      setI(0)
      setPaused(false)
    }
  }, [open])

  const step = steps[i]

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="max-w-2xl overflow-hidden p-0">
        <DialogTitle className="sr-only">EventNexus product demo</DialogTitle>

        <div
          className="bg-[#0a0b10] p-5 sm:p-6"
          onMouseEnter={() => setPaused(true)}
          onMouseLeave={() => setPaused(false)}
        >
          {/* progress segments */}
          <div className="flex gap-1.5">
            {steps.map((s, idx) => (
              <button
                key={s.key}
                onClick={() => go(idx)}
                aria-label={`Go to step ${idx + 1}: ${s.title}`}
                className="group relative h-1 flex-1 overflow-hidden rounded-full bg-white/10"
              >
                <span
                  key={idx === i ? `run-${i}-${paused}` : `idle-${idx}`}
                  className={`absolute inset-0 rounded-full bg-white/70 ${
                    idx < i ? "translate-x-0" : idx === i ? "" : "-translate-x-full"
                  }`}
                  style={
                    idx === i && !paused
                      ? { animation: `demo-fill ${AUTOPLAY_MS}ms linear forwards` }
                      : idx === i
                        ? { transform: "translateX(0)" }
                        : undefined
                  }
                />
              </button>
            ))}
          </div>

          {/* the screen */}
          <div className="mt-4 aspect-[16/10] w-full">{step.frame}</div>

          {/* caption + controls */}
          <div className="mt-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-white/40">
                Step {i + 1} of {steps.length}
                {paused && <Pause className="size-3" />}
              </div>
              <h3 className="font-display mt-1 text-base font-bold text-white">{step.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-white/60">{step.caption}</p>
            </div>
            <div className="flex shrink-0 gap-1.5 pt-1">
              <button
                onClick={() => go(i - 1)}
                aria-label="Previous step"
                className="flex size-8 items-center justify-center rounded-lg border border-white/10 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              >
                <ChevronLeft className="size-4" />
              </button>
              <button
                onClick={() => go(i + 1)}
                aria-label="Next step"
                className="flex size-8 items-center justify-center rounded-lg border border-white/10 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              >
                <ChevronRight className="size-4" />
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Ready-made button used by the hero. */
export function WatchDemoButton() {
  return (
    <DemoFlow
      trigger={
        <button
          type="button"
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-7 py-3.5 text-sm font-semibold text-ink transition-colors hover:bg-muted dark:bg-zinc-900 dark:text-white dark:hover:bg-zinc-800"
        >
          <Play className="size-4 fill-current text-primary" />
          Watch Demo
        </button>
      }
    />
  )
}
