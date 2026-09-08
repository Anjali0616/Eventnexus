"use client"

import { useEffect, useRef, useState, type ReactNode } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  Hexagon,
  LogOut,
  HelpCircle,
  Search,
  Sparkles,
  Menu,
  X,
  type LucideIcon,
} from "lucide-react"
import dynamic from "next/dynamic"
import { adminNav, attendeeNav, organizerNav, orgAdminNav } from "@/components/app/nav-configs"
import { HelpDialog } from "@/components/app/help-dialog"
import { NotificationBell } from "@/components/app/notification-bell"
import { ensureGsapAsync, prefersReducedMotion } from "@/lib/gsap"

const EventBot = dynamic(() => import("@/components/chatbot/event-bot").then((m) => m.EventBot), {
  ssr: false,
})
const LocationPromptDynamic = dynamic(() => import("@/components/app/location-prompt").then((m) => m.LocationPrompt), {
  ssr: false,
})
const InterestsPromptDynamic = dynamic(() => import("@/components/interests/first-login-interests-dialog").then((m) => m.FirstLoginInterestsDialog), {
  ssr: false,
})
import { useUnreadCount } from "@/lib/queries/notifications"
import { useCurrentUser, useLogout } from "@/lib/queries/auth"
import { useHasTokenWithChecked } from "@/lib/hooks/use-has-token"
import { canAccessPath } from "@/lib/route-access"
import { NotFoundScreen } from "@/components/app/not-found-screen"
import { LocationPrompt } from "@/components/app/location-prompt"
import { useChatbotStore } from "@/lib/stores/chatbot-store"
import { Loader2 } from "lucide-react"

export type NavItem = { label: string; href: string; icon: LucideIcon; badge?: number }

type AppShellProps = {
  children: ReactNode
  role: "Administrator" | "Organizer" | "Attendee"
  userName: string
  title?: string
}

const roleColorMap: Record<string, string> = {
  Administrator: "bg-primary/12 text-primary",
  "Org Admin": "bg-primary/12 text-primary",
  Organizer: "bg-secondary/15 text-secondary",
  Attendee: "bg-flame/12 text-flame",
}

const roleNavMap: Record<AppShellProps["role"], NavItem[]> = {
  Administrator: adminNav,
  Organizer: organizerNav,
  Attendee: attendeeNav,
}

// The shell's identity — sidebar, role badge, colour — is derived from the
// AUTHENTICATED USER, never from the URL.
//
// This used to be resolved from the pathname instead (`/organizer/*` →
// Organizer, `/admin/*` → Administrator). That meant the URL, not the
// session, decided who you appeared to be: an attendee who reached any
// /organizer/* link visibly "became" an Organizer — organizer sidebar,
// "Organizer" badge — because the path said so. A URL is attacker- and
// accident-controlled input; it can never be the source of truth for
// identity. Only the signed-in account is.
const ROLE_FOR_USER: Record<string, AppShellProps["role"]> = {
  admin: "Administrator",
  org_admin: "Administrator",
  organizer: "Organizer",
  attendee: "Attendee",
}

// Route permissions live in lib/route-access (imported above) — one table
// shared by every check, rather than a coarse test duplicated per call site.
// Enforced here in AppShell, the one component every page renders through,
// so a single check covers every route: deep links, bookmarks, stale links
// and in-app buttons alike.

function matchesRoute(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`)
}

// Shared nav list used by both the desktop sidebar and the mobile drawer —
// keeps the two in sync so mobile users get exactly what desktop users see.
function NavLinks({
  items,
  activeHref,
  unreadCount,
  onNavigate,
}: {
  items: NavItem[]
  activeHref: string | null
  unreadCount: number
  onNavigate?: () => void
}) {
  return (
    <>
      {items.map((item) => {
        const active = item.href === activeHref
        const badge = item.label === "Notifications" && unreadCount > 0 ? unreadCount : item.badge
        return (
          <Link
            key={item.label}
            href={item.href}
            onClick={onNavigate}
            className={`nav-item flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
              active
                ? "bg-primary text-primary-foreground shadow-[0_8px_20px_-10px_rgba(91,76,245,0.8)]"
                : "text-muted-foreground hover:bg-muted hover:text-ink"
            }`}
          >
            <item.icon className="size-[18px] shrink-0" />
            <span className="flex-1">{item.label}</span>
            {badge ? (
              <span
                className={`flex size-5 items-center justify-center rounded-full text-[10px] font-bold ${
                  active ? "bg-white/20 text-white" : "bg-flame text-white"
                }`}
              >
                {badge}
              </span>
            ) : null}
          </Link>
        )
      })}
    </>
  )
}

// Lets EventBot answer event-specific questions (capacity, venue, schedule,
// registration status, price) when the visitor is actually on that event's
// detail page — otherwise those intents have no eventId to look up and
// always fall back to "which event do you mean?". Matches the Mongo
// ObjectId pattern so route segments like "create" or "check-in" are never
// mistaken for an id.
const EVENT_DETAIL_PATTERN = /^\/(?:event|organizer\/events|admin\/events)\/([0-9a-f]{24})$/i

function extractEventIdFromPath(pathname: string): string | undefined {
  return EVENT_DETAIL_PATTERN.exec(pathname)?.[1]
}

export function AppShell({ children, role, userName, title = "Welcome back" }: AppShellProps) {
  const greeting = title
  const pathname = usePathname()
  const router = useRouter()
  const logout = useLogout()

  // Local (email/password) accounts must confirm their address before
  // using the app at all — Google accounts are verified on creation (see
  // authController.js's googleLogin), so this only ever gates local,
  // unverified accounts, never Google sign-ins. This used to be a
  // dismissible banner that let an unverified user keep using every page
  // regardless — now it's a hard block: render nothing from this shell
  // (not even a flash of it) and redirect to the holding page instead.
  const { data: userData, isLoading: userLoading } = useCurrentUser()
  const currentUser = userData?.user
  const { hasToken, checked } = useHasTokenWithChecked()
  const isAuthLoading = checked && hasToken && userLoading
  const needsVerification = !!currentUser && !currentUser.googleAccount && !currentUser.emailVerified

  useEffect(() => {
    if (needsVerification) router.replace("/verify-email")
  }, [needsVerification, router])

  // Nobody may open another role's workspace by URL. A denied path renders
  // the same 404 as a nonexistent one (see NotFoundScreen) rather than
  // redirecting: a silent bounce looks like the click did nothing, and
  // showing the page chrome with an apologetic banner — as this used to —
  // leaks the title and purpose of a console the caller isn't entitled to.
  // While auth is loading (hasToken true but user still fetching), don't
  // decide access yet — avoids flash of wrong role / premature 404.
  const pathAllowed = isAuthLoading ? true : !currentUser ? canAccessPath("attendee", pathname) : canAccessPath(currentUser.role, pathname)

  // Any reason to withhold the page body: unverified email, or a path this
  // role must not see.
  const blocked = needsVerification || (!isAuthLoading && !pathAllowed)

  // The chat panel's open state lives in the zustand store (with the whole
  // conversation), so switching pages keeps both the chat open and its
  // history intact — AppShell unmounts on every route change.
  const botOpen = useChatbotStore((s) => s.open)
  const setBotOpen = useChatbotStore((s) => s.setOpen)
  const aside = useRef<HTMLElement>(null)
  const effectiveRole: AppShellProps["role"] = currentUser
    ? ROLE_FOR_USER[currentUser.role] ?? "Attendee"
    : role
  // "org_admin" is the distinct, explicit tenant-scoped role (see
  // backend/models/User.js) — never inferred from "admin" + organization
  // set, which used to be ambiguous enough that a permission check (the AI
  // console) accidentally treated org admins as full system admins. They
  // get a trimmed nav that only lists routes actually scoped to their own
  // org, and a distinct badge, so the console they land on after login
  // doesn't imply platform-wide powers they don't have (org approvals, AI
  // training, system settings all reject them server-side).
  const isOrgScopedAdmin = currentUser?.role === "org_admin"
  const resolvedNav = isOrgScopedAdmin ? orgAdminNav : roleNavMap[effectiveRole]
  const roleLabel = isOrgScopedAdmin ? "Org Admin" : effectiveRole
  const roleColor = roleColorMap[roleLabel]
  const activeHref =
    resolvedNav
      .filter((item) => matchesRoute(pathname, item.href))
      .sort((left, right) => right.href.length - left.href.length)[0]?.href ?? null
  const currentEventId = extractEventIdFromPath(pathname)

  const { data: unreadData } = useUnreadCount()
  const unreadCount = unreadData ?? 0

  // Below lg the sidebar is hidden entirely, so navigation lives in a
  // slide-over drawer driven from the topbar hamburger. The old layout had
  // no mobile navigation at all — on a phone there was no way to reach
  // anything but the current page.
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const closeMobileNav = () => setMobileNavOpen(false)

  // Topbar: bell, search, and help were previously dead UI — the bell had no
  // onClick, search matched nothing, and Help was a "#" link. Each is now
  // role-aware and routes to a real destination.
  const [helpOpen, setHelpOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")

  // Uses effectiveRole (Administrator/Organizer/Attendee), not the
  // roleLabel badge — an Org Admin still belongs on /admin/events, same as
  // the System Administrator, only the badge text differs.
  const searchHref =
    effectiveRole === "Administrator"
      ? "/admin/events"
      : effectiveRole === "Organizer"
        ? "/organizer/events"
        : "/events"

  const submitSearch = (e: React.FormEvent) => {
    e.preventDefault()
    const q = searchQuery.trim()
    router.push(q ? `${searchHref}?q=${encodeURIComponent(q)}` : searchHref)
  }

  useEffect(() => {
    if (!mobileNavOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileNavOpen(false)
    }
    window.addEventListener("keydown", onKey)
    document.body.style.overflow = "hidden"
    return () => {
      window.removeEventListener("keydown", onKey)
      document.body.style.overflow = ""
    }
  }, [mobileNavOpen])

  useEffect(() => {
    if (prefersReducedMotion()) return
    let ctx: any
    let cancelled = false
    void ensureGsapAsync().then((gsap) => {
      if (cancelled || !gsap || !aside.current) return
      ctx = gsap.context((self: any) => {
        const q = self.selector!
        gsap.from(q(".nav-item"), { x: -16, opacity: 0, stagger: 0.05, duration: 0.4, ease: "power2.out" })
      }, aside)
    })
    return () => {
      cancelled = true
      ctx?.revert()
    }
  }, [])

  // Placed after every hook so hook order stays stable across renders.
  // While auth is loading, show loader instead of flashing wrong role
  if (isAuthLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Loader2 className="size-6 animate-spin text-primary" />
      </div>
    )
  }
  // Replaces the whole shell rather than just the body: the topbar renders
  // the page's own `title` prop, so keeping the chrome would still announce
  // "Organization approvals" to someone who may not see that console.
  if (currentUser && !pathAllowed) {
    return <NotFoundScreen />
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* Sidebar */}
      <aside
        ref={aside}
        className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-border bg-card lg:flex"
      >
        <Link href="/" className="flex items-center gap-2 border-b border-border px-5 py-4 transition-opacity hover:opacity-80">
          <span className="bg-brand-gradient flex size-8 items-center justify-center rounded-lg text-white">
            <Hexagon className="size-5" strokeWidth={2.5} />
          </span>
          <span className="font-display text-lg font-bold text-ink">EventNexus</span>
        </Link>

        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <span className="bg-brand-gradient flex size-10 items-center justify-center rounded-full font-display text-sm font-bold text-white">
            {userName.split(" ").map((n) => n[0]).join("")}
          </span>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-ink">{userName}</div>
            <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${roleColor}`}>
              {roleLabel}
            </span>
          </div>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
          <NavLinks items={resolvedNav} activeHref={activeHref} unreadCount={unreadCount} />
        </nav>

        <div className="space-y-1 border-t border-border px-3 py-4">
          <button
            onClick={() => setHelpOpen(true)}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-ink"
          >
            <HelpCircle className="size-[18px]" /> Help
          </button>
          <button
            onClick={logout}
            className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-ink"
          >
            <LogOut className="size-[18px]" /> Logout
          </button>
        </div>
      </aside>

      {/* Mobile drawer — mirrors the sidebar for lg-and-below viewports */}
      {mobileNavOpen && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <div
            className="absolute inset-0 bg-ink/40 backdrop-blur-sm"
            onClick={closeMobileNav}
            aria-hidden="true"
          />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col border-r border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <Link href="/" onClick={closeMobileNav} className="flex items-center gap-2 transition-opacity hover:opacity-80">
                <span className="bg-brand-gradient flex size-8 items-center justify-center rounded-lg text-white">
                  <Hexagon className="size-5" strokeWidth={2.5} />
                </span>
                <span className="font-display text-lg font-bold text-ink">EventNexus</span>
              </Link>
              <button
                onClick={closeMobileNav}
                className="flex size-9 items-center justify-center rounded-xl border border-border bg-background text-muted-foreground transition-colors hover:text-ink"
                aria-label="Close navigation menu"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="flex items-center gap-3 border-b border-border px-5 py-4">
              <span className="bg-brand-gradient flex size-10 items-center justify-center rounded-full font-display text-sm font-bold text-white">
                {userName.split(" ").map((n) => n[0]).join("")}
              </span>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-ink">{userName}</div>
                <span className={`mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${roleColor}`}>
                  {roleLabel}
                </span>
              </div>
            </div>

            <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4">
              <NavLinks
                items={resolvedNav}
                activeHref={activeHref}
                unreadCount={unreadCount}
                onNavigate={closeMobileNav}
              />
            </nav>

            <div className="space-y-1 border-t border-border px-3 py-4">
              <button
                onClick={() => {
                  closeMobileNav()
                  setHelpOpen(true)
                }}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-ink"
              >
                <HelpCircle className="size-[18px]" /> Help
              </button>
              <button
                onClick={logout}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-ink"
              >
                <LogOut className="size-[18px]" /> Logout
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Topbar */}
        <header className="sticky top-0 z-40 flex items-center gap-4 border-b border-border bg-background/85 px-6 py-3.5 backdrop-blur">
          <button
            onClick={() => setMobileNavOpen(true)}
            className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-ink transition-colors hover:bg-muted lg:hidden"
            aria-label="Open navigation menu"
          >
            <Menu className="size-5" />
          </button>
          <div className="min-w-0 flex-1">
            <h1 className="truncate font-display text-lg font-bold text-ink">{greeting}</h1>
            <p className="hidden truncate text-xs text-muted-foreground sm:block">
              {new Date().toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <form onSubmit={submitSearch} className="relative hidden sm:block">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search events..."
                className="w-56 rounded-xl border border-border bg-card py-2 pl-9 pr-3 text-sm outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
              />
            </form>
            <button
              onClick={() => setBotOpen(true)}
              className="bg-brand-gradient flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-semibold text-white shadow-[0_8px_20px_-10px_rgba(0,201,167,0.9)] transition-transform hover:-translate-y-0.5"
            >
              <Sparkles className="size-4" /> Ask EventBot
            </button>
            <NotificationBell role={effectiveRole} />
            <button
              onClick={() => setHelpOpen(true)}
              className="hidden size-10 items-center justify-center rounded-xl border border-border bg-card text-muted-foreground transition-colors hover:text-ink md:flex"
              aria-label="Help"
            >
              <HelpCircle className="size-[18px]" />
            </button>
          </div>
        </header>

        <main className="flex-1 px-6 py-6">{blocked ? null : children}</main>
      </div>

      {!blocked && <EventBot eventId={currentEventId} />}
      {/* Asks for location once, after the post-login redirect has settled —
          see the component for why it can't live on the login page. */}
      {!blocked && <LocationPromptDynamic />}
      {!blocked && <InterestsPromptDynamic />}

      <HelpDialog
        open={helpOpen}
        role={effectiveRole}
        onClose={() => setHelpOpen(false)}
        onAskBot={() => {
          setHelpOpen(false)
          setBotOpen(true)
        }}
      />
    </div>
  )
}
