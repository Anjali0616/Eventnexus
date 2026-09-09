"use client"

import { Suspense, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { BadgeCheck, Loader2, LogOut, MailCheck, MailX } from "lucide-react"
import { AuthShell } from "@/components/auth/auth-shell"
import { useCurrentUser, useLogout, useResendVerification, useVerifyEmail, roleRoutes } from "@/lib/queries/auth"

// The holding screen a logged-in-but-unverified local account lands on
// (redirected here by AppShell's guard — see components/app/app-shell.tsx).
// No token in the URL yet; just tells them to check their inbox and lets
// them resend the email or sign out. Once useCurrentUser() reflects
// emailVerified (either they clicked the link in another tab, refreshing
// this query, or useVerifyEmail's own success below), it redirects them
// straight to their dashboard — no need to log back in.
function AwaitingVerification() {
  const router = useRouter()
  const params = useSearchParams()
  const logout = useLogout()
  const { data: userData } = useCurrentUser()
  const resend = useResendVerification()
  const user = userData?.user
  // Preserved from the register step (e.g. a QR /event/<id> deep link) so a
  // freshly-verified user lands back where they started, not a generic home.
  const redirect = params.get("redirect")

  useEffect(() => {
    if (user?.emailVerified) router.replace(redirect || roleRoutes[user.role] || "/dashboard")
  }, [user, router, redirect])

  return (
    <AuthShell heading="Verify your email" sub="Confirm your address to unlock your dashboard.">
      <div className="rounded-xl border border-border bg-muted/30 p-6 text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10">
          <MailCheck className="size-6 text-primary" />
        </span>
        <h2 className="mt-4 font-display text-lg font-bold text-ink">Check your inbox</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          We sent a verification link to {user?.email ? <strong>{user.email}</strong> : "your email"}. Click it to
          activate your account — this page unlocks automatically once you're verified.
        </p>
        <button
          onClick={() => resend.mutate()}
          disabled={resend.isPending}
          className="mt-6 w-full rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-60"
        >
          {resend.isPending ? (
            <Loader2 className="mx-auto size-4 animate-spin" />
          ) : resend.isSuccess ? (
            "Email resent"
          ) : (
            "Resend verification email"
          )}
        </button>
        {resend.isError && (
          <p className="mt-2 text-xs text-destructive">Couldn&apos;t resend — try again shortly.</p>
        )}
        <button
          onClick={logout}
          className="mt-3 flex w-full items-center justify-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-ink"
        >
          <LogOut className="size-4" /> Sign out
        </button>
      </div>
    </AuthShell>
  )
}

function VerifyEmailForm() {
  const params = useSearchParams()
  const router = useRouter()
  const token = params.get("token") || ""
  const verify = useVerifyEmail()
  const [started, setStarted] = useState(false)

  useEffect(() => {
    if (!token || started) return
    setStarted(true)
    verify.mutate(token)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  if (!token) return <AwaitingVerification />

  const failed = verify.isError

  return (
    <AuthShell heading="Email verification" sub="Confirm your address to activate your account.">
      {verify.isPending && (
        <div className="flex flex-col items-center gap-3 py-8 text-muted-foreground">
          <Loader2 className="size-8 animate-spin text-primary" />
          <p className="text-sm">Verifying your email…</p>
        </div>
      )}

      {verify.isSuccess && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-6 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-100">
            <BadgeCheck className="size-6 text-emerald-600" />
          </span>
          <h2 className="mt-4 font-display text-lg font-bold text-ink">Email verified!</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Your account is fully activated. You can now log in and start using EventNexus.
          </p>
          <button
            onClick={() => router.push("/login")}
            className="mt-6 rounded-xl bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Log in
          </button>
        </div>
      )}

      {failed && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-6 text-center">
          <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-red-100">
            <MailX className="size-6 text-red-600" />
          </span>
          <h2 className="mt-4 font-display text-lg font-bold text-ink">Link invalid or expired</h2>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Verification links expire after 24 hours. Log in and request a fresh one — you'll find
            the option on your dashboard.
          </p>
          <Link
            href="/login"
            className="mt-6 inline-block text-sm font-semibold text-primary hover:underline"
          >
            Go to login
          </Link>
        </div>
      )}
    </AuthShell>
  )
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailForm />
    </Suspense>
  )
}
