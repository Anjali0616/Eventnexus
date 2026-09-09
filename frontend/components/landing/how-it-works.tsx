"use client"

import { useEffect, useRef, useState } from "react"
import { Sparkles, BarChart3, Users, Calendar, TrendingUp, Mail, Target, Bell, ChevronRight, Zap } from "lucide-react"
import { ensureGsapAsync, prefersReducedMotion } from "@/lib/gsap"

const steps = [
  {
    n: "01",
    title: "Create & Configure",
    desc: "Set up your organization and build events with flexible registration, pricing, and access rules. Define custom workflows, invite collaborators, and configure exactly how attendees will experience your event.",
    stats: [
      { label: "Setup time", value: "5 min" },
      { label: "Custom fields", value: "24" },
      { label: "Integrations", value: "12+" },
    ],
  },
  {
    n: "02",
    title: "AI Personalizes & Promotes",
    desc: "EventNexus matches your events to the right attendees and recommends optimal promotion windows. Smart targeting ensures maximum reach with minimum effort — from email sequences to social pushes.",
    stats: [
      { label: "Reach increase", value: "47.2%" },
      { label: "Emails sent", value: "1,090" },
      { label: "Conversions", value: "10x" },
    ],
  },
  {
    n: "03",
    title: "Manage & Analyze",
    desc: "Monitor check-ins, engagement, and outcomes in real time with live analytics dashboards. Track every metric that matters — attendance rates, revenue, feedback scores — all in one unified view.",
    stats: [
      { label: "Live attendees", value: "2,847" },
      { label: "Check-in rate", value: "94%" },
      { label: "Revenue", value: "$128K" },
    ],
  },
]

function StepOneVisual() {
  return (
    <div className="space-y-4 p-6 text-white text-xs">
      <div className="flex items-center gap-3 mb-2">
        <div className="flex size-8 items-center justify-center rounded-lg bg-[#5b4cf5]/20 border border-[#5b4cf5]/30">
          <Calendar className="size-4 text-[#5b4cf5]" />
        </div>
        <span className="text-sm font-semibold tracking-tight text-white/90">New Event Setup</span>
      </div>
      <div className="space-y-3">
        <div className="rounded-xl bg-white/[0.04] p-3 border border-white/5 shadow-inner">
          <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1">Event Title</div>
          <div className="text-sm font-medium text-white/90">Global AI & Cloud Tech Summit 2026</div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="rounded-xl bg-white/[0.04] p-3 border border-white/5 shadow-inner">
            <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1">Schedule</div>
            <div className="text-xs text-white/90 font-medium">Jun 15-18, 2026</div>
          </div>
          <div className="rounded-xl bg-white/[0.04] p-3 border border-white/5 shadow-inner">
            <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1">Venue Capacity</div>
            <div className="text-xs text-white/90 font-medium">1,200 Seats</div>
          </div>
        </div>
        <div className="rounded-xl bg-white/[0.04] p-3 border border-white/5 shadow-inner">
          <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1.5">Ticket Pricing Strategy</div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-[#00c9a7]/20 px-2.5 py-1 text-[10px] font-semibold text-[#00c9a7] border border-[#00c9a7]/30">Early — $49</span>
            <span className="rounded-full bg-white/5 px-2.5 py-1 text-[10px] font-semibold text-white/60 border border-white/5">Regular — $99</span>
            <span className="rounded-full bg-[#5b4cf5]/15 px-2.5 py-1 text-[10px] font-semibold text-white/60 border border-white/5">VIP Pass — $199</span>
          </div>
        </div>
        <div className="flex items-center gap-3 pt-1 border-t border-white/5 font-sans">
          <div className="flex -space-x-1.5">
            <div className="size-6 rounded-full bg-secondary/30 border border-ink flex items-center justify-center">
              <Users className="size-3 text-secondary" />
            </div>
            <div className="size-6 rounded-full bg-[#5b4cf5]/30 border border-ink" />
            <div className="size-6 rounded-full bg-amber-500/30 border border-ink" />
          </div>
          <span className="text-[11px] text-white/50 font-medium">3 co-organizers synced</span>
        </div>
      </div>
    </div>
  )
}

function StepTwoVisual() {
  return (
    <div className="space-y-4 p-6 text-white text-xs">
      <div className="flex items-center gap-3 mb-2">
        <div className="flex size-8 items-center justify-center rounded-lg bg-[#00c9a7]/20 border border-[#00c9a7]/30">
          <Sparkles className="size-4 text-[#00c9a7]" />
        </div>
        <span className="text-sm font-semibold tracking-tight text-white/90">AI Promotion Engine</span>
        <span className="ml-auto rounded-full bg-emerald-500/10 dark:bg-emerald-500/20 px-2.5 py-1 text-[10px] font-bold text-emerald-400 border border-emerald-500/20">AUTO-RUN</span>
      </div>
      <div className="rounded-xl bg-white/[0.04] p-3.5 border border-white/5 shadow-inner">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-white/60 font-medium">Audience Cohort Match Quality</span>
          <span className="text-xs font-bold text-[#00c9a7]">96.4% Accuracy</span>
        </div>
        <div className="h-2 rounded-full bg-white/10 overflow-hidden">
          <div className="h-full w-[96.4%] rounded-full bg-gradient-to-r from-[#5b4cf5] to-[#00c9a7]" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-xl bg-white/[0.04] p-3.5 border border-white/5 shadow-inner">
          <Mail className="size-4 text-blue-400 mb-1.5" />
          <div className="text-[10px] uppercase tracking-wider text-white/40">Email Sequences</div>
          <div className="text-sm font-bold text-white/90 mt-0.5">89% CTR</div>
        </div>
        <div className="rounded-xl bg-white/[0.04] p-3.5 border border-white/5 shadow-inner">
          <Target className="size-4 text-purple-400 mb-1.5" />
          <div className="text-[10px] uppercase tracking-wider text-white/40">Target Segmentation</div>
          <div className="text-sm font-bold text-white/90 mt-0.5 font-sans">Automated</div>
        </div>
      </div>
      <div className="rounded-xl bg-white/[0.04] p-3 border border-white/5">
        <div className="flex items-center gap-2">
          <Bell className="size-3.5 text-amber-400" />
          <span className="text-xs text-white/80 font-medium"><span className="text-amber-300 font-semibold font-sans">AI Insight:</span> Setup email automation at Tuesday 9:00 AM.</span>
        </div>
      </div>
    </div>
  )
}

function StepThreeVisual() {
  return (
    <div className="space-y-4 p-6 text-white text-xs font-sans">
      <div className="flex items-center gap-3 mb-2">
        <div className="flex size-8 items-center justify-center rounded-lg bg-[#ff6b35]/20 border border-[#ff6b35]/30 font-sans">
          <BarChart3 className="size-4 text-[#ff6b35]" />
        </div>
        <span className="text-sm font-semibold tracking-tight text-white/90">Real-Time Core Metrics</span>
        <span className="ml-auto flex items-center gap-1.5">
          <span className="size-2 rounded-full bg-emerald-400 animate-ping" />
          <span className="text-[10px] font-bold text-emerald-400 tracking-wider">LIVE</span>
        </span>
      </div>
      <div className="grid grid-cols-3 gap-2.5">
        <div className="rounded-xl bg-white/[0.04] p-3 border border-white/5 text-center shadow-inner">
          <div className="text-base font-extrabold text-white">4,120</div>
          <div className="text-[10px] text-white/40 font-medium">Registrants</div>
        </div>
        <div className="rounded-xl bg-white/[0.04] p-3 border border-white/5 text-center shadow-inner">
          <div className="text-base font-extrabold text-[#00c9a7]">96.8%</div>
          <div className="text-[10px] text-white/40 font-medium">Verified QR</div>
        </div>
        <div className="rounded-xl bg-white/[0.04] p-3 border border-white/5 text-center shadow-inner">
          <div className="text-base font-extrabold text-[#ff6b35]">$245K</div>
          <div className="text-[10px] text-white/40 font-medium">Revenue</div>
        </div>
      </div>
      <div className="rounded-xl bg-white/[0.04] p-4 border border-white/5">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-white/60 font-medium">Registration Scaling Curve</span>
          <TrendingUp className="size-3.5 text-[#00c9a7]" />
        </div>
        <div className="flex items-end gap-1.5 h-16 pt-2">
          {[22, 38, 26, 45, 50, 42, 60, 78, 65, 82, 92, 98].map((h, i) => (
            <div key={i} className="flex-1 rounded-sm bg-gradient-to-t from-[#5b4cf5] to-[#00c9a7]" style={{ height: `${h}%` }} />
          ))}
        </div>
      </div>
    </div>
  )
}

const visuals = [StepOneVisual, StepTwoVisual, StepThreeVisual]

export function HowItWorks() {
  const [activeStep, setActiveStep] = useState(0)
  const sectionRef = useRef<HTMLElement>(null)
  const visualContainerRef = useRef<HTMLDivElement>(null)

  // Gentle idle float on the mockup card. No ScrollTrigger / pinning — the
  // earlier pinned-scroll version left the board stuck at opacity:0 and
  // overlapping the section above whenever ScrollTrigger failed to refresh
  // (lazy hero, chunk-split gsap). This section is now a plain tabbed panel.
  useEffect(() => {
    if (prefersReducedMotion()) return
    const section = sectionRef.current
    if (!section) return

    let ctx: any
    let cancelled = false
    void ensureGsapAsync().then((gsap) => {
      if (cancelled || !gsap) return
      ctx = gsap.context(() => {
        gsap.fromTo(
          ".interactive-mockup",
          { y: 5 },
          { y: -5, duration: 2.5, repeat: -1, yoyo: true, ease: "power1.inOut" },
        )
      }, section)
    })
    return () => {
      cancelled = true
      ctx?.revert()
    }
  }, [])

  // Cross-fade the visual when the active step changes.
  useEffect(() => {
    if (prefersReducedMotion()) return
    const visualContainer = visualContainerRef.current
    if (!visualContainer) return

    let cancelled = false
    void ensureGsapAsync().then((gsap) => {
      if (cancelled || !gsap || !visualContainer) return
      gsap.fromTo(
        visualContainer,
        { autoAlpha: 0.35, y: 18, scale: 0.985 },
        {
          autoAlpha: 1,
          y: 0,
          scale: 1,
          duration: 0.38,
          ease: "power2.out",
          overwrite: true,
          clearProps: "transform,opacity,visibility",
        },
      )
    })
    return () => {
      cancelled = true
    }
  }, [activeStep])

  const handleStepClick = (index: number) => setActiveStep(index)

  const VisualComponent = visuals[activeStep]

  return (
    <section 
      ref={sectionRef} 
      id="how" 
      className="bg-[#0b0c15] py-20 text-white relative border-y border-white/5"
    >
      {/* Absolute top/bottom subtle border-light accents to replace fuzzy mud divisions */}
      <div className="absolute top-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent pointer-events-none" />
      <div className="absolute bottom-0 inset-x-0 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent pointer-events-none" />
      
      {/* Decorative localized space glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-[500px] w-[500px] rounded-full opacity-[0.08] blur-[120px] pointer-events-none"
        style={{ background: "radial-gradient(circle, #5b4cf5 0%, #00c9a7 100%)" }}
      />

      <div className="mx-auto max-w-7xl px-6">
        <div className="how-header mx-auto max-w-2xl text-center mb-16">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[#5b4cf5]/10 px-3.5 py-1 text-xs font-semibold text-[#00c9a7] border border-[#5b4cf5]/20 uppercase tracking-widest font-sans">
            <Zap className="size-3 text-[#ff6b35]" /> Core Process
          </span>
          <h2 className="font-display mt-4 text-balance text-3xl font-extrabold tracking-tight sm:text-4xl text-white">
            From Setup to Insight in Three Steps
          </h2>
          <p className="mt-3 text-sm text-white/50 max-w-lg mx-auto font-sans">
            Manage your entire collaboration network within a compact, automated pipeline designed to reduce workload by 80%.
          </p>
        </div>

        {/* Compact Side-by-Side Interactive Board */}
        <div className="interactive-board-shell max-w-5xl mx-auto">
          <div className="interactive-board grid items-center gap-12 lg:grid-cols-12 bg-white/[0.02] rounded-3xl border border-white/5 p-6 lg:p-10 shadow-2xl backdrop-blur-sm">
          
          {/* Left Column: Interactive Progressive Tabs */}
          <div className="relative lg:col-span-6">
            <div className="absolute left-2 top-5 bottom-5 hidden w-px bg-white/5 md:block" />
            <div
              aria-hidden
              className="absolute left-2 top-5 hidden w-px rounded-full bg-gradient-to-b from-[#5b4cf5] via-[#00c9a7] to-[#ff6b35] transition-[height] duration-500 md:block"
              style={{ height: `calc(${((activeStep + 1) / steps.length) * 100}% - 2.5rem)` }}
            />
            <div className="space-y-4 flex flex-col justify-center">
            {steps.map((s, i) => {
              const isActive = activeStep === i
              return (
                <button
                  key={s.n}
                  onClick={() => handleStepClick(i)}
                  className={`group relative text-left p-5 rounded-2xl border transition-all duration-500 cursor-pointer flex gap-4 ${
                    isActive 
                      ? "bg-white/[0.05] border-white/10 shadow-[0_18px_40px_-18px_rgba(0,0,0,0.6)] scale-[1.01]" 
                      : "bg-transparent border-transparent hover:bg-white/[0.01] hover:border-white/5"
                  }`}
                >
                  {/* Progressive indicator line if active */}
                  {isActive && (
                    <div className="absolute left-0 top-0 bottom-0 w-[3px] bg-gradient-to-b from-[#5b4cf5] to-[#00c9a7] rounded-l-full" />
                  )}

                  <span className={`font-mono text-xl font-bold transition-colors ${isActive ? "text-[#00c9a7]" : "text-white/30 group-hover:text-white/50"}`}>
                    {s.n}
                  </span>
                  <div className="space-y-1.5 flex-1 font-sans">
                    <h3 className={`font-display text-base font-bold tracking-tight transition-colors flex items-center gap-1.5 ${isActive ? "text-white" : "text-white/60 group-hover:text-white/95"}`}>
                      {s.title}
                      <ChevronRight className={`size-4 text-[#00c9a7] transition-all ${isActive ? "opacity-100 translate-x-0.5" : "opacity-0 -translate-x-1 group-hover:opacity-60"}`} />
                    </h3>
                    <p className={`text-xs leading-relaxed transition-colors ${isActive ? "text-white/70" : "text-white/40 group-hover:text-white/50"}`}>
                      {s.desc}
                    </p>

                    {/* Compact stats showing on active step tab */}
                    {isActive && (
                      <div className="grid grid-cols-3 gap-4 pt-3 mt-1.5 border-t border-white/5">
                        {s.stats.map((stat) => (
                          <div key={stat.label}>
                            <div className="text-[13px] font-extrabold text-white">{stat.value}</div>
                            <div className="text-[10px] text-white/40">{stat.label}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </button>
              )
            })}
            </div>
          </div>

          {/* Right Column: Visual Mockup Showcase */}
          <div className="lg:col-span-6 flex justify-center lg:pl-4">
            <div className="interactive-mockup relative w-full max-w-sm rounded-2xl bg-gradient-to-tr from-white/[0.01] to-white/[0.04] border border-white/10 shadow-[0_24px_50px_-20px_rgba(0,0,0,0.8)] backdrop-blur overflow-hidden">
              {/* Floating lights inside card */}
              <div className="absolute top-0 right-0 size-40 bg-[#5b4cf5]/10 rounded-full blur-xl pointer-events-none" />
              <div className="absolute bottom-0 left-0 size-40 bg-[#00c9a7]/10 rounded-full blur-xl pointer-events-none" />

              {/* Seamless component fade transition */}
              <div 
                ref={visualContainerRef}
                className="transition-all duration-300 ease-out transform"
              >
                <VisualComponent />
              </div>
            </div>
          </div>

        </div>
        </div>
      </div>
    </section>
  )
}
