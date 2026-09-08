"use client"

import { useEffect, useState } from "react"
import { AppShell } from "@/components/app/app-shell"
import { Reveal } from "@/components/anim/reveal"
import { useCurrentUser, useLogout, useSessions, useRevokeSession, useExportMyData, useDeleteMyAccount } from "@/lib/queries/auth"
import { useSaveLocationCoords } from "@/lib/queries/location"
import { useUpdateMyPassword, useUpdateMyProfile, useUpdateReminderPreference, useUpdateMyInterests } from "@/lib/queries/users"
import { captureAndSaveLocation, getBrowserLocation } from "@/lib/api/location"
import { InterestsSelector } from "@/components/interests/interests-selector"
import {
  MapPin,
  Navigation,
  Loader2,
  Check,
  Trash2,
  Globe,
  Save,
  AlertCircle,
  KeyRound,
  Lock,
  Eye,
  EyeOff,
  UserRound,
  MonitorSmartphone,
  LogOut,
  Smartphone,
  Bell,
  BellOff,
  Download,
  Sparkles,
  Heart,
} from "lucide-react"

const roleToShell = (role?: string) =>
  role === "admin" || role === "org_admin"
    ? "Administrator"
    : role === "organizer"
      ? "Organizer"
      : "Attendee"

export default function AttendeeSettingsPage() {
  const { data: userData, refetch: refetchUser } = useCurrentUser()
  const saveCoords = useSaveLocationCoords()
  const updateProfile = useUpdateMyProfile()
  const updatePassword = useUpdateMyPassword()
  const updateReminderPref = useUpdateReminderPreference()
  const updateInterests = useUpdateMyInterests()
  const logout = useLogout()
  const exportData = useExportMyData()
  const deleteAccount = useDeleteMyAccount()
  const user = userData?.user

  const [manualLat, setManualLat] = useState(user?.location?.lat?.toString() || "")
  const [manualLng, setManualLng] = useState(user?.location?.lng?.toString() || "")
  const [manualCity, setManualCity] = useState(user?.location?.city || "")
  const [isDetecting, setIsDetecting] = useState(false)
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [detectError, setDetectError] = useState("")

  const [editName, setEditName] = useState(user?.name || "")
  const [profileStatus, setProfileStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [profileError, setProfileError] = useState("")

  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [showPasswords, setShowPasswords] = useState(false)
  const [passwordStatus, setPasswordStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [passwordError, setPasswordError] = useState("")

  const [reminderEmail, setReminderEmail] = useState(user?.reminderEmail ?? true)
  const [reminderStatus, setReminderStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
  const [deleteEmail, setDeleteEmail] = useState("")

  const [editInterests, setEditInterests] = useState<string[]>(user?.interests || [])
  const [interestsStatus, setInterestsStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")

  const hasLocation = user?.location?.lat != null

  const handleDetectLocation = async () => {
    setIsDetecting(true)
    setDetectError("")
    try {
      const coords = await getBrowserLocation()
      if (coords) {
        setManualLat(coords.lat.toString())
        setManualLng(coords.lng.toString())
        await captureAndSaveLocation()
        await refetchUser()
      } else {
        setDetectError("Location permission denied or unavailable. Check your browser settings.")
      }
    } catch {
      setDetectError("Could not detect your location. Try again.")
    } finally {
      setIsDetecting(false)
    }
  }

  const handleSave = async () => {
    const lat = parseFloat(manualLat)
    const lng = parseFloat(manualLng)
    if (isNaN(lat) || isNaN(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      setSaveStatus("error")
      return
    }
    setSaveStatus("saving")
    saveCoords.mutate(
      { lat, lng, city: manualCity || undefined },
      {
        onSuccess: () => {
          setSaveStatus("saved")
          refetchUser()
          setTimeout(() => setSaveStatus("idle"), 2000)
        },
        onError: () => {
          setSaveStatus("error")
        },
      }
    )
  }

  const handleRemoveLocation = async () => {
    setManualLat("")
    setManualLng("")
    setManualCity("")
    // Omitting lat/lng tells the backend to clear the location entirely —
    // the old code sent (0, 0), which "removed" the location to null island
    // while the UI still thought a location existed.
    saveCoords.mutate(
      { city: "" },
      {
        onSuccess: () => {
          refetchUser()
        },
      }
    )
  }

  const handleSaveProfile = () => {
    const name = editName.trim()
    if (!name) {
      setProfileStatus("error")
      setProfileError("Name can't be empty")
      return
    }
    setProfileStatus("saving")
    setProfileError("")
    updateProfile.mutate(name, {
      onSuccess: () => {
        setProfileStatus("saved")
        refetchUser()
        setTimeout(() => setProfileStatus("idle"), 2000)
      },
      onError: (err) => {
        setProfileStatus("error")
        setProfileError((err as any)?.response?.data?.message || "Couldn't save your name")
      },
    })
  }

  const handleChangePassword = () => {
    setPasswordError("")
    if (newPassword !== confirmPassword) {
      setPasswordStatus("error")
      setPasswordError("New passwords don't match")
      return
    }
    setPasswordStatus("saving")
    updatePassword.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          setPasswordStatus("saved")
          // The backend invalidates every session on password change — the
          // current one included — so this device must re-authenticate now.
          setTimeout(() => logout(), 1200)
        },
        onError: (err) => {
          setPasswordStatus("error")
          setPasswordError((err as any)?.response?.data?.message || "Couldn't change your password")
        },
      }
    )
  }

  const handleReminderToggle = () => {
    const next = !reminderEmail
    setReminderEmail(next)
    setReminderStatus("saving")
    updateReminderPref.mutate(next, {
      onSuccess: () => {
        setReminderStatus("saved")
        setTimeout(() => setReminderStatus("idle"), 2000)
      },
      onError: (err) => {
        setReminderStatus("error")
        setReminderEmail(reminderEmail) // revert on error
        setTimeout(() => setReminderStatus("idle"), 2000)
        console.error("Failed to update reminder preference:", err)
      },
    })
  }

  useEffect(() => {
    if (user?.interests) setEditInterests(user.interests)
    if (user?.name) setEditName(user.name)
    if (user?.reminderEmail !== undefined) setReminderEmail(user.reminderEmail)
    if (user?.location?.lat != null) {
      setManualLat(user.location.lat.toString())
      setManualLng(user.location.lng.toString())
      setManualCity(user.location.city || "")
    }
  }, [user?.interests, user?.name, user?.reminderEmail, user?.location?.lat, user?.location?.lng, user?.location?.city])

  const handleSaveInterests = () => {
    setInterestsStatus("saving")
    updateInterests.mutate(editInterests, {
      onSuccess: () => {
        setInterestsStatus("saved")
        refetchUser()
        setTimeout(() => setInterestsStatus("idle"), 2000)
      },
      onError: () => setInterestsStatus("error"),
    })
  }

  const shellRole = roleToShell(user?.role)
  const sessions = useSessions()
  const revokeSession = useRevokeSession()
  const deviceIcon = (ua: string) => {
    if (/mobile|iphone|android/i.test(ua)) return <Smartphone className="size-4" />
    return <MonitorSmartphone className="size-4" />
  }
  const pwInput = (label: string, value: string, onChange: (v: string) => void, placeholder: string) => (
    <div className="relative">
      <label className="text-xs font-medium text-ink">{label}</label>
      <input
        type={showPasswords ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 pr-10 text-sm text-ink outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
      />
      <button
        type="button"
        onClick={() => setShowPasswords((v) => !v)}
        className="absolute bottom-3 right-3 text-muted-foreground transition-colors hover:text-ink"
        aria-label={showPasswords ? "Hide passwords" : "Show passwords"}
      >
        {showPasswords ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  )

  return (
    <AppShell role={shellRole} userName={user?.name || "User"} title="Settings">
      <div className="space-y-8">
        <Reveal className="flex flex-col gap-1">
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">Settings</h1>
          <p className="text-sm text-muted-foreground">Manage your profile, location, and preferences.</p>
        </Reveal>

        <Reveal stagger={0.1} y={24} className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10">
                <Globe className="size-5 text-primary" />
              </span>
              <div>
                <h2 className="font-display text-base font-bold text-ink">Location</h2>
                <p className="text-xs text-muted-foreground">
                  Your location powers distance-based event recommendations and AI matching.
                </p>
              </div>
            </div>

            {hasLocation && (
              <div className="mt-5 rounded-xl bg-primary/5 px-4 py-3">
                <div className="flex items-center gap-2 text-sm">
                  <MapPin className="size-4 text-primary" />
                  <span className="font-medium text-ink">
                    {user.location?.city || `${user.location?.lat?.toFixed(4)}, ${user.location?.lng?.toFixed(4)}`}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    · Updated{" "}
                    {user.location?.updatedAt
                      ? new Date(user.location.updatedAt).toLocaleDateString()
                      : "recently"}
                  </span>
                </div>
              </div>
            )}

            {!hasLocation && (
              <div className="mt-5 rounded-xl border border-dashed border-amber-300 bg-amber-50/50 px-4 py-3">
                <div className="flex items-start gap-2 text-sm text-amber-700">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" />
                  <span>No location set. Enable location access for personalized recommendations.</span>
                </div>
              </div>
            )}

            <div className="mt-5 space-y-4">
              <button
                onClick={handleDetectLocation}
                disabled={isDetecting}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-primary/30 px-4 py-2.5 text-sm font-medium text-primary transition-colors hover:bg-primary/5 disabled:opacity-60"
              >
                {isDetecting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Navigation className="size-4" />
                )}
                {isDetecting ? "Detecting..." : "Auto-detect my location"}
              </button>

              {detectError && (
                <p className="text-xs text-amber-600">{detectError}</p>
              )}

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t border-border" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">or enter manually</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-ink">Latitude</label>
                  <input
                    type="number"
                    step="any"
                    value={manualLat}
                    onChange={(e) => setManualLat(e.target.value)}
                    placeholder="-90 to 90"
                    className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-ink outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-ink">Longitude</label>
                  <input
                    type="number"
                    step="any"
                    value={manualLng}
                    onChange={(e) => setManualLng(e.target.value)}
                    placeholder="-180 to 180"
                    className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-ink outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-ink">City (optional)</label>
                <input
                  type="text"
                  value={manualCity}
                  onChange={(e) => setManualCity(e.target.value)}
                  placeholder="e.g. San Francisco, CA"
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-ink outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
                />
              </div>

              <div className="flex gap-3">
                <button
                  onClick={handleSave}
                  disabled={saveStatus === "saving" || !manualLat || !manualLng}
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:opacity-60"
                >
                  {saveStatus === "saving" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : saveStatus === "saved" ? (
                    <>
                      <Check className="size-4" /> Saved
                    </>
                  ) : (
                    <>
                      <Save className="size-4" /> Save location
                    </>
                  )}
                </button>

                {hasLocation && (
                  <button
                    onClick={handleRemoveLocation}
                    className="flex items-center justify-center gap-2 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-ink"
                  >
                    <Trash2 className="size-4" /> Remove
                  </button>
                )}
              </div>

              {saveStatus === "error" && (
                <p className="text-xs text-amber-600">
                  Invalid coordinates. Latitude must be between -90 and 90, longitude between -180 and 180.
                </p>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10">
                <Heart className="size-5 text-primary" />
              </span>
              <div>
                <h2 className="font-display text-base font-bold text-ink">Interests</h2>
                <p className="text-xs text-muted-foreground">
                  Choose categories you love — recommendations are tuned to these first.
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              <InterestsSelector
                value={editInterests}
                onChange={setEditInterests}
                disabled={interestsStatus === "saving"}
              />

              <div className="flex items-center gap-2">
                <button
                  onClick={handleSaveInterests}
                  disabled={
                    interestsStatus === "saving" ||
                    JSON.stringify([...editInterests].sort()) === JSON.stringify([...(user?.interests || [])].sort())
                  }
                  className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:opacity-60"
                >
                  {interestsStatus === "saving" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : interestsStatus === "saved" ? (
                    <>
                      <Check className="size-4" /> Saved
                    </>
                  ) : (
                    <>
                      <Sparkles className="size-4" /> Save interests
                    </>
                  )}
                </button>
                {editInterests.length > 0 && (
                  <button
                    onClick={() => setEditInterests([])}
                    className="rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-ink"
                  >
                    Clear
                  </button>
                )}
              </div>

              {interestsStatus === "error" && (
                <p className="text-xs text-amber-600">Couldn&apos;t save interests. Try again.</p>
              )}
              {interestsStatus === "saved" && (
                <p className="text-xs text-emerald-600">Your recommendations will now prioritize {editInterests.join(", ")}.</p>
              )}
              {editInterests.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  No interests selected — you&apos;ll see general trending events. Pick a few to personalize your feed.
                </p>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10">
                <Bell className="size-5 text-primary" />
              </span>
              <div>
                <h2 className="font-display text-base font-bold text-ink">Notifications</h2>
                <p className="text-xs text-muted-foreground">
                  Choose whether to receive email reminders for upcoming events and post-event feedback.
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10">
                    {reminderEmail ? <Bell className="size-5 text-primary" /> : <BellOff className="size-5 text-muted-foreground" />}
                  </span>
                  <div>
                    <h3 className="font-display text-sm font-bold text-ink">Email reminders</h3>
                    <p className="text-xs text-muted-foreground">
                      Get reminded before events start and nudged for feedback after events end.
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleReminderToggle}
                  disabled={reminderStatus === "saving"}
                  className={`flex shrink-0 items-center h-6 rounded-lg px-3 transition-colors ${
                    reminderEmail
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  } disabled:opacity-60`}
                  aria-label={reminderEmail ? "Disable email reminders" : "Enable email reminders"}
                >
                  <span className="text-xs font-medium">{reminderEmail ? "On" : "Off"}</span>
                  {reminderStatus === "saving" && (
                    <Loader2 className="size-3 ml-1 animate-spin" />
                  )}
                </button>
              </div>

              {reminderStatus === "error" && (
                <p className="text-xs text-amber-600">Could not save preference. Please try again.</p>
              )}
              {reminderStatus === "saved" && (
                <p className="text-xs text-emerald-600">Saved.</p>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-muted">
                <UserRound className="size-5 text-ink" />
              </span>
              <div>
                <h2 className="font-display text-base font-bold text-ink">Profile</h2>
                <p className="text-xs text-muted-foreground">Your account information</p>
              </div>
            </div>

            <div className="mt-5 space-y-4">
              <div>
                <label className="text-xs font-medium text-ink">Name</label>
                <input
                  type="text"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  maxLength={80}
                  className="mt-1 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-ink outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
                />
              </div>
              <div className="rounded-xl bg-muted/50 px-4 py-3">
                <div className="text-xs text-muted-foreground">Email</div>
                <div className="text-sm font-semibold text-ink">{user?.email || "—"}</div>
              </div>
              <div className="rounded-xl bg-muted/50 px-4 py-3">
                <div className="text-xs text-muted-foreground">Role</div>
                <div className="text-sm font-semibold text-ink capitalize">{user?.role || "—"}</div>
              </div>

              <button
                onClick={handleSaveProfile}
                disabled={profileStatus === "saving" || !editName.trim() || editName.trim() === user?.name}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:opacity-60"
              >
                {profileStatus === "saving" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : profileStatus === "saved" ? (
                  <>
                    <Check className="size-4" /> Saved
                  </>
                ) : (
                  <>
                    <Save className="size-4" /> Save profile
                  </>
                )}
              </button>

              {profileStatus === "error" && <p className="text-xs text-amber-600">{profileError}</p>}
            </div>
          </div>

          {!user?.googleAccount && (
            <div className="rounded-2xl border border-border bg-card p-6">
              <div className="flex items-center gap-3">
                <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10">
                  <KeyRound className="size-5 text-primary" />
                </span>
                <div>
                  <h2 className="font-display text-base font-bold text-ink">Password</h2>
                  <p className="text-xs text-muted-foreground">
                    Change the password for your {user?.email} account
                  </p>
                </div>
              </div>

              <div className="mt-5 space-y-4">
                {pwInput("Current password", currentPassword, setCurrentPassword, "Enter current password")}
                {pwInput("New password", newPassword, setNewPassword, "At least 6 characters")}
                {pwInput("Confirm new password", confirmPassword, setConfirmPassword, "Repeat new password")}

                <button
                  onClick={handleChangePassword}
                  disabled={
                    passwordStatus === "saving" ||
                    !currentPassword ||
                    newPassword.length < 6 ||
                    !confirmPassword
                  }
                  className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:opacity-60"
                >
                  {passwordStatus === "saving" ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : passwordStatus === "saved" ? (
                    <>
                      <Check className="size-4" /> Password updated
                    </>
                  ) : (
                    <>
                      <Lock className="size-4" /> Change password
                    </>
                  )}
                </button>

                {passwordStatus === "error" && (
                  <p className="flex items-center gap-1.5 text-xs text-amber-600">
                    <AlertCircle className="size-3.5" /> {passwordError}
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="rounded-2xl border border-border bg-card p-6 lg:col-span-2">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10">
                <MonitorSmartphone className="size-5 text-primary" />
              </span>
              <div>
                <h2 className="font-display text-base font-bold text-ink">Active sessions</h2>
                <p className="text-xs text-muted-foreground">
                  Devices currently signed in to your account. Revoke any you don&apos;t recognize.
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-3">
              {sessions.isLoading && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-4 animate-spin" /> Loading sessions…
                </div>
              )}
              {sessions.data?.sessions.length === 0 && (
                <p className="text-sm text-muted-foreground">No active sessions.</p>
              )}
              {sessions.data?.sessions.map((s) => (
                <div
                  key={s._id}
                  className="flex items-center gap-3 rounded-xl border border-border bg-background px-4 py-3"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-ink">
                    {deviceIcon(s.userAgent || "")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">
                      {s.userAgent?.split("(")[0].trim() || "Unknown device"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {s.ip || "IP hidden"} · Last active{" "}
                      {s.lastUsedAt
                        ? new Date(s.lastUsedAt).toLocaleString()
                        : new Date(s.createdAt).toLocaleString()}
                    </p>
                  </div>
                  <button
                    onClick={() => revokeSession.mutate(s._id)}
                    disabled={revokeSession.isPending}
                    className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                  >
                    <LogOut className="size-3.5" /> Revoke
                  </button>
                </div>
              ))}
              {sessions.isError && (
                <p className="text-xs text-amber-600">Could not load sessions.</p>
              )}
            </div>
          </div>
        </Reveal>

        {/* GDPR: Data Export & Account Deletion */}
        <Reveal stagger={0.1} y={24}>
          <div className="rounded-2xl border border-border bg-card p-6">
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-xl bg-destructive/10">
                <Trash2 className="size-5 text-destructive" />
              </span>
              <div>
                <h2 className="font-display text-base font-bold text-ink">Privacy & Data</h2>
                <p className="text-xs text-muted-foreground">
                  Manage your personal data (GDPR rights): export everything or permanently delete
                  your account.
                </p>
              </div>
            </div>

            <div className="mt-5 space-y-6">
              {/* Export Data */}
              <div className="flex items-center justify-between rounded-xl border border-border bg-background p-4">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-emerald/10">
                    <Download className="size-5 text-emerald-600" />
                  </span>
                  <div>
                    <h3 className="font-display text-sm font-bold text-ink">Export my data</h3>
                    <p className="text-xs text-muted-foreground">
                      Download a JSON file with your profile, tickets, organized events, feedback,
                      notifications, and sessions.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => exportData.mutate()}
                  disabled={exportData.isPending}
                  className="flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                >
                  {exportData.isPending && <Loader2 className="size-4 animate-spin" />}
                  <Download className="size-4" /> Download JSON
                </button>
              </div>

              {/* Delete Account */}
              <div className="flex items-center justify-between rounded-xl border border-destructive/30 bg-destructive/5 p-4">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-xl bg-destructive/10">
                    <Trash2 className="size-5 text-destructive" />
                  </span>
                  <div>
                    <h3 className="font-display text-sm font-bold text-ink">Delete my account</h3>
                    <p className="text-xs text-muted-foreground">
                      Permanently delete your account and anonymize all personal data. This cannot
                      be undone.
                    </p>
                  </div>
                </div>
                {showDeleteConfirm ? (
                  <div className="flex items-center gap-2">
                    <input
                      type="email"
                      value={deleteEmail}
                      onChange={(e) => setDeleteEmail(e.target.value)}
                      placeholder="Type your email to confirm"
                      className="flex-1 max-w-xs rounded-xl border border-destructive bg-background px-3 py-2 text-sm text-ink outline-none focus:border-destructive focus:ring-4 focus:ring-destructive/20"
                    />
                    <button
                      onClick={() => {
                        if (deleteEmail === user?.email) {
                          deleteAccount.mutate()
                        }
                      }}
                      disabled={deleteAccount.isPending || deleteEmail !== user?.email}
                      className="flex items-center gap-1.5 rounded-lg bg-destructive px-3 py-2 text-xs font-semibold text-destructive-foreground disabled:opacity-50"
                    >
                      {deleteAccount.isPending && <Loader2 className="size-3.5 animate-spin" />}
                      Delete Permanently
                    </button>
                    <button
                      onClick={() => setShowDeleteConfirm(false)}
                      className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowDeleteConfirm(true)}
                    className="flex items-center gap-1.5 rounded-lg border border-destructive/30 px-3 py-1.5 text-xs font-medium text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 className="size-3.5" /> Delete Account
                  </button>
                )}
              </div>
            </div>
          </div>
        </Reveal>
      </div>
    </AppShell>
  )
}
