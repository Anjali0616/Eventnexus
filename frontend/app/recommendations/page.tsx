"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import {
  Calendar,
  Check,
  Compass,
  Loader2,
  MapPin,
  Navigation,
  Search,
  Sparkles,
  TrendingUp,
  Users,
  Wifi,
  X,
} from "lucide-react"
import { AppShell } from "@/components/app/app-shell"
import { StatCard } from "@/components/app/stat-card"
import { Reveal } from "@/components/anim/reveal"
import { Pagination } from "@/components/app/pagination"
import { useDebounce } from "@/lib/hooks/use-debounce"
import { useRecommendations } from "@/lib/queries/recommendations"
import { useUpdateLocation } from "@/lib/queries/location"
import { useMyTickets, useRegisterForEvent } from "@/lib/queries/tickets"
import { useCurrentUser } from "@/lib/queries/auth"
import { EVENT_CATEGORIES } from "@/lib/constants/event-options"
import { formatPrice, isFreeEvent } from "@/lib/price"
import type { Recommendation } from "@/lib/api/recommendations"

// Compact match-score ring — a dynamic, at-a-glance "how well this fits
// you" gauge drawn as an SVG arc (score is normalized 0..100 by the engine).
function ScoreRing({ score, size = 44 }: { score: number; size?: number }) {
  const clamped = Math.max(0, Math.min(100, score))
  const stroke = 3.5
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const offset = c - (clamped / 100) * c
  const color = clamped >= 80 ? "#10b981" : clamped >= 50 ? "#5b4cf5" : "#f59e0b"
  return (
    <div className="relative shrink-0" style={{ width: size, height: size }} aria-label={`${clamped}% match`}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth={stroke} className="text-muted" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={offset}
          style={{ transition: "stroke-dashoffset 0.8s cubic-bezier(0.22,1,0.36,1)" }}
        />
      </svg>
      <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold" style={{ color }}>
        {clamped}
      </span>
    </div>
  )
}

function SkeletonCard() {
  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="h-24 animate-pulse bg-muted" />
      <div className="space-y-3 p-5">
        <div className="h-3 w-16 animate-pulse rounded bg-muted" />
        <div className="h-4 w-4/5 animate-pulse rounded bg-muted" />
        <div className="h-3 w-full animate-pulse rounded bg-muted" />
        <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
        <div className="h-9 w-full animate-pulse rounded-xl bg-muted" />
      </div>
    </div>
  )
}

const categoryOptions = [
  { label: "All categories", value: "all" },
  ...EVENT_CATEGORIES.map((c) => ({ label: c, value: c })),
]

function RecommendationCard({
  rec,
  rank,
  isRegistered,
  pending,
  onRegister,
}: {
  rec: Recommendation
  rank: number
  isRegistered: boolean
  pending: boolean
  onRegister: () => void
}) {
  const { event, score, distanceKm, reason } = rec
  const pct = event.capacity > 0 ? Math.round((event.registered / event.capacity) * 100) : 0
  const free = isFreeEvent(event.price)
  const isPast = new Date(event.date).getTime() <= Date.now()
  const rankLabel = rank === 1 ? "Top pick" : rank === 2 ? "Runner-up" : rank === 3 ? "Trending" : null

  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-all duration-300 hover:-translate-y-1 hover:border-primary/30 hover:shadow-[0_18px_40px_-20px_rgba(91,76,245,0.35)]">
      {/* Cover — clicking the card opens the full event detail view */}
      <Link href={`/event/${event._id}`} className="relative block h-28 overflow-hidden bg-brand-gradient" aria-label={`View ${event.title} details`}>
        {event.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={event.imageUrl} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105" />
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_75%_20%,rgba(255,255,255,0.35),transparent_55%)]" />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />
        {rankLabel && (
          <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-bold text-ink shadow-sm">
            <Sparkles className="size-3 text-primary" /> #{rank} {rankLabel}
          </span>
        )}
        <span className="absolute bottom-3 left-3 rounded-full bg-black/30 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">
          {event.category}
        </span>
        <span className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-full bg-black/30 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">
          {free ? "Free" : formatPrice(event.price)}
        </span>
      </Link>

      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link href={`/event/${event._id}`} className="font-display line-clamp-2 text-base font-bold leading-snug text-ink transition-colors hover:text-primary">
              {event.title}
            </Link>
            <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{event.description}</p>
          </div>
          <ScoreRing score={score} />
        </div>

        {reason && (
          <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-primary/5 p-3 text-xs leading-relaxed text-ink">
            <Sparkles className="mt-0.5 size-3.5 shrink-0 text-primary" />
            <span>
              <span className="font-semibold text-primary">Why this pick: </span>
              {reason}
            </span>
          </p>
        )}

        <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Calendar className="size-3.5" /> {new Date(event.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
          <span className="flex items-center gap-1.5">
            <MapPin className="size-3.5" /> {event.venue}
          </span>
          {distanceKm != null && (
            <span className="flex items-center gap-1.5 font-medium text-primary">
              <Navigation className="size-3.5" /> {distanceKm} km away
            </span>
          )}
          {event.predictedAttendance != null && event.predictedAttendance > event.registered && (
            <span className="flex items-center gap-1.5 font-medium text-secondary">
              <TrendingUp className="size-3.5" /> ~{event.predictedAttendance} expected
            </span>
          )}
        </div>

        <div className="mt-3.5">
          <div className="flex items-center justify-between text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Users className="size-3" /> {event.registered}/{event.capacity} registered
            </span>
            <span>{Math.max(0, event.capacity - event.registered)} spots left</span>
          </div>
          <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={`h-full rounded-full transition-all duration-700 ${pct >= 90 ? "bg-flame" : "bg-brand-gradient"}`}
              style={{ width: `${Math.min(100, pct)}%` }}
            />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          {isRegistered ? (
            <span className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-secondary/15 px-4 py-2.5 text-sm font-semibold text-secondary">
              <Check className="size-4" /> Registered
            </span>
          ) : (
            <button
              onClick={onRegister}
              disabled={pending || isPast}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-60"
            >
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Compass className="size-4" />}
              {isPast ? "Concluded" : pending ? "Registering…" : "Register now"}
            </button>
          )}
          <Link
            href={`/event/${event._id}`}
            className="rounded-xl border border-border px-3.5 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-muted"
          >
            Details
          </Link>
        </div>
      </div>
    </div>
  )
}

export default function AttendeeRecommendationsPage() {
  const router = useRouter()
  const { data: userData } = useCurrentUser()
  const [category, setCategory] = useState("all")
  const [search, setSearch] = useState("")
  const [page, setPage] = useState(1)
  // Which card is mid-registration. Mirrors the Discover page's joiningId — the
  // mutation object is shared by every card, so its isPending can't identify one.
  const [joiningId, setJoiningId] = useState<string | null>(null)
  const debouncedSearch = useDebounce(search, 350)
  const { data, isLoading, isError, refetch } = useRecommendations({
    category: category === "all" ? undefined : category,
    search: debouncedSearch || undefined,
    page,
    limit: 9,
  })
  const { data: ticketData } = useMyTickets({ limit: 100 })
  const registerMutation = useRegisterForEvent()
  const updateLocation = useUpdateLocation()
  const user = userData?.user

  const recommendations = data?.recommendations ?? []
  const hasLocation = data?.hasLocation ?? false
  const pagination = data?.pagination
  const registeredEventIds = new Set(
    (ticketData?.tickets ?? [])
      .filter((t) => t.status !== "cancelled")
      .map((t) => (typeof t.event === "object" ? t.event._id : t.event))
  )

  const topScore = recommendations[0]?.score ?? 0
  const trendingCount = recommendations.filter((r) => r.event.registered / Math.max(1, r.event.capacity) > 0.5).length
  const predictedTotal = recommendations.reduce((sum, r) => sum + (r.event.predictedAttendance ?? 0), 0)

  const handleRegister = (eventId: string) => {
    if (registeredEventIds.has(eventId) || joiningId) return
    // Paid events must go through checkout (eSewa/Stripe) — the direct register
    // endpoint 400s with "requires payment". Redirect to detail for rail choice.
    const rec = recommendations.find((r) => r.event._id === eventId)
    if (rec && !isFreeEvent(rec.event.price)) {
      router.push(`/event/${eventId}`)
      return
    }
    // Past / full events are disabled at the card level but guard here too
    if (rec && new Date(rec.event.date).getTime() <= Date.now()) return
    if (rec && rec.event.registered >= rec.event.capacity) return
    // Track the specific card: registerMutation.isPending is shared across every
    // rendered card, so using it here put all of them into "Registering…" at once.
    setJoiningId(eventId)
    registerMutation.mutate(eventId, {
      onSettled: () => setJoiningId(null),
    })
  }

  return (
    <AppShell role="Attendee" userName={user?.name || "Attendee"} title="Recommendations">
      <div className="space-y-8">
        <Reveal>
          <div className="relative overflow-hidden rounded-2xl bg-brand-gradient p-6 text-white">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_85%_15%,rgba(255,255,255,0.25),transparent_55%)]" />
            <div className="relative flex flex-wrap items-end justify-between gap-4">
              <div>
                <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-widest text-white/70">
                  <Sparkles className="size-3.5" /> AI personalized picks
                </p>
                <h1 className="font-display mt-1.5 text-2xl font-bold tracking-tight">
                  {user ? `Hand-picked for you, ${user.name.split(" ")[0]}` : "Hand-picked for you"}
                </h1>
                <p className="mt-1 max-w-xl text-sm text-white/80">
                  Every pick is ranked from your interests, live registration demand, predicted turnout, and how close the event is to you.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-[11px] font-medium">
                {["Interest match", "Proximity", "Live demand", "Predicted turnout"].map((f) => (
                  <span key={f} className="rounded-full bg-white/15 px-3 py-1.5 backdrop-blur">
                    {f}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </Reveal>

        {!hasLocation && !updateLocation.isPending && (
          <Reveal className="flex flex-col items-start justify-between gap-3 rounded-2xl border border-primary/20 bg-primary/5 px-5 py-4 sm:flex-row sm:items-center">
            <div className="flex items-start gap-3">
              <Navigation className="mt-0.5 size-5 shrink-0 text-primary" />
              <div>
                <p className="text-sm font-semibold text-ink">Get events near you</p>
                <p className="text-xs text-muted-foreground">
                  Share your location and we&apos;ll prioritize events closest to you.
                </p>
              </div>
            </div>
            <button
              onClick={() => updateLocation.mutate()}
              disabled={updateLocation.isPending}
              className="flex shrink-0 items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:opacity-60"
            >
              {updateLocation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Navigation className="size-4" />}
              Enable location
            </button>
          </Reveal>
        )}

        {updateLocation.isError && (
          <p className="text-xs text-amber-600">
            Couldn&apos;t get your location. Check that location access is allowed in your browser.
          </p>
        )}

        <Reveal stagger={0.08} y={24} className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Matched Events" value={recommendations.length} icon={Compass} accent="primary" />
          <StatCard label="Top Match Score" value={topScore} suffix="%" icon={Sparkles} accent="secondary" />
          <StatCard label="Trending Picks" value={trendingCount} icon={TrendingUp} accent="flame" />
          <StatCard label="Predicted Turnout" value={predictedTotal} icon={Users} accent="primary" />
        </Reveal>

        {/* Dynamic filters — category chips + search, both server-filtered */}
        <Reveal className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              placeholder="Search events, venues, topics..."
              className="w-full rounded-xl border border-border bg-card py-2.5 pl-9 pr-9 text-sm outline-none transition-colors focus:border-primary focus:ring-4 focus:ring-primary/10"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground transition-colors hover:text-ink"
                aria-label="Clear search"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {categoryOptions.map((c) => {
              const active = category === c.value
              return (
                <button
                  key={c.value}
                  onClick={() => {
                    setCategory(c.value)
                    setPage(1)
                  }}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-all ${
                    active
                      ? "bg-ink text-white shadow-sm"
                      : "border border-border bg-card text-muted-foreground hover:border-primary/40 hover:text-ink"
                  }`}
                >
                  {c.label}
                </button>
              )
            })}
          </div>
        </Reveal>

        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {isLoading
              ? "Ranking events…"
              : `${pagination?.total ?? 0} event${(pagination?.total ?? 0) === 1 ? "" : "s"} matched${category !== "all" ? ` in ${category}` : ""}${debouncedSearch ? ` for "${debouncedSearch}"` : ""}`}
          </span>
          {isLoading && (
            <span className="inline-flex items-center gap-1.5">
              <Wifi className="size-3.5 animate-pulse text-primary" /> AI ranking live
            </span>
          )}
        </div>

        {isLoading ? (
          <Reveal stagger={0.08} y={24} className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i} />
            ))}
          </Reveal>
        ) : isError ? (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card py-16 text-center">
            <p className="text-sm text-muted-foreground">We couldn&apos;t fetch your recommendations right now.</p>
            <button
              onClick={() => refetch()}
              className="rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5"
            >
              Try again
            </button>
          </div>
        ) : (
          <Reveal stagger={0.08} y={24} className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
            {recommendations.map((rec, i) => (
              <RecommendationCard
                key={rec.event._id}
                rec={rec}
                rank={i + 1}
                isRegistered={registeredEventIds.has(rec.event._id)}
                pending={joiningId === rec.event._id}
                onRegister={() => handleRegister(rec.event._id)}
              />
            ))}
          </Reveal>
        )}

        {!isLoading && !isError && recommendations.length === 0 && (
          <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border bg-card py-16 text-center">
            <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10">
              <Compass className="size-6 text-primary" />
            </span>
            <div>
              <p className="font-display text-base font-bold text-ink">
                {debouncedSearch || category !== "all" ? "Nothing matches those filters" : "No recommendations yet"}
              </p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                {debouncedSearch || category !== "all"
                  ? "Try a different category or keyword — every pick updates live from the ranking engine."
                  : "Register for a few events to help us learn your interests, or browse everything on the Discover page."}
              </p>
            </div>
            {!debouncedSearch && category === "all" && (
              <Link
                href="/dashboard"
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-[0_8px_20px_-10px_rgba(91,76,245,0.8)] transition-transform hover:-translate-y-0.5"
              >
                <Compass className="size-4" /> Browse all events
              </Link>
            )}
          </div>
        )}

        {pagination && pagination.totalPages > 1 && (
          <Pagination pagination={pagination} onPageChange={setPage} />
        )}
      </div>
    </AppShell>
  )
}