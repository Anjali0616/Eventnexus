import Link from "next/link"
import { MapPin, Calendar, TrendingUp, Users, Loader2, Ticket, Check } from "lucide-react"
import type { AppEvent } from "@/lib/adapters/event"

const statusStyle: Record<string, string> = {
  Live: "bg-secondary text-secondary-foreground",
  Upcoming: "bg-white/90 text-ink",
  Past: "bg-white/70 text-ink",
}

export function EventCard({ 
  event, 
  href, 
  coHosted, 
  quickJoin, 
  isRegistered, 
  isJoining 
}: { 
  event: AppEvent; 
  href?: string; 
  coHosted?: boolean;
  quickJoin?: (id: string) => void;
  isRegistered?: boolean;
  isJoining?: boolean;
}) {
  const pct = event.capacity > 0 ? Math.round((event.registered / event.capacity) * 100) : 0
  const isFree = event.price === "Free" || event.price === "Rs. 0" || event.price === "$0"
  const isPast = event.status === "Past"
  const isFull = event.registered >= event.capacity
  const showJoin = !!quickJoin && !isPast && !isFull
  return (
    <div className="group flex flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-[0_2px_24px_rgba(0,0,0,0.04)] transition-all hover:-translate-y-1.5 hover:shadow-[0_24px_50px_-28px_rgba(26,26,46,0.45)]">
      <Link href={href ?? `/event/${event.id}`} className="block">
        {/* Banner — uploaded event image (same `imageUrl` field the detail page
            uses); falls back to the generated gradient when there's none. A
            fixed height + object-cover keeps every card the same size. */}
        <div className={`relative h-32 overflow-hidden ${event.imageUrl ? "bg-muted" : event.gradient}`}>
          {event.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element -- base64 data URLs; next/image can't optimize these
            <img
              src={event.imageUrl}
              alt={event.title}
              loading="lazy"
              className="absolute inset-0 h-full w-full object-cover"
            />
          )}
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_20%,rgba(255,255,255,0.35),transparent_55%)]" />
          <div className="absolute left-3 top-3 flex gap-2">
            <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusStyle[event.status]}`}>
              {event.status}
            </span>
            <span className="rounded-full bg-black/20 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur">
              {event.type}
            </span>
            {coHosted && (
              <span className="rounded-full bg-white/20 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">
                Co-hosted
              </span>
            )}
          </div>
          {event.matchScore != null && (
            <span className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-full bg-black/25 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur">
              <TrendingUp className="size-3" /> {event.matchScore}% match
            </span>
          )}
        </div>

        <div className="flex flex-1 flex-col p-5 pb-3">
          <span className="text-xs font-medium text-primary">{event.category}</span>
          <h3 className="font-display mt-1 text-base font-bold leading-snug text-ink">{event.title}</h3>
          <p className="mt-1 text-xs text-muted-foreground">by {event.org}</p>

          <div className="mt-4 space-y-1.5 text-xs text-muted-foreground">
            <span className="flex items-center gap-1.5">
              <Calendar className="size-3.5" /> {event.date}
            </span>
            <span className="flex items-center gap-1.5">
              <MapPin className="size-3.5" /> {event.venue}
            </span>
          </div>

          {/* Capacity bar */}
          <div className="mt-4">
            <div className="flex items-center justify-between text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <Users className="size-3" /> {event.registered.toLocaleString()}/{event.capacity.toLocaleString()}
              </span>
              <span className="font-mono">{pct}%</span>
            </div>
            <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
              <div className="bg-brand-gradient h-full rounded-full" style={{ width: `${Math.min(100, pct)}%` }} />
            </div>
          </div>
        </div>
      </Link>

      <div className="flex items-center justify-between border-t border-border p-3">
        <span className="font-display text-base font-bold text-ink">{event.price}</span>
        {showJoin ? (
          isRegistered ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-secondary/10 px-3 py-1.5 text-xs font-semibold text-secondary">
              <Check className="size-3" /> Joined
            </span>
          ) : isFree ? (
            <button
              onClick={(e) => { e.preventDefault(); quickJoin(event.id); }}
              disabled={isJoining}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-white transition hover:bg-primary/90 disabled:opacity-50"
            >
              {isJoining ? <Loader2 className="size-3 animate-spin" /> : <Ticket className="size-3" />} Join
            </button>
          ) : (
            <Link
              href={href ?? `/event/${event.id}`}
              className="inline-flex items-center gap-1 rounded-full border border-primary/20 px-4 py-1.5 text-xs font-semibold text-primary hover:bg-primary/5"
            >
              <Ticket className="size-3" /> Join
            </Link>
          )
        ) : (
          <Link href={href ?? `/event/${event.id}`} className="text-xs font-semibold text-primary group-hover:translate-x-0.5 transition-transform">
            View details &rarr;
          </Link>
        )}
      </div>
    </div>
  )
}
