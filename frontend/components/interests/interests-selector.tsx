"use client"

import { Check } from "lucide-react"
import { EVENT_CATEGORIES } from "@/lib/constants/event-options"

const CATEGORY_META: Record<string, { emoji: string; desc: string }> = {
  Technology: { emoji: "💻", desc: "AI, coding, cloud" },
  Business: { emoji: "💼", desc: "Startups, networking" },
  Academic: { emoji: "🎓", desc: "Research, education" },
  Workshop: { emoji: "🛠️", desc: "Hands-on learning" },
  Social: { emoji: "🎉", desc: "Community gatherings" },
  Health: { emoji: "🧘", desc: "Wellness, fitness" },
  Arts: { emoji: "🎨", desc: "Design, creativity" },
  Music: { emoji: "🎵", desc: "Concerts, festivals" },
  Sports: { emoji: "⚽", desc: "Games, athletics" },
  Networking: { emoji: "🤝", desc: "Meet & connect" },
}

type Props = {
  value: string[]
  onChange: (next: string[]) => void
  disabled?: boolean
  size?: "default" | "compact"
}

export function InterestsSelector({ value, onChange, disabled, size = "default" }: Props) {
  const toggle = (cat: string) => {
    if (disabled) return
    if (value.includes(cat)) onChange(value.filter((v) => v !== cat))
    else if (value.length < 10) onChange([...value, cat])
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {EVENT_CATEGORIES.map((cat) => {
          const active = value.includes(cat)
          const meta = CATEGORY_META[cat] || { emoji: "✨", desc: cat }
          return (
            <button
              key={cat}
              type="button"
              disabled={disabled}
              onClick={() => toggle(cat)}
              aria-pressed={active}
              className={`group relative inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-all ${
                active
                  ? "border-primary bg-primary text-primary-foreground shadow-[0_4px_12px_-4px_rgba(91,76,245,0.5)]"
                  : "border-border bg-card text-muted-foreground hover:border-primary/40 hover:bg-primary/5 hover:text-ink"
              } ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer hover:-translate-y-0.5"} ${
                size === "compact" ? "px-3 py-1.5 text-xs" : ""
              }`}
            >
              <span className={`flex size-6 items-center justify-center rounded-full text-xs ${active ? "bg-white/20" : "bg-muted"}`}>
                {meta.emoji}
              </span>
              <span>{cat}</span>
              {active && <Check className="size-3.5 shrink-0" />}
            </button>
          )
        })}
      </div>
      <p className="text-xs text-muted-foreground">
        {value.length === 0
          ? "Pick at least 2 interests for the best recommendations — you can skip for now."
          : `${value.length} selected · ${value.join(", ")}`}
      </p>
    </div>
  )
}
