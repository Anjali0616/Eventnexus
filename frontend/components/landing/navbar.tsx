"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { ChevronDown, LayoutDashboard, Menu, X } from "lucide-react"
import { Logo } from "@/components/ui/logo"
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu"
import { useCurrentUser, useLogout, roleRoutes } from "@/lib/queries/auth"

type NavItem = { label: string; href: string }
type NavGroup = { label: string; items: NavItem[] }

const groups: NavGroup[] = [
  {
    label: "Explore",
    items: [
      { label: "Browse Events", href: "/events" },
      { label: "Categories", href: "/events?filters=1" },
      { label: "Recommendations", href: "/recommendations" },
    ],
  },
  {
    label: "Organizations",
    items: [
      { label: "Register Organization", href: "/org-register" },
      { label: "Create Event", href: "/create-event" },
      { label: "Collaboration", href: "/collaboration" },
    ],
  },
]

const flatLinks: NavItem[] = [
  { label: "Pricing", href: "/pricing" },
  { label: "Contact", href: "/contact" },
]

// Shared role→home map rather than another local copy that can drift out
// of sync as roles are added (this one predated "org_admin").
const roleHome = roleRoutes

const linkCls = "text-sm font-medium text-muted-foreground transition-colors hover:text-ink"

function NavDropdown({ group }: { group: NavGroup }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={`inline-flex items-center gap-1 outline-none data-[state=open]:text-ink ${linkCls}`}>
        {group.label}
        <ChevronDown className="size-3.5 transition-transform data-[state=open]:rotate-180" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-52">
        {group.items.map((it) => (
          <DropdownMenuItem key={it.label} asChild>
            <Link href={it.href} className="cursor-pointer">
              {it.label}
            </Link>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function Navbar() {
  const { data: userData } = useCurrentUser()
  const logout = useLogout()
  const user = userData?.user
  const pathname = usePathname()
  const [mobileOpen, setMobileOpen] = useState(false)

  // Close the mobile menu on navigation.
  useEffect(() => setMobileOpen(false), [pathname])

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-border/80 bg-background shadow-[0_2px_18px_rgba(15,23,42,0.06)]">
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
        <Link href="/" className="flex items-center transition-opacity hover:opacity-80">
          <Logo className="h-8" priority />
        </Link>

        {/* desktop nav */}
        <ul className="hidden items-center gap-8 md:flex">
          {groups.map((g) => (
            <li key={g.label}>
              <NavDropdown group={g} />
            </li>
          ))}
          {flatLinks.map((l) => (
            <li key={l.label}>
              <Link href={l.href} className={linkCls}>
                {l.label}
              </Link>
            </li>
          ))}
        </ul>

        {/* right side */}
        <div className="flex items-center gap-3">
          {user ? (
            <>
              <Link
                href={roleHome[user.role] || "/dashboard"}
                className="bg-brand-gradient hidden items-center gap-2 rounded-full px-5 py-2 text-sm font-semibold text-white shadow-[0_8px_24px_-8px_rgba(91,76,245,0.7)] transition-transform hover:-translate-y-0.5 sm:flex"
              >
                <LayoutDashboard className="size-4" /> Dashboard
              </Link>
              <button
                onClick={logout}
                className="hidden rounded-full border border-border px-4 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-ink sm:block"
              >
                Logout
              </button>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="hidden rounded-full px-4 py-2 text-sm font-medium text-ink transition-colors hover:bg-muted sm:block"
              >
                Log In
              </Link>
              <Link
                href="/register"
                className="hidden rounded-full bg-flame px-5 py-2 text-sm font-semibold text-white shadow-[0_8px_24px_-8px_rgba(255,107,53,0.7)] transition-transform hover:-translate-y-0.5 sm:block"
              >
                Create Account
              </Link>
            </>
          )}

          {/* mobile toggle */}
          <button
            onClick={() => setMobileOpen((v) => !v)}
            aria-label={mobileOpen ? "Close menu" : "Open menu"}
            aria-expanded={mobileOpen}
            className="flex size-9 items-center justify-center rounded-lg border border-border text-ink transition-colors hover:bg-muted md:hidden"
          >
            {mobileOpen ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </nav>

      {/* mobile menu */}
      {mobileOpen && (
        <div className="max-h-[calc(100vh-4rem)] overflow-y-auto border-t border-border bg-background md:hidden">
          <div className="mx-auto max-w-7xl space-y-5 px-6 py-5">
            {groups.map((g) => (
              <div key={g.label}>
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">{g.label}</p>
                <ul className="mt-2 space-y-1">
                  {g.items.map((it) => (
                    <li key={it.label}>
                      <Link href={it.href} className="block rounded-lg px-2 py-2 text-sm font-medium text-ink transition-colors hover:bg-muted">
                        {it.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <div className="flex flex-col gap-1 border-t border-border pt-3">
              {flatLinks.map((l) => (
                <Link key={l.label} href={l.href} className="rounded-lg px-2 py-2 text-sm font-medium text-ink transition-colors hover:bg-muted">
                  {l.label}
                </Link>
              ))}
            </div>
            <div className="flex flex-col gap-2 border-t border-border pt-3">
              {user ? (
                <>
                  <Link
                    href={roleHome[user.role] || "/dashboard"}
                    className="bg-brand-gradient inline-flex items-center justify-center gap-2 rounded-full px-5 py-2.5 text-sm font-semibold text-white"
                  >
                    <LayoutDashboard className="size-4" /> Dashboard
                  </Link>
                  <button
                    onClick={logout}
                    className="rounded-full border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
                  >
                    Logout
                  </button>
                </>
              ) : (
                <>
                  <Link href="/login" className="rounded-full border border-border px-4 py-2.5 text-center text-sm font-medium text-ink transition-colors hover:bg-muted">
                    Log In
                  </Link>
                  <Link href="/register" className="rounded-full bg-flame px-5 py-2.5 text-center text-sm font-semibold text-white">
                    Create Account
                  </Link>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  )
}
