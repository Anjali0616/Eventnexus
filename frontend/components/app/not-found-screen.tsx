"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, Compass, LayoutDashboard } from "lucide-react"
import { Logo } from "@/components/ui/logo"
import { useCurrentUser, roleRoutes } from "@/lib/queries/auth"

// Shared "this page isn't available to you" screen, used for both genuinely
// unknown URLs (app/not-found.tsx) and paths the signed-in role may not open
// (AppShell's route guard).
//
// Deliberately identical in both cases: a role-restricted page returns the
// same 404 as a page that doesn't exist, so the UI never confirms the
// existence of a console the caller isn't entitled to — and never shows its
// title or description first, which is what the old inline warning banner
// did.
export function NotFoundScreen({
  title = "Page not found",
  message = "The page you're looking for doesn't exist, was moved, or isn't available on your account.",
}: {
  title?: string
  message?: string
}) {
  const router = useRouter()
  const { data } = useCurrentUser()
  const user = data?.user
  // Signed-out visitors get the marketing home; everyone else their own
  // console — never a hardcoded /admin that half the roles can't open.
  const home = user ? roleRoutes[user.role] || "/dashboard" : "/"

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-6 py-16 text-center">
      <Link
        href="/"
        className="mb-10 inline-flex items-center transition-opacity hover:opacity-80"
      >
        <Logo className="h-8" />
      </Link>

      <div className="relative">
        <p className="font-display text-[110px] font-bold leading-none tracking-tight text-primary/12 sm:text-[150px]">
          404
        </p>
        <span className="absolute inset-0 flex items-center justify-center">
          <span className="flex size-16 items-center justify-center rounded-2xl border border-border bg-card shadow-sm">
            <Compass className="size-7 text-primary" />
          </span>
        </span>
      </div>

      <h1 className="font-display mt-6 text-2xl font-bold tracking-tight text-ink">{title}</h1>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">{message}</p>

      <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
        <Link
          href={home}
          className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground shadow-[0_8px_20px_-10px_rgba(91,76,245,0.8)] transition-transform hover:-translate-y-0.5"
        >
          <LayoutDashboard className="size-4" />
          {user ? "Go to dashboard" : "Go to homepage"}
        </Link>
        <button
          onClick={() => router.back()}
          className="inline-flex items-center gap-2 rounded-xl border border-border bg-card px-5 py-3 text-sm font-medium text-ink transition-colors hover:bg-muted"
        >
          <ArrowLeft className="size-4" /> Go back
        </button>
      </div>
    </div>
  )
}
