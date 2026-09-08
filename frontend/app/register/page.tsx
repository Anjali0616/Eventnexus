"use client"

import { Suspense, useEffect, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { Building2, Loader2, MailCheck, Sparkles, Ticket, UserRound } from "lucide-react"
import { AuthShell } from "@/components/auth/auth-shell"
import { useCurrentUser, useRegister, useLogout, roleRoutes } from "@/lib/queries/auth"
import { useOrganizations } from "@/lib/queries/organizations"
import { useOrgRegister } from "@/lib/queries/system"
import { useEvent } from "@/lib/queries/events"
import { sanitizeEventRedirect } from "@/lib/event-redirect"
import { InterestsSelector } from "@/components/interests/interests-selector"

// Mirrors the same banner on the login page: shown when this signup was
// reached via PublicEventLanding's Join button (a signed-out QR/link scan),
// so creating an account doesn't feel disconnected from the event just
// scanned.
function JoiningEventBanner({ eventId }: { eventId: string }) {
  const { data, isLoading } = useEvent(eventId)
  const event = data?.event
  if (isLoading || !event) return null
  return (
    <div className="auth-field flex items-center gap-2.5 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-ink">
      <Ticket className="size-4 shrink-0 text-primary" />
      <span>
        Create an account to join <span className="font-semibold">{event.title}</span>
      </span>
    </div>
  )
}

function Field({ label, ...props }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <div className="auth-field">
      <label className="text-sm font-medium text-ink">{label}</label>
      <input
        {...props}
        className="mt-1.5 w-full rounded-xl border border-border bg-card px-4 py-3 text-sm text-ink outline-none transition-all focus:border-primary focus:ring-4 focus:ring-primary/10"
      />
    </div>
  )
}

type RegisterMode = "attendee" | "organization"

function RegisterPageInner() {
  const searchParams = useSearchParams()
  const rawRedirect = searchParams.get("redirect")
  const rawType = searchParams.get("type")
  const sanitizedRedirect = sanitizeEventRedirect(rawRedirect)
  const isQrFlow = !!sanitizedRedirect && sanitizedRedirect.includes("/event/")
  const initialMode: RegisterMode = isQrFlow ? "attendee" : rawType === "organization" ? "organization" : "attendee"
  const [mode, setMode] = useState<RegisterMode>(initialMode)
  const [redirectTo] = useState<string | null>(sanitizedRedirect)
  const { data: currentUserData } = useCurrentUser()
  const alreadyAuthed = !!currentUserData?.user
  const logout = useLogout()

  // --- Attendee account ------------------------------------------------------
  const [name, setName] = useState("")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [organizationId, setOrganizationId] = useState("")
  const [selectedInterests, setSelectedInterests] = useState<string[]>([])

  // --- Organization registration ---------------------------------------------
  const [form, setForm] = useState({
    orgName: "",
    orgPhone: "",
    orgAddress: "",
    orgCity: "",
    orgCountry: "",
    orgType: "Company",
    orgDescription: "",
    orgWebsite: "",
    adminName: "",
    // The org's business email IS the admin account's email — one address
    // for both, so applicants aren't asked for the same email twice.
    orgEmail: "",
  })
  const [adminPassword, setAdminPassword] = useState("")
  const [adminConfirmPassword, setAdminConfirmPassword] = useState("")

  const rawEventId = redirectTo?.split("/event/")[1]?.split("?")[0]?.split("/")[0]
  const eventIdFromRedirect = rawEventId && /^[0-9a-f]{24}$/i.test(rawEventId) ? rawEventId : undefined
  const loginHref = redirectTo ? `/login?redirect=${encodeURIComponent(redirectTo)}` : "/login"

  // QR flow: attendee is a normal user with no organization needed — sees all events
  const { data: qrEventData } = useEvent(isQrFlow && eventIdFromRedirect ? eventIdFromRedirect : "")
  useEffect(() => {
    if (isQrFlow && mode !== "attendee") setMode("attendee")
  }, [isQrFlow, mode])

  const registerMutation = useRegister(redirectTo)
  const orgRegister = useOrgRegister()
  const { data: orgData, isLoading: orgsLoading } = useOrganizations()
  const organizations = orgData?.organizations ?? []

  const setOrg = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [key]: e.target.value }))

  // Attendee is a normal user — no organization required, sees all events
  const handleAttendeeSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== confirmPassword) return
    registerMutation.mutate({ name, email, password, role: "attendee", interests: selectedInterests })
  }

  const handleOrgSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (adminPassword !== adminConfirmPassword) return
    orgRegister.mutate({
      ...form,
      // Single email shared by the organization record and the admin account.
      adminEmail: form.orgEmail,
      adminName: form.adminName,
      adminPassword,
    })
  }

  const attendeeCanSubmit =
    !!name && !!email && !!password && password === confirmPassword
  const orgCanSubmit =
    !!form.orgName &&
    !!form.adminName &&
    !!form.orgEmail &&
    !!adminPassword &&
    adminPassword === adminConfirmPassword

  const errorMessage = (m: { isError: boolean; error: unknown }) =>
    m.isError
      ? ((m as any).error?.response?.data?.message || "Something went wrong.")
      : null

  const orgSuccess = orgRegister.isSuccess

  return (
    <AuthShell heading="Create your account" sub="Set up your EventNexus workspace in minutes.">
      {alreadyAuthed && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          You&apos;re already logged in as <span className="font-semibold">{currentUserData?.user?.name}</span> ({currentUserData?.user?.role}).{" "}
          {isQrFlow && eventIdFromRedirect ? (
            <>
              <Link href={`/event/${eventIdFromRedirect}`} className="font-semibold text-primary hover:underline">
                Go to event
              </Link>{" "}
              or log out to create a new account.
            </>
          ) : (
            "Log out to create a new account, or head to your dashboard."
          )}
        </div>
      )}
      {isQrFlow ? (
        <div className="rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm">
          <p className="font-semibold text-primary">QR invite — attendee only</p>
          <p className="mt-1 text-xs text-muted-foreground">You&apos;re joining via QR. You&apos;ll be registered as an attendee for <span className="font-medium text-ink">{qrEventData?.event?.title || "this event"}</span>. Organization accounts can&apos;t be created via QR.</p>
        </div>
      ) : (
        <div
          className={`grid grid-cols-2 gap-2 rounded-xl border border-border bg-muted/40 p-1 transition ${
            orgSuccess ? "pointer-events-none opacity-60" : ""
          }`}
        >
          <button
            type="button"
            onClick={() => setMode("attendee")}
            className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition-all ${
              mode === "attendee" ? "bg-card text-ink shadow-sm" : "text-muted-foreground hover:text-ink"
            }`}
          >
            <UserRound className="size-4" /> Attendee
          </button>
          <button
            type="button"
            onClick={() => setMode("organization")}
            className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold transition-all ${
              mode === "organization"
                ? "bg-card text-ink shadow-sm"
                : "text-muted-foreground hover:text-ink"
            }`}
          >
            <Building2 className="size-4" /> Organization
          </button>
        </div>
      )}

      {alreadyAuthed ? (
        <div className="mt-6 rounded-xl border border-border bg-card p-6 text-center">
          <p className="text-sm font-semibold text-ink">You&apos;re already logged in</p>
          <p className="mt-1 text-xs text-muted-foreground">Log out to create a new account, or continue to where you were headed.</p>
          <div className="mt-4 flex flex-col gap-2">
            {isQrFlow && eventIdFromRedirect ? (
              <Link
                href={`/event/${eventIdFromRedirect}?qr=1`}
                className="inline-flex items-center justify-center rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
              >
                Go to event
              </Link>
            ) : (
              <Link
                href={(currentUserData?.user && roleRoutes[currentUserData.user.role]) || "/dashboard"}
                className="inline-flex items-center justify-center rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground hover:opacity-90"
              >
                Go to dashboard
              </Link>
            )}
            <button
              type="button"
              onClick={() => logout()}
              className="rounded-xl border border-border px-4 py-3 text-sm font-medium hover:bg-muted"
            >
              Log out
            </button>
          </div>
        </div>
      ) : mode === "attendee" ? (
        <form className="mt-6 space-y-5" onSubmit={handleAttendeeSubmit}>
          {eventIdFromRedirect && <JoiningEventBanner eventId={eventIdFromRedirect} />}
          {errorMessage(registerMutation) && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {errorMessage(registerMutation)}
            </div>
          )}

          {password && confirmPassword && password !== confirmPassword && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              Passwords do not match.
            </div>
          )}

          <Field label="Full Name" placeholder="Anjali Mishra" value={name} onChange={(e) => setName(e.target.value)} />
          <Field label="Email" type="email" placeholder="you@organization.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <div className="grid grid-cols-2 gap-4">
            <Field label="Password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
            <Field label="Confirm Password" type="password" placeholder="••••••••" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          </div>

          <div className="auth-field rounded-2xl border border-border bg-muted/20 p-4">
            <div className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10">
                <Sparkles className="size-4 text-primary" />
              </span>
              <div>
                <p className="text-sm font-semibold text-ink">What are you into?</p>
                <p className="text-xs text-muted-foreground">Pick categories you love — we&apos;ll personalize recommendations.</p>
              </div>
            </div>
            <div className="mt-3">
              <InterestsSelector value={selectedInterests} onChange={setSelectedInterests} size="compact" />
            </div>
            {selectedInterests.length > 0 && (
              <p className="mt-2 text-xs font-medium text-primary">
                {selectedInterests.length} interest{selectedInterests.length === 1 ? "" : "s"} selected — your feed will be tuned from day one.
              </p>
            )}
          </div>

          <button
            type="submit"
            disabled={registerMutation.isPending || !attendeeCanSubmit}
            className="auth-field flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-[0_12px_32px_-12px_rgba(91,76,245,0.8)] transition-transform hover:-translate-y-0.5 disabled:opacity-60"
          >
            {registerMutation.isPending && <Loader2 className="size-4 animate-spin" />}
            Create Account
          </button>
        </form>
      ) : (
        <form className="mt-6 space-y-5" onSubmit={handleOrgSubmit}>
          {orgRegister.isError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {(orgRegister.error as any)?.response?.data?.message || "Registration failed."}
            </div>
          )}
          {orgSuccess && (
            <div className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-6 text-center shadow-sm sm:p-7">
              <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-emerald-100">
                <MailCheck className="size-6 text-emerald-600" />
              </span>
              <h2 className="mt-4 font-display text-lg font-bold text-ink">Application submitted</h2>
              <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted-foreground">
                <p>
                  We&apos;ve sent a verification email to{" "}
                  <span className="font-semibold text-ink break-all">{form.orgEmail}</span>. Please check
                  your inbox (and spam folder) and click the link to verify your email — the link expires
                  in 24 hours.
                </p>
                <p>
                  <span className="font-semibold text-ink">{form.orgName}</span>{" "}
                  is now pending review. A system admin will verify your details — you&apos;ll receive a
                  confirmation email and can log in once your organization is approved.
                </p>
              </div>
              <Link
                href="/login"
                className="mt-6 inline-flex items-center justify-center rounded-full bg-primary px-8 py-2.5 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90"
              >
                Back to login
              </Link>
            </div>
          )}

          {!orgSuccess && (
            <>
              <div className="auth-field flex items-center gap-2 pt-2">
                <Building2 className="size-4 text-primary" />
                <h2 className="font-display text-sm font-bold uppercase tracking-wide text-muted-foreground">
                  Organization details
                </h2>
              </div>
              <Field label="Organization name" required placeholder="Yeti Adventures" value={form.orgName} onChange={setOrg("orgName")} />
              <div className="grid grid-cols-2 gap-4">
                <Field label="Business / admin email" type="email" placeholder="hello@company.com" value={form.orgEmail} onChange={setOrg("orgEmail")} />
                <Field label="Phone" placeholder="+977-1-5551234" value={form.orgPhone} onChange={setOrg("orgPhone")} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Address" placeholder="Thamel 28" value={form.orgAddress} onChange={setOrg("orgAddress")} />
                <Field label="City" placeholder="Kathmandu" value={form.orgCity} onChange={setOrg("orgCity")} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Country" placeholder="Nepal" value={form.orgCountry} onChange={setOrg("orgCountry")} />
                <Field label="Website" type="url" placeholder="https://company.com" value={form.orgWebsite} onChange={setOrg("orgWebsite")} />
              </div>
              <div className="auth-field">
                <label className="text-sm font-medium text-ink">Organization type</label>
                <select
                  value={form.orgType}
                  onChange={(e) => setForm((f) => ({ ...f, orgType: e.target.value }))}
                  className="mt-1.5 w-full rounded-xl border border-border bg-card px-4 py-3 text-sm text-ink outline-none transition-all focus:border-primary focus:ring-4 focus:ring-primary/10"
                >
                  {["Company", "Non-Profit", "Educational", "Community", "Government", "Other"].map((t) => (
                    <option key={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="auth-field">
                <label className="text-sm font-medium text-ink">Description</label>
                <textarea
                  value={form.orgDescription}
                  onChange={(e) => setForm((f) => ({ ...f, orgDescription: e.target.value }))}
                  placeholder="What does your organization do?"
                  rows={3}
                  className="mt-1.5 w-full resize-none rounded-xl border border-border bg-card px-4 py-3 text-sm text-ink outline-none transition-all focus:border-primary focus:ring-4 focus:ring-primary/10"
                />
              </div>

              <div className="auth-field flex items-center gap-2 pt-4">
                <Building2 className="size-4 text-primary" />
                <h2 className="font-display text-sm font-bold uppercase tracking-wide text-muted-foreground">
                  Organization admin account
                </h2>
              </div>
              <p className="auth-field -mt-2 text-xs text-muted-foreground">
                This account will manage your organization once it&apos;s approved. It uses the same
                email as your organization — other members are invited later with role-based access.
              </p>
              <Field label="Admin full name" required placeholder="Ramesh Lama" value={form.adminName} onChange={setOrg("adminName")} />
              <div className="grid grid-cols-2 gap-4">
                <Field label="Password" type="password" required placeholder="••••••••" value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)} />
                <Field label="Confirm password" type="password" required placeholder="••••••••" value={adminConfirmPassword} onChange={(e) => setAdminConfirmPassword(e.target.value)} />
              </div>
              {adminPassword && adminConfirmPassword && adminPassword !== adminConfirmPassword && (
                <p className="auth-field text-xs text-amber-600">Passwords do not match.</p>
              )}

              <button
                type="submit"
                disabled={orgRegister.isPending || !orgCanSubmit}
                className="auth-field flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-[0_12px_32px_-12px_rgba(91,76,245,0.8)] transition-transform hover:-translate-y-0.5 disabled:opacity-60"
              >
                {orgRegister.isPending && <Loader2 className="size-4 animate-spin" />}
                Submit for approval
              </button>
            </>
          )}
        </form>
      )}

      {!orgSuccess && (
        <p className="auth-field mt-8 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href={loginHref} className="font-semibold text-primary hover:underline">
            Log In
          </Link>
        </p>
      )}
    </AuthShell>
  )
}

export default function RegisterPage() {
  return (
    <Suspense
      fallback={
        <AuthShell heading="Create your account" sub="Set up your EventNexus workspace in minutes.">
          <div className="flex justify-center py-8">
            <Loader2 className="size-6 animate-spin text-primary" />
          </div>
        </AuthShell>
      }
    >
      <RegisterPageInner />
    </Suspense>
  )
}