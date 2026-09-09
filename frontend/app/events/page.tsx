"use client"

import { useState, useMemo, useEffect } from "react"
import { AppShell } from "@/components/app/app-shell"
import { EventCard } from "@/components/app/event-card"
import { Reveal } from "@/components/anim/reveal"
import { useAllEvents } from "@/lib/queries/events"
import { useRecommendations } from "@/lib/queries/recommendations"
import { useMyTickets, useRegisterForEvent } from "@/lib/queries/tickets"
import { useCurrentUser } from "@/lib/queries/auth"
import { toAppEvent } from "@/lib/adapters/event"
import { useDebounce } from "@/lib/hooks/use-debounce"
import { Pagination } from "@/components/app/pagination"
import { EVENT_CATEGORIES, EVENT_TYPES } from "@/lib/constants/event-options"
import { Loader2, Search, Sparkles, X } from "lucide-react"
import { useQueryClient } from "@tanstack/react-query"
import { getSocket } from "@/lib/socket"
import { useRouter } from "next/navigation"

const statusOptions = [
  { label: "Any status", value: "all" },
  { label: "Upcoming", value: "Upcoming" },
  { label: "Live", value: "Live" },
  { label: "Past", value: "Past" },
]

const sortOptions = [
  { label: "Newest first", value: "-createdAt" },
  { label: "Soonest date", value: "date" },
  { label: "Latest date", value: "-date" },
  { label: "Title A–Z", value: "title" },
  { label: "Most registered", value: "-registered" },
]

// A newly published event should land on top for attendees — the browse
// list defaults to Newest first, and the "Just added" strip mirrors the
// newest-created listings at the top of the page.

export default function AttendeeEventsPage() {
  const { data: userData } = useCurrentUser()
  const [query, setQuery] = useState("")
  const [activeCategory, setActiveCategory] = useState("All")
  const [types, setTypes] = useState<string[]>([])
  const [status, setStatus] = useState("all")
  const [sort, setSort] = useState("-createdAt")
  const [page, setPage] = useState(1)
  const [showFilters, setShowFilters] = useState(false)
  const debouncedQuery = useDebounce(query, 400)
  const user = userData?.user
  const router = useRouter()
  const queryClient = useQueryClient()
  const { data: ticketData } = useMyTickets({ limit: 100 })
  const registerMut = useRegisterForEvent()
  const [joiningId, setJoiningId] = useState<string | null>(null)

  // Seed filters from the URL (?q= from the topbar; ?category=, ?status= and
  // ?filters=1 from the site nav / footer "Categories" and "Upcoming Events"
  // links). Done in an effect, not a state initializer, so it stays
  // hydration-safe on the server render.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    const q = sp.get("q")
    if (q) setQuery(q)
    const cat = sp.get("category")
    if (cat && (["All", ...EVENT_CATEGORIES] as string[]).includes(cat)) setActiveCategory(cat)
    const st = sp.get("status")
    if (st && statusOptions.some((o) => o.value === st)) setStatus(st)
    if (sp.get("filters") === "1" || cat) setShowFilters(true)
  }, [])

  // Real-time: when an organizer publishes a new event, invalidate lists so
  // Just added / Discover update instantly without manual refresh.
  // Lazy-load socket.io chunk; use async import so initial bundle stays lean.
  useEffect(() => {
    let activeSocket: ReturnType<typeof getSocket> = null
    let cancelled = false
    const onNewEvent = () => {
      queryClient.invalidateQueries({ queryKey: ["events"] })
    }
    const syncSocket = getSocket()
    if (syncSocket) {
      activeSocket = syncSocket
      syncSocket.on("event:created", onNewEvent)
    } else {
      void import("@/lib/socket").then(({ getSocketAsync }) =>
        getSocketAsync().then((s) => {
          if (s && !cancelled) {
            activeSocket = s
            s.on("event:created", onNewEvent)
          }
        })
      )
    }
    const onReady = () => {
      const s = getSocket()
      if (s && !cancelled && s !== activeSocket) {
        activeSocket = s
        s.on("event:created", onNewEvent)
      }
    }
    window.addEventListener("socket:ready", onReady)
    return () => {
      cancelled = true
      window.removeEventListener("socket:ready", onReady)
      if (activeSocket) activeSocket.off("event:created", onNewEvent)
    }
  }, [queryClient])

  // One-click join for free events — attendee stays on Discover, gets instant feedback.
  // Paid events redirect to detail page for checkout choice (eSewa/Stripe).
  const registeredIds = useMemo(() => {
    const tickets = ticketData?.tickets ?? []
    return new Set(tickets.filter((t) => t.status !== "cancelled").map((t) => typeof t.event === "string" ? t.event : (t.event as any)._id))
  }, [ticketData])

  const handleQuickJoin = (eventId: string, isFree: boolean) => {
    if (!isFree) {
      router.push(`/event/${eventId}`)
      return
    }
    setJoiningId(eventId)
    registerMut.mutate(eventId, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["tickets"] })
        queryClient.invalidateQueries({ queryKey: ["events"] })
      },
      onSettled: () => setJoiningId(null),
    })
  }

  const { data, isLoading, isError } = useAllEvents({
    search: debouncedQuery,
    category: activeCategory === "All" ? undefined : activeCategory,
    type: types.length ? types.join(",") : undefined,
    status,
    sort,
    page,
    limit: 12,
  })
  // The real recommendation engine (backend/src/utils/recommendationEngine.js
  // — CF via the AI service, or a deterministic fallback) ranks by actual
  // interest/proximity/demand signals.
  const { data: recommendationsData } = useRecommendations()

  // The newest-created events, shown at the very top (independent of the
  // browse filters so a fresh event is always visible). Past events are
  // filtered out client-side so the strip stays forward-looking.
  const { data: newlyAddedData } = useAllEvents({ sort: "-createdAt", limit: 3 })
  const newlyAdded = useMemo(
    () =>
      (newlyAddedData?.events ?? [])
        .filter((e) => e.status !== "Past")
        .slice(0, 3)
        .map(toAppEvent),
    [newlyAddedData]
  )

  const events = useMemo(() => (data?.events ?? []).map(toAppEvent), [data])
  const recommended = useMemo(
    () => (recommendationsData?.recommendations ?? []).slice(0, 3).map((r) => toAppEvent(r.event)),
    [recommendationsData]
  )

  const toggleType = (t: string) => {
    setTypes((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))
    setPage(1)
  }

  const resetFilters = () => {
    setQuery("")
    setActiveCategory("All")
    setTypes([])
    setStatus("all")
    setSort("-createdAt")
    setPage(1)
  }

  const activeFilterCount =
    (activeCategory !== "All" ? 1 : 0) + types.length + (status !== "all" ? 1 : 0) + (sort !== "-createdAt" ? 1 : 0)

  const filterPanel = (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Search</p>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setPage(1)
            }}
            placeholder="Title, venue, topic…"
            className="w-full rounded-xl border border-border bg-card py-2 pl-9 pr-8 text-sm text-ink outline-none transition-all focus:border-primary focus:ring-4 focus:ring-primary/10"
          />
          {query && (
            <button
              onClick={() => setQuery("")}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-ink"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Category</p>
        <div className="space-y-1">
          {["All", ...EVENT_CATEGORIES].map((c) => (
            <button
              key={c}
              onClick={() => {
                setActiveCategory(c)
                setPage(1)
              }}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-1.5 text-sm transition-colors ${
                activeCategory === c
                  ? "bg-primary/10 font-semibold text-primary"
                  : "text-muted-foreground hover:bg-muted hover:text-ink"
              }`}
            >
              {c}
              {activeCategory === c && <span className="size-1.5 rounded-full bg-primary" />}
            </button>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Format</p>
        <div className="space-y-1">
          {EVENT_TYPES.map((t) => (
            <label key={t} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-3 py-1.5 text-sm text-ink transition-colors hover:bg-muted">
              <input
                type="checkbox"
                checked={types.includes(t)}
                onChange={() => toggleType(t)}
                className="size-4 rounded border-border accent-primary"
              />
              {t}
            </label>
          ))}
        </div>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Status</p>
        <select
          value={status}
          onChange={(e) => {
            setStatus(e.target.value)
            setPage(1)
          }}
          className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium text-ink outline-none transition-colors focus:border-primary"
        >
          {statusOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Sort by</p>
        <select
          value={sort}
          onChange={(e) => {
            setSort(e.target.value)
            setPage(1)
          }}
          className="w-full rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium text-ink outline-none transition-colors focus:border-primary"
        >
          {sortOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {activeFilterCount > 0 && (
        <button
          onClick={resetFilters}
          className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-border py-2 text-sm font-medium text-ink transition-colors hover:bg-muted"
        >
          <X className="size-3.5" /> Clear filters ({activeFilterCount})
        </button>
      )}
    </div>
  )

  return (
    <AppShell role="Attendee" userName={user?.name || "Attendee"} title="Discover Events">
      <div className="space-y-8">
        <Reveal y={16}>
          <div className="bg-brand-gradient relative overflow-hidden rounded-2xl p-7 text-white">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_88%_15%,rgba(255,255,255,0.28),transparent_50%)]" />
            <div className="relative">
              <h2 className="font-display text-2xl font-bold">Find your next event</h2>
              <p className="mt-1 text-sm text-white/80">{data?.pagination?.total ?? events.length} events available — new events appear first</p>
              <div className="mt-5 flex max-w-xl items-center gap-2 rounded-xl bg-white p-1.5">
                <Search className="ml-2 size-5 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value)
                    setPage(1)
                  }}
                  placeholder="Search events, organizers, topics..."
                  className="flex-1 bg-transparent px-1 py-2 text-sm text-ink outline-none"
                />
                {query && (
                  <button
                    onClick={() => setQuery("")}
                    aria-label="Clear search"
                    className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </Reveal>

        {newlyAdded.length > 0 && (
          <div>
            <Reveal y={14} className="mb-4 flex items-center gap-2">
              <span className="bg-brand-gradient flex size-8 items-center justify-center rounded-lg text-white">
                <Sparkles className="size-4" />
              </span>
              <h3 className="font-display text-lg font-bold text-ink">Just added</h3>
              <span className="rounded-full bg-flame/10 px-2 py-0.5 text-[11px] font-semibold text-flame">Newest</span>
            </Reveal>
            <Reveal stagger={0.08} y={24} className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {newlyAdded.map((e) => (
                <EventCard 
                  key={e.id} 
                  event={e} 
                  quickJoin={user?.role === "attendee" ? (id) => handleQuickJoin(id, e.price === "Free") : undefined}
                  isRegistered={registeredIds.has(e.id)}
                  isJoining={joiningId === e.id}
                />
              ))}
            </Reveal>
          </div>
        )}

        {recommended.length > 0 && (
          <div id="ai">
            <Reveal y={14} className="mb-4 flex items-center gap-2">
              <span className="bg-brand-gradient flex size-8 items-center justify-center rounded-lg text-white">
                <Sparkles className="size-4" />
              </span>
              <h3 className="font-display text-lg font-bold text-ink">Suggested for you</h3>
              <span className="rounded-full bg-secondary/12 px-2 py-0.5 text-[11px] font-semibold text-secondary">AI matched</span>
            </Reveal>
            <Reveal stagger={0.1} y={28} className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {recommended.map((e) => (
                <EventCard 
                  key={e.id} 
                  event={e} 
                  quickJoin={user?.role === "attendee" ? (id) => handleQuickJoin(id, e.price === "Free") : undefined}
                  isRegistered={registeredIds.has(e.id)}
                  isJoining={joiningId === e.id}
                />
              ))}
            </Reveal>
          </div>
        )}

        <div className="grid gap-8 lg:grid-cols-[240px_1fr]">
          <Reveal x={-16} className="hidden lg:block">
            <aside className="sticky top-24 rounded-2xl border border-border bg-card p-5">{filterPanel}</aside>
          </Reveal>

          <div>
            <Reveal className="mb-5 flex flex-wrap items-center gap-2 lg:hidden">
              <button
                onClick={() => setShowFilters((v) => !v)}
                className="rounded-xl border border-border bg-card px-3.5 py-2 text-sm font-medium text-ink transition-colors hover:bg-muted"
              >
                {showFilters ? "Hide filters" : `Filters${activeFilterCount ? ` (${activeFilterCount})` : ""}`}
              </button>
              <select
                value={sort}
                onChange={(e) => {
                  setSort(e.target.value)
                  setPage(1)
                }}
                className="ml-auto rounded-xl border border-border bg-card px-3 py-2 text-sm font-medium text-ink outline-none focus:border-primary"
              >
                {sortOptions.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </Reveal>
            {showFilters && <div className="mb-5 rounded-2xl border border-border bg-card p-5 lg:hidden">{filterPanel}</div>}

            <Reveal className="mb-5 flex flex-wrap items-center gap-2">
              {["All", ...EVENT_CATEGORIES].map((c) => (
                <button
                  key={c}
                  onClick={() => {
                    setActiveCategory(c)
                    setPage(1)
                  }}
                  className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${
                    activeCategory === c
                      ? "bg-ink text-white"
                      : "border border-border bg-card text-muted-foreground hover:text-ink"
                  }`}
                >
                  {c}
                </button>
              ))}
              <span className="ml-auto hidden text-sm text-muted-foreground lg:block">
                Sorted by {sortOptions.find((o) => o.value === sort)?.label.toLowerCase()}
              </span>
            </Reveal>

            {isLoading ? (
              <div className="flex items-center justify-center py-16">
                <Loader2 className="size-6 animate-spin text-primary" />
              </div>
            ) : isError ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 py-6 text-center text-sm text-amber-700">
                Could not load events. Make sure the backend is running.
              </div>
            ) : events.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border bg-card py-16 text-center">
                <p className="text-sm text-muted-foreground">No events match your search.</p>
                {activeFilterCount > 0 && (
                  <button onClick={resetFilters} className="mt-3 text-sm font-semibold text-primary hover:underline">
                    Clear all filters
                  </button>
                )}
              </div>
            ) : (
              <Reveal stagger={0.07} y={28} className="grid gap-6 sm:grid-cols-2 xl:grid-cols-3">
                {events.map((e) => (
                  <EventCard 
                    key={e.id} 
                    event={e} 
                    quickJoin={user?.role === "attendee" ? (id) => handleQuickJoin(id, e.price === "Free") : undefined}
                    isRegistered={registeredIds.has(e.id)}
                    isJoining={joiningId === e.id}
                  />
                ))}
              </Reveal>
            )}
            {data?.pagination && data.pagination.totalPages > 1 && (
              <div className="mt-6">
                <Pagination pagination={data.pagination} onPageChange={setPage} />
              </div>
            )}
          </div>
        </div>
      </div>
    </AppShell>
  )
}
