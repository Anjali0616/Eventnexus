"use client"

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Play,
  Search,
  Ticket,
  QrCode,
  Sparkles,
  Check,
  ChevronLeft,
  ChevronRight,
  Pause,
  RotateCcw,
  Building2,
  CreditCard,
  ScanLine,
  BarChart3,
  Wand2,
} from "lucide-react"

type Role = "Organizer" | "Attendee" | "System"

type Step = {
  key: string
  role: Role
  title: string
  caption: string
  frame: ReactNode
}

const AUTOPLAY_MS = 4600

const roleStyle: Record<Role, string> = {
  Organizer: "bg-primary/15 text-primary",
  Attendee: "bg-secondary/15 text-secondary",
  System: "bg-flame/15 text-flame",
}

/** A stylised app "screen" shell used inside each demo step. */
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

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-center justify-between rounded-md border border-white/5 bg-white/[0.03] px-2.5 py-2">
      <span className="text-[10px] text-white/40">{label}</span>
      <span className={`text-[10px] font-semibold ${accent ? "text-secondary" : "text-white"}`}>{value}</span>
    </div>
  )
}

function EventCard({ title, meta, accent }: { title: string; meta: string; accent?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${accent ? "border-primary/40 bg-primary/10" : "border-white/5 bg-white/[0.03]"}`}>
      <div className="h-11 rounded-md bg-brand-gradient opacity-80" />
      <div className="mt-2 text-[11px] font-semibold text-white">{title}</div>
      <div className="mt-0.5 text-[10px] text-white/40">{meta}</div>
    </div>
  )
}

const steps: Step[] = [
  {
    key: "create",
    role: "Organizer",
    title: "An organizer builds an event",
    caption: "Set up under an organization with registration rules, capacity, and pricing — free or paid.",
    frame: (
      <Screen>
        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-primary">
          <Building2 className="size-3.5" /> Acme Events · New event
        </div>
        <div className="mt-3 space-y-2">
          <Row label="Title" value="AI Builders Meetup" />
          <Row label="Date · Venue" value="Mar 20 · Online" />
          <Row label="Capacity" value="200 seats" />
          <Row label="Ticket price" value="Free" accent />
        </div>
        <button className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2 text-[11px] font-semibold text-primary-foreground">
          <Wand2 className="size-3.5" /> Publish event
        </button>
      </Screen>
    ),
  },
  {
    key: "discover",
    role: "Attendee",
    title: "Attendees discover it",
    caption: "The event goes live in Discover — searchable and filterable by category, date, price, or distance.",
    frame: (
      <Screen>
        <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
          <Search className="size-3.5 text-white/40" />
          <span className="text-[10px] text-white/40">Search events…</span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <EventCard title="Product Summit" meta="Mar 14 · Kathmandu" />
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
    key: "recommend",
    role: "System",
    title: "AI ranks the best matches",
    caption: "The recommender scores every event by fit, distance, and demand — and forecasts turnout.",
    frame: (
      <Screen>
        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-flame">
          <Sparkles className="size-3.5" /> Recommended for Priya
        </div>
        <div className="mt-3 space-y-2">
          {[
            { t: "AI Builders Meetup", r: "Matches your last 3 events · online", s: 96 },
            { t: "Cloud Native Con", r: "Popular with people like you · 4 km", s: 88 },
            { t: "Design Systems Day", r: "New in a category you follow", s: 79 },
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
  {
    key: "register",
    role: "Attendee",
    title: "Register or pay securely",
    caption: "Free events register in one click. Paid ones route to Stripe or eSewa — NPR auto-converts for cards.",
    frame: (
      <Screen>
        <div className="text-sm font-bold text-white">AI Builders Meetup</div>
        <div className="mt-1 text-[10px] text-white/40">Free · 72 spots left</div>
        <button className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg bg-primary py-2.5 text-[11px] font-semibold text-primary-foreground">
          <Check className="size-3.5" /> Register now
        </button>
        <div className="mt-2 grid grid-cols-2 gap-2 text-[10px] text-white/40">
          <span className="flex items-center justify-center gap-1 rounded-md border border-white/10 py-1.5">
            <CreditCard className="size-3" /> Card / Stripe
          </span>
          <span className="flex items-center justify-center gap-1 rounded-md border border-white/10 py-1.5">eSewa · NPR</span>
        </div>
        <div className="mt-2 rounded-lg border border-secondary/30 bg-secondary/10 p-2 text-[10px] text-secondary">
          Confirmed — seat held, ticket generating…
        </div>
      </Screen>
    ),
  },
  {
    key: "ticket",
    role: "System",
    title: "A QR ticket is issued",
    caption: "Signed QR ticket lands in the attendee's account and inbox — impossible to forge, instant to scan.",
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
          <div className="text-[9px] text-muted-foreground">GA · Mar 20 · Priya S.</div>
        </div>
        <div className="mt-3 flex items-center justify-center gap-1.5 text-[10px] text-white/40">
          <QrCode className="size-3" /> Emailed + saved to My Tickets
        </div>
      </Screen>
    ),
  },
  {
    key: "checkin",
    role: "Organizer",
    title: "Scan-and-check-in at the door",
    caption: "Staff scan the QR from any phone. Each ticket verifies once — replays and screenshots are rejected.",
    frame: (
      <Screen>
        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-primary">
          <ScanLine className="size-3.5" /> Door check-in · AI Builders Meetup
        </div>
        <div className="mt-3 rounded-lg border border-secondary/40 bg-secondary/10 p-3">
          <div className="flex items-center gap-2 text-[11px] font-semibold text-secondary">
            <Check className="size-3.5" strokeWidth={3} /> Priya S. — checked in
          </div>
          <div className="mt-1 text-[10px] text-white/40">Ticket #A1F9 · 6:02 PM · valid</div>
        </div>
        <div className="mt-2 grid grid-cols-3 gap-2 text-center">
          <Row label="Checked in" value="128" />
          <Row label="Expected" value="172" />
          <Row label="No-shows" value="9" />
        </div>
      </Screen>
    ),
  },
  {
    key: "analytics",
    role: "Organizer",
    title: "Live analytics + next-event insight",
    caption: "Real-time attendance, revenue, and channel performance — plus AI guidance on when to run the next one.",
    frame: (
      <Screen>
        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-primary">
          <BarChart3 className="size-3.5" /> Event analytics
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Row label="Registered" value="182" />
          <Row label="Attendance" value="70%" accent />
          <Row label="Revenue" value="$0" />
        </div>
        <div className="mt-3 flex items-end gap-1.5">
          {[38, 52, 47, 63, 71, 66, 80].map((h, i) => (
            <div key={i} className="flex-1 rounded-t bg-brand-gradient" style={{ height: `${h}%` }} />
          ))}
        </div>
        <div className="mt-3 flex items-start gap-1.5 rounded-lg bg-flame/10 p-2 text-[10px] text-flame">
          <Sparkles className="mt-0.5 size-3 shrink-0" />
          Best next slot: a Thursday evening in 5–6 weeks. Email your waitlist first.
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

  const last = i === steps.length - 1
  const go = useCallback((next: number) => setI((next + steps.length) % steps.length), [])

  useEffect(() => {
    if (!open || paused || last) return
    timer.current = setTimeout(() => setI((v) => v + 1), AUTOPLAY_MS)
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [open, paused, last, i])

  // Restart from the top each time the dialog opens.
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
        <DialogTitle className="sr-only">EventNexus system walkthrough</DialogTitle>

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
                className="relative h-1 flex-1 overflow-hidden rounded-full bg-white/10"
              >
                <span
                  key={idx === i ? `run-${i}-${paused}-${last}` : `idle-${idx}-${idx < i}`}
                  className={`absolute inset-0 rounded-full bg-white/70 ${
                    idx < i ? "translate-x-0" : idx === i ? "" : "-translate-x-full"
                  }`}
                  style={
                    idx === i && !paused && !last
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

          {/* caption */}
          <div className="mt-4">
            <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-white/40">
              <span className={`rounded-full px-2 py-0.5 ${roleStyle[step.role]}`}>{step.role}</span>
              Step {i + 1} of {steps.length}
              {paused && !last && <Pause className="size-3" />}
            </div>
            <h3 className="font-display mt-2 text-base font-bold text-white">{step.title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-white/60">{step.caption}</p>
          </div>

          {/* advance controls */}
          <div className="mt-4 flex items-center justify-between gap-3">
            <button
              onClick={() => go(i - 1)}
              disabled={i === 0}
              className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-[13px] font-medium text-white/70 transition-colors hover:bg-white/10 hover:text-white disabled:pointer-events-none disabled:opacity-30"
            >
              <ChevronLeft className="size-4" /> Back
            </button>

            {last ? (
              <button
                onClick={() => setI(0)}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-[13px] font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5"
              >
                <RotateCcw className="size-4" /> Replay walkthrough
              </button>
            ) : (
              <button
                onClick={() => go(i + 1)}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-[13px] font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5"
              >
                Next <ChevronRight className="size-4" />
              </button>
            )}
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
