"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { 
  ArrowRight, 
  Play, 
  Zap, 
  Calendar, 
  Users, 
  TrendingUp, 
  MessageSquare, 
  Sparkles,
  Search,
  Menu,
  Shield,
  Activity,
  ChevronDown
} from "lucide-react"
import { ensureGsapAsync, prefersReducedMotion } from "@/lib/gsap"
import dynamic from "next/dynamic"
const ContainerScroll = dynamic(() => import("@/components/ui/container-scroll-animation").then((m) => m.ContainerScroll), {
  ssr: false,
})

export function Hero() {
  const root = useRef<HTMLElement>(null)
  const [activeTab, setActiveTab] = useState("overview")

  useEffect(() => {
    const el = root.current
    if (!el) return
    if (prefersReducedMotion()) return
    let ctx: any
    let cancelled = false
    void ensureGsapAsync().then((gsap) => {
      if (cancelled || !gsap) return
      ctx = gsap.context((self: any) => {
        const q = self.selector!
        gsap.from(q(".hero-line"), {
          y: 30,
          opacity: 0,
          duration: 0.8,
          stagger: 0.1,
          delay: 0.1,
        })
      }, root)
    })
    return () => {
      cancelled = true
      ctx?.revert()
    }
  }, [])

  return (
    <section ref={root} className="relative overflow-hidden pt-24 pb-4 md:pt-36 bg-background dark:bg-[#030303]">
      {/* Background glow effects */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-40 left-1/2 -z-10 h-[600px] w-[1000px] -translate-x-1/2 rounded-full opacity-[0.22] blur-3xl"
        style={{ background: "linear-gradient(135deg, #5b4cf5 0%, #00c9a7 100%)" }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute top-[400px] left-1/4 -z-10 h-[400px] w-[600px] rounded-full opacity-[0.12] blur-3xl"
        style={{ background: "linear-gradient(135deg, #ff6b35 0%, #5b4cf5 100%)" }}
      />

      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <ContainerScroll
          titleComponent={
            <div className="flex flex-col items-center">
              <div className="hero-line hero-chip inline-flex items-center gap-2 rounded-full border border-border bg-card/80 dark:bg-zinc-900/80 px-4 py-1.5 text-xs font-semibold text-ink dark:text-white shadow-sm backdrop-blur mb-6 animate-pulse">
                <Zap className="size-3.5 text-flame" />
                AI-Powered · Cloud-Native · Multi-Org
              </div>

              <h1 className="font-display text-balance text-4xl font-extrabold leading-[1.08] tracking-tight text-ink dark:text-white sm:text-5xl md:text-[64px] text-center max-w-4xl">
                <span className="hero-line block">The Smartest Way</span>
                <span className="hero-line block mt-1">
                  to Manage Events —{" "}
                  <span className="relative inline-block">
                    <span className="text-gradient">Together</span>
                    <svg
                      className="absolute -bottom-2 left-0 w-full"
                      viewBox="0 0 200 12"
                      fill="none"
                      preserveAspectRatio="none"
                      aria-hidden
                    >
                      <path d="M2 9C50 3 150 3 198 9" stroke="url(#ug-hero)" strokeWidth="4" strokeLinecap="round" />
                      <defs>
                        <linearGradient id="ug-hero" x1="0" y1="0" x2="200" y2="0">
                          <stop stopColor="#5b4cf5" />
                          <stop offset="1" stopColor="#00c9a7" />
                        </linearGradient>
                      </defs>
                    </svg>
                  </span>
                </span>
              </h1>

              <p className="hero-line mt-8 max-w-2xl text-pretty text-center text-sm sm:text-lg leading-relaxed text-muted-foreground">
                EventNexus brings AI intelligence, secure cloud infrastructure, and real-time
                collaboration to every event — from small workshops to global multi-organization
                conferences.
              </p>

              <div className="hero-line mt-8 flex flex-wrap items-center justify-center gap-4">
                <Link
                  href="/register"
                  className="group inline-flex items-center gap-2 rounded-full bg-primary px-7 py-3.5 text-sm font-semibold text-primary-foreground shadow-[0_12px_32px_-10px_rgba(91,76,245,0.8)] transition-transform hover:-translate-y-0.5 duration-200"
                >
                  Start for Free
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
                </Link>
                <Link
                  href="/dashboard"
                  className="inline-flex items-center gap-2 rounded-full border border-border bg-card dark:bg-zinc-900 px-7 py-3.5 text-sm font-semibold text-ink dark:text-white transition-colors hover:bg-muted dark:hover:bg-zinc-800"
                >
                  <Play className="size-4 fill-current text-primary" />
                  Watch Demo
                </Link>
              </div>
            </div>
          }
        >
          {/* High Fidelity SaaS Event Dashboard Inside the Tilted Frame */}
          <div className="flex h-full w-full bg-[#0a0b10] text-[#a9adc1] text-xs antialiased overflow-hidden">
            {/* 1. Dashboard Sidebar */}
            <aside className="w-48 hidden md:flex flex-col border-r border-white/5 bg-[#07080c] p-4 shrink-0 justify-between">
              <div className="space-y-6">
                {/* Brand Logo & Name */}
                <div className="flex items-center gap-2 px-1">
                  <div className="bg-brand-gradient flex size-7 items-center justify-center rounded-lg text-white font-bold">
                    E
                  </div>
                  <span className="font-display text-sm font-bold text-white tracking-tight">EventNexus</span>
                </div>

                {/* Navigation Items */}
                <nav className="space-y-1">
                  {[
                    { id: "overview", label: "Overview", icon: Activity },
                    { id: "events", label: "Events", icon: Calendar },
                    { id: "analytics", label: "Analytics", icon: TrendingUp },
                    { id: "collaboration", label: "Team", icon: Users },
                    { id: "assistant", label: "AI Assistant", icon: Sparkles },
                  ].map((item) => {
                    const Icon = item.icon
                    const isSelected = activeTab === item.id
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setActiveTab(item.id)}
                        className={`flex w-full items-center gap-3 px-3 py-2.5 rounded-lg font-medium transition-all text-left ${
                          isSelected 
                            ? "bg-white/10 text-white shadow-sm font-semibold" 
                            : "text-[#6b7280] hover:text-white hover:bg-white/5"
                        }`}
                      >
                        <Icon className={`size-4 ${isSelected ? "text-secondary" : ""}`} />
                        {item.label}
                      </button>
                    )
                  })}
                </nav>
              </div>

              {/* Sidebar bottom */}
              <div className="pt-4 border-t border-white/5 space-y-3">
                <div className="flex items-center gap-3 px-2">
                  <div className="size-7 rounded-full bg-indigo-500/20 flex items-center justify-center border border-indigo-500/30">
                    <Shield className="size-3.5 text-indigo-400" />
                  </div>
                  <div>
                    <div className="text-[10px] font-bold text-white">Shield active</div>
                    <div className="text-[9px] text-[#4b5563]">RBAC Protection</div>
                  </div>
                </div>
              </div>
            </aside>

            {/* 2. Main Terminal Panel Area */}
            <div className="flex-1 flex flex-col min-w-0 bg-[#0a0b10]">
              {/* Dashboard Content Header */}
              <header className="h-14 border-b border-white/5 px-4 md:px-6 flex items-center justify-between bg-[#08090d]/80 backdrop-blur-sm sticky top-0 z-10">
                <div className="flex items-center gap-3">
                  <Menu className="size-4 md:hidden text-white" />
                  <div className="flex items-center gap-2 bg-white/5 px-3 py-1.5 rounded-lg border border-white/5 max-w-sm hidden sm:flex">
                    <Search className="size-3.5 text-muted-foreground" />
                    <span className="text-[11px] text-muted-foreground select-none">Search events, metrics, logs...</span>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  {/* Status Indicator */}
                  <div className="flex items-center gap-2 bg-[#022c22] border border-[#064e3b] rounded-full px-2.5 py-1">
                    <span className="size-1.5 rounded-full bg-[#10b981] animate-ping" />
                    <span className="text-[10px] font-mono text-[#34d399] tracking-wider uppercase font-semibold">Live Feed</span>
                  </div>

                  <div className="flex items-center gap-2 text-white">
                    <span className="size-7 rounded-full bg-secondary/20 flex items-center justify-center font-mono border border-secondary/30 text-secondary text-xs">
                      O
                    </span>
                    <span className="font-semibold text-xs hidden sm:inline">Org Admin</span>
                  </div>
                </div>
              </header>

              {/* Workspace Main Area */}
              <main className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
                {/* Statistics Grid */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 md:gap-4">
                  {[
                    { label: "Active Campaigns", value: "38 Events", icon: Calendar, change: "+4 this week", color: "text-flame bg-flame/10" },
                    { label: "Total Registrations", value: "1,248 Users", icon: Users, change: "94.2% attendance", color: "text-primary bg-primary/10" },
                    { label: "AI Match Precision", value: "99.9% Optimal", icon: Sparkles, change: "System healthy", color: "text-secondary bg-secondary/10" }
                  ].map((stat, i) => {
                    const StatIcon = stat.icon;
                    return (
                      <div key={i} className="bg-[#0e0f17] border border-white/5 rounded-xl p-4 flex items-center justify-between hover:border-white/10 transition-colors">
                        <div className="space-y-1">
                          <span className="text-[11px] text-[#63687e] font-medium tracking-tight h-4 block">{stat.label}</span>
                          <h4 className="text-base font-extrabold font-mono text-white tracking-tight">{stat.value}</h4>
                          <span className="text-[10px] text-[#00c9a7] font-mono flex items-center h-4">{stat.change}</span>
                        </div>
                        <div className={`p-2.5 rounded-lg ${stat.color} shrink-0`}>
                          <StatIcon className="size-4" />
                        </div>
                      </div>
                    )
                  })}
                </div>

                {/* Detail View Split Column Layout */}
                <div className="grid grid-cols-1 lg:grid-cols-[1.5fr_1fr] gap-4">
                  
                  {/* Left Box: Graph and Real-time load indicators */}
                  <div className="bg-[#0e0f17]/90 border border-white/5 rounded-2xl p-5 space-y-5">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="text-sm font-bold text-white tracking-tight">AI Predicted Response Activity</h4>
                        <p className="text-[11px] text-[#63687e]">Simulated response patterns vs targeted cohorts</p>
                      </div>
                      <div className="flex gap-1 bg-white/5 rounded-lg p-0.5 border border-white/5">
                        <span className="px-2 py-1 bg-white/[0.08] text-white text-[10px] font-mono rounded-md">Live</span>
                        <span className="px-2 py-1 text-[#6b7280] text-[10px] font-mono hover:text-white cursor-pointer">Historical</span>
                      </div>
                    </div>

                    {/* Styled High Fidelity SVG Path representing modern AI predictive curves */}
                    <div className="relative h-44 w-full flex items-end">
                      <svg className="absolute inset-0 h-full w-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 100 100">
                        {/* Gradients definitions */}
                        <defs>
                          <linearGradient id="area-grad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#5b4cf5" stopOpacity="0.45" />
                            <stop offset="100%" stopColor="#5b4cf5" stopOpacity="0" />
                          </linearGradient>
                          <linearGradient id="area-grad-target" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="#00c9a7" stopOpacity="0.25" />
                            <stop offset="100%" stopColor="#00c9a7" stopOpacity="0" />
                          </linearGradient>
                        </defs>

                        {/* Background guide lines */}
                        <line x1="0" y1="20" x2="100" y2="20" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" strokeDasharray="3 3"/>
                        <line x1="0" y1="50" x2="100" y2="50" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" strokeDasharray="3 3"/>
                        <line x1="0" y1="80" x2="100" y2="80" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" strokeDasharray="3 3"/>

                        {/* Actual Curve 1 Area */}
                        <path d="M 0,100 Q 15,35 30,65 T 60,25 T 90,80 T 100,20 L 100,100 L 0,100 Z" fill="url(#area-grad)" />
                        {/* Actual Curve 1 Line */}
                        <path d="M 0,100 Q 15,35 30,65 T 60,25 T 90,80 T 100,20" fill="none" stroke="#5b4cf5" strokeWidth="2" strokeLinecap="round" />

                        {/* Target Curve 2 Area */}
                        <path d="M 0,100 C 20,80 40,30 60,45 C 80,60 90,10 100,40 L 100,100 L 0,100 Z" fill="url(#area-grad-target)" />
                        {/* Target Curve 2 Line */}
                        <path d="M 0,100 C 20,80 40,30 60,45 C 80,60 90,10 100,40" fill="none" stroke="#00c9a7" strokeWidth="1.5" strokeLinecap="round" strokeDasharray="2 2" />
                      </svg>

                      {/* Floating marker node */}
                      <div className="absolute left-[60%] bottom-[75%] -translate-x-1/2 flex flex-col items-center z-10">
                        <div className="bg-[#5b4cf5] text-white text-[9px] font-mono py-0.5 px-1.5 rounded-md border border-white/10 font-bold shadow-md">
                          Peak Target Reached
                        </div>
                        <div className="size-2 rounded-full bg-white border border-[#5b4cf5] animate-ping" />
                      </div>
                    </div>

                    {/* Sparkline Legends */}
                    <div className="flex items-center gap-4 text-[10px] font-mono">
                      <div className="flex items-center gap-1.5">
                        <span className="size-2 rounded bg-[#5b4cf5]" />
                        <span>Interactive Attendance Cohorts</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="size-2 rounded border border-dashed border-[#00c9a7]" />
                        <span className="text-[#a9adc1]">AI Optimization Window</span>
                      </div>
                    </div>
                  </div>

                  {/* Right Box: Live AI Event chatbot dialog tracker */}
                  <div className="bg-[#0e0f17] border border-white/5 rounded-2xl p-5 flex flex-col h-full justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <MessageSquare className="size-3.5 text-secondary" />
                        <h4 className="text-sm font-bold text-white tracking-tight">Active EventBot Log</h4>
                      </div>
                      <p className="text-[11px] text-[#63687e]">Autonomous attendee support in Tech Summit 2026</p>
                    </div>

                    {/* Mini Chat logs */}
                    <div className="mt-4 space-y-3 flex-1 overflow-visible">
                      <div className="space-y-1 bg-white/5 rounded-xl p-3 border border-white/5">
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-white text-[10px]">Attendee #582</span>
                          <span className="text-[9px] text-[#63687e] font-mono">1s ago</span>
                        </div>
                        <p className="text-[11px] text-white/80 font-medium">"Is regular parking free for general admission ticket holders?"</p>
                      </div>

                      <div className="space-y-1 bg-secondary/10 rounded-xl p-3 border border-secondary/10">
                        <div className="flex justify-between items-center">
                          <span className="font-bold text-secondary text-[10px] flex items-center gap-1">
                            <Sparkles className="size-3 text-secondary animate-pulse" />
                            EventBot AI
                          </span>
                          <span className="text-[9px] text-secondary/60 font-mono">0.4s ago</span>
                        </div>
                        <p className="text-[11px] text-white/90">
                          "Yes, General Admission parking is free in Sector B. Early arrival is highly recommended since spots fill quickly!"
                        </p>
                      </div>
                    </div>

                    <div className="border-t border-white/5 pt-3.5 mt-3 flex items-center justify-between text-[10px] font-mono">
                      <span className="text-[#63687e]">Success satisfaction auto-resolution rate</span>
                      <span className="text-[#00c9a7] font-bold">96.8%</span>
                    </div>
                  </div>

                </div>
              </main>
            </div>
          </div>
        </ContainerScroll>
      </div>
    </section>
  )
}
