"use client"

import { useState } from "react"
import Link from "next/link"
import { AppShell } from "@/components/app/app-shell"
import { Reveal } from "@/components/anim/reveal"
import { QrCode } from "@/components/app/qr-code"
import { useMyTickets } from "@/lib/queries/tickets"
import { useCurrentUser } from "@/lib/queries/auth"
import { formatPrice, isFreeEvent } from "@/lib/price"
import type { EventData } from "@/lib/api/events"
import { SearchInput, FilterSelect } from "@/components/app/search-input"
import { Pagination } from "@/components/app/pagination"
import { useDebounce } from "@/lib/hooks/use-debounce"
import {
  ArrowRight,
  Calendar,
  CheckCircle2,
  Compass,
  Loader2,
  MapPin,
  Ticket as TicketIcon,
  XCircle,
} from "lucide-react"

const tabs = ["Upcoming", "Past"] as const

const statusFilterOptions = [
  { label: "All statuses", value: "all" },
  { label: "Valid", value: "valid" },
  { label: "Checked in", value: "checked-in" },
  { label: "Cancelled", value: "cancelled" },
]

export default function MyTicketsPage() {
  const { data: userData } = useCurrentUser()
  const [tab, setTab] = useState<(typeof tabs)[number]>("Upcoming")
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState("all")
  const [page, setPage] = useState(1)
  const debouncedSearch = useDebounce(search, 400)
  const { data, isLoading } = useMyTickets({
    search: debouncedSearch,
    status,
    page,
    limit: 12,
    timeBucket: tab === "Upcoming" ? "upcoming" : "past",
  } as any)
  const user = userData?.user
  // Server now buckets by event date + returns global counts — no client filter needed
  const tickets = data?.tickets ?? []
  const pagination = data?.pagination
  const counts = (data as any)?.counts as { upcoming: number, past: number, cancelled: number, checkedIn: number, total: number } | undefined
  const list = tickets
  const allUpcoming = counts?.upcoming ?? 0
  const attended = counts?.checkedIn ?? 0
  const cancelled = counts?.cancelled ?? 0

  return (
    <AppShell role="Attendee" userName={user?.name || "Attendee"} title="My Tickets">
      <div className="space-y-6">
        <Reveal y={14} className="flex items-center gap-1 rounded-xl border border-border bg-card p-1">
          {tabs.map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setPage(1) }}
              className={`flex-1 rounded-lg px-4 py-2 text-sm font-semibold transition-all sm:flex-none ${
                tab === t ? "bg-ink text-white" : "text-muted-foreground hover:text-ink"
              }`}
            >
              {t}
            </button>
          ))}
        </Reveal>

        {!isLoading && tickets.length > 0 && (
          <Reveal className="grid grid-cols-3 gap-3">
            <div className="rounded-xl border border-border bg-card p-3 text-center">
              <p className="font-display text-xl font-bold text-primary">{allUpcoming}</p>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Upcoming</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-3 text-center">
              <p className="font-display text-xl font-bold text-secondary">{attended}</p>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Attended</p>
            </div>
            <div className="rounded-xl border border-border bg-card p-3 text-center">
              <p className="font-display text-xl font-bold text-destructive/80">{cancelled}</p>
              <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Cancelled</p>
            </div>
          </Reveal>
        )}

        <Reveal className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <SearchInput
            value={search}
            onChange={(v) => {
              setSearch(v)
              setPage(1)
            }}
            placeholder="Search by event title..."
            className="flex-1"
          />
          <FilterSelect
            value={status}
            onChange={(v) => {
              setStatus(v)
              setPage(1)
            }}
            options={statusFilterOptions}
            className="w-full sm:w-48"
          />
        </Reveal>

        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading tickets...
          </div>
        ) : (
          <Reveal stagger={0.1} y={24} className="grid gap-5 lg:grid-cols-2">
            {list.map((ticket) => {
              const event = typeof ticket.event === "object" ? (ticket.event as EventData) : null
              const cancelledTicket = ticket.status === "cancelled"
              const eventId = (event as unknown as { _id?: string })?._id
              const validEventId = eventId && /^[0-9a-fA-F]{24}$/.test(String(eventId)) ? String(eventId) : null
              return (
                <Link
                  key={ticket._id}
                  href={validEventId ? `/event/${validEventId}` : "/dashboard"}
                  className="group relative flex overflow-hidden rounded-2xl border border-border bg-card transition-colors hover:border-primary/40"
                >
                  <div className="w-2 shrink-0 bg-brand-gradient" />
                  {event?.imageUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={event.imageUrl}
                      alt=""
                      className="hidden w-28 shrink-0 self-stretch object-cover sm:block"
                    />
                  )}
                  <div className="flex flex-1 flex-col gap-4 p-5 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            ticket.status === "checked-in"
                              ? "bg-secondary/15 text-secondary"
                              : cancelledTicket
                                ? "bg-destructive/10 text-destructive"
                                : "bg-primary/10 text-primary"
                          }`}
                        >
                          {ticket.status === "checked-in"
                            ? "Checked In"
                            : cancelledTicket
                              ? "Cancelled"
                              : "Valid"}
                        </span>
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                          {(ticket as any).payment?.status === "paid"
                            ? `${(ticket as any).payment.currency || "NPR"} ${(ticket as any).payment.amount?.toLocaleString?.() ?? (ticket as any).payment.amount} · ${(ticket as any).payment.provider || "card"}`
                            : (ticket as any).payment?.status === "refunded"
                              ? `Refunded ${((ticket as any).payment.amountRefunded ?? (ticket as any).payment.amount) ?? ""} ${(ticket as any).payment.currency || ""}`
                              : event && isFreeEvent(event.price) ? "Free" : event ? formatPrice(event.price) : "—"}
                        </span>
                      </div>
                      <h3 className="font-display mt-2 truncate text-lg font-bold text-ink group-hover:text-primary">
                        {event?.title ?? "Event"}
                      </h3>
                      <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
                        {event && (
                          <>
                            <span className="flex items-center gap-1.5">
                              <Calendar className="size-3.5" />{" "}
                              {(() => {
                                const d = event?.date ? new Date(event.date) : null
                                return d && !Number.isNaN(d.getTime()) ? d.toLocaleString() : "Date not available"
                              })()}
                            </span>
                            <span className="flex items-center gap-1.5">
                              <MapPin className="size-3.5" /> {event.venue || "Venue TBA"}
                            </span>
                          </>
                        )}
                      </div>
                      <div className="mt-4 flex items-center justify-between gap-2">
                        <span className="font-mono text-[10px] text-muted-foreground">
                          Ticket #{ticket._id.slice(-8).toUpperCase()}
                        </span>
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
                          View event <ArrowRight className="size-3.5" />
                        </span>
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-center gap-2 border-t border-dashed border-border pt-4 sm:border-l sm:border-t-0 sm:pl-5 sm:pt-0">
                      {ticket.status === "valid" ? (
                        <>
                          <div className="rounded-xl border border-border p-2">
                            <QrCode seed={ticket.qrToken} size={84} />
                          </div>
                          <span className="text-[11px] font-medium text-muted-foreground">Scan to check in</span>
                        </>
                      ) : ticket.status === "checked-in" ? (
                        <div className="flex flex-col items-center gap-1.5 text-secondary">
                          <CheckCircle2 className="size-10" />
                          <span className="text-xs font-semibold">Attended</span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
                          <XCircle className="size-10 text-destructive/70" />
                          <span className="text-xs font-semibold text-destructive">Cancelled</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <span className="absolute -left-2 top-1/2 size-4 -translate-y-1/2 rounded-full bg-background" />
                  <span className="absolute -right-2 top-1/2 size-4 -translate-y-1/2 rounded-full bg-background" />
                </Link>
              )
            })}
          </Reveal>
        )}

        {!isLoading && list.length === 0 && (
          <Reveal className="flex flex-col items-center gap-4 rounded-2xl border border-dashed border-border bg-card py-16 text-center">
            {debouncedSearch || status !== "all" ? (
              <p className="text-sm text-muted-foreground">No tickets match your search or filters.</p>
            ) : (
              <>
                <span className="flex size-14 items-center justify-center rounded-2xl bg-primary/10">
                  <TicketIcon className="size-7 text-primary" />
                </span>
                <div>
                  <p className="font-display text-lg font-bold text-ink">No {tab.toLowerCase()} tickets yet</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {tab === "Upcoming"
                      ? "Join an event and your ticket will live here, scannable at check-in."
                      : "Events you've attended will show up here."}
                  </p>
                </div>
                {tab === "Upcoming" && (
                  <Link
                    href="/dashboard"
                    className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-[0_8px_20px_-10px_rgba(91,76,245,0.8)] transition-transform hover:-translate-y-0.5"
                  >
                    <Compass className="size-4" /> Discover events
                  </Link>
                )}
              </>
            )}
          </Reveal>
        )}

        {pagination && pagination.totalPages > 1 && (
          <Pagination pagination={pagination} onPageChange={setPage} />
        )}
      </div>
    </AppShell>
  )
}