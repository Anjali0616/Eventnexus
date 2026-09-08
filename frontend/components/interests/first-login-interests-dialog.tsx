"use client"

import { useEffect, useState } from "react"
import { Loader2, Sparkles } from "lucide-react"
import { useCurrentUser } from "@/lib/queries/auth"
import { useUpdateMyInterests } from "@/lib/queries/users"
import { InterestsSelector } from "./interests-selector"

export function FirstLoginInterestsDialog() {
  const { data } = useCurrentUser()
  const user = data?.user
  const update = useUpdateMyInterests()
  const [selected, setSelected] = useState<string[]>([])
  const [dismissed, setDismissed] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  useEffect(() => setHydrated(true), [])

  const shouldShow =
    hydrated &&
    !dismissed &&
    !!user &&
    user.role === "attendee" &&
    (!user.interests || user.interests.length === 0)

  useEffect(() => {
    if (shouldShow && user?.interests) setSelected(user.interests)
  }, [shouldShow, user?.interests])

  useEffect(() => {
    if (!user) return
    const key = `interests-dismissed-${user._id}`
    if (sessionStorage.getItem(key)) setDismissed(true)
  }, [user])

  const handleDismiss = () => {
    if (user) sessionStorage.setItem(`interests-dismissed-${user._id}`, "1")
    setDismissed(true)
  }

  const handleSave = () => {
    if (selected.length === 0) {
      handleDismiss()
      return
    }
    update.mutate(selected, {
      onSuccess: () => setDismissed(true),
    })
  }

  if (!shouldShow) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 backdrop-blur-sm p-4">
      <div className="w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl animate-in fade-in zoom-in-95">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10">
            <Sparkles className="size-5 text-primary" />
          </span>
          <div>
            <h2 className="font-display text-lg font-bold text-ink">What are you into?</h2>
            <p className="text-xs text-muted-foreground">Pick your interests — we&apos;ll personalize events for you.</p>
          </div>
        </div>

        <div className="mt-5">
          <InterestsSelector value={selected} onChange={setSelected} />
        </div>

        <div className="mt-6 flex items-center justify-between gap-3">
          <button
            onClick={handleDismiss}
            className="text-sm font-medium text-muted-foreground hover:text-ink"
          >
            Skip for now
          </button>
          <button
            onClick={handleSave}
            disabled={update.isPending}
            className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-[0_8px_20px_-10px_rgba(91,76,245,0.8)] transition-transform hover:-translate-y-0.5 disabled:opacity-60"
          >
            {update.isPending && <Loader2 className="size-4 animate-spin" />}
            {selected.length === 0 ? "Continue" : `Save & explore`}
          </button>
        </div>
        <p className="mt-3 text-center text-[11px] text-muted-foreground">
          You can change this anytime in Settings → Interests.
        </p>
      </div>
    </div>
  )
}
