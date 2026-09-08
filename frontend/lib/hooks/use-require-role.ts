"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { useCurrentUser, roleRoutes } from "@/lib/queries/auth"
import { useHasTokenWithChecked } from "@/lib/hooks/use-has-token"
import type { User } from "@/lib/api/auth"

export type RoleGate = "loading" | "allowed" | "denied"

// Race-free page guard for role-restricted routes.
//
// The pattern this replaces was `if (!user || !allowed.includes(user.role))
// notFound()` evaluated straight through during render. That has two bugs:
//
//  1. `user` is undefined for the first render(s) while useCurrentUser
//     resolves, so the guard fired for legitimate organizers/admins too.
//  2. Because it bailed out of the component before AppShell mounted, the
//     central role-access guard inside AppShell never got the chance to run
//     — so the page could also render for the WRONG role depending on
//     timing, which is exactly how an attendee ended up on an organizer
//     edit page.
//
// Instead this reports an explicit three-state gate, so callers can render
// a loader while the session is still unknown and only commit to a decision
// once it isn't. A denied user is sent to their own home (or /login when
// signed out) rather than shown a dead end.
//
// This is UI routing only — never the security boundary. The server
// independently enforces the same rules (authorize()/requireRole() on every
// route), which is what actually protects the data.
export function useRequireRole(allowed: string[]): { gate: RoleGate; user?: User } {
  const router = useRouter()
  const { hasToken, checked } = useHasTokenWithChecked()

  const { data, isError } = useCurrentUser()
  const user = data?.user

  const gate: RoleGate = !checked
    ? "loading"
    : !hasToken
      ? "denied"
      : user
        ? allowed.includes(user.role)
          ? "allowed"
          : "denied"
        : isError
          ? "denied"
          : "loading"

  useEffect(() => {
    if (gate !== "denied") return
    router.replace(user ? roleRoutes[user.role] || "/dashboard" : "/login")
  }, [gate, user, router])

  return { gate, user }
}
