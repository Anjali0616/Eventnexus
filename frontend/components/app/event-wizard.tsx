"use client"

import { useEffect, useRef, useState } from "react"
import {
  Calendar,
  Check,
  ChevronLeft,
  ChevronRight,
  Image as ImageIcon,
  Loader2,
  Mail,
  MapPin,
  Mic,
  Phone,
  Plus,
  Sparkles,
  Tag,
  Trash2,
  X,
} from "lucide-react"
import { EVENT_CATEGORIES, EVENT_STATUSES, EVENT_TYPES, SUGGESTED_TAGS } from "@/lib/constants/event-options"
import { eventDateError, maxFutureEventDate, MAX_FUTURE_EVENT_YEARS, toDatetimeLocal } from "@/lib/event-date"
import type { CreateEventPayload, EventAgendaItem, EventData, EventSpeaker } from "@/lib/api/events"
import { eventsApi } from "@/lib/api/events"
import { geocodeVenue, type GeocodeHit } from "@/lib/geocode"

type FormState = {
  title: string
  description: string
  date: string
  venue: string
  // Resolved from the venue via geocoding. Optional by design — a venue that
  // isn't in any map database must still be publishable — but when present it
  // is what powers "new event near you" alerts, distance ranking and the
  // venue map. Without it those features silently do nothing for this event.
  coordinates: { lat: number; lng: number } | null
  type: (typeof EVENT_TYPES)[number]
  category: string
  tags: string[]
  imageUrl: string
  // Strings while editing so the field can be cleared and re-typed; they're
  // converted to numbers in handleSubmit. "Past" is included so organizers
  // can manage concluded events.
  capacity: string
  price: string
  status: (typeof EVENT_STATUSES)[number] | "Past"
  agenda: EventAgendaItem[]
  speakers: EventSpeaker[]
  highlights: string[]
  requirements: string
  refundPolicy: string
  contactEmail: string
  contactPhone: string
  website: string
}

const emptyForm: FormState = {
  title: "",
  description: "",
  date: "",
  venue: "",
  coordinates: null,
  type: "In-person",
  category: "Technology",
  tags: [],
  imageUrl: "",
  capacity: "100",
  price: "0",
  status: "Draft",
  agenda: [],
  speakers: [],
  highlights: [],
  requirements: "",
  refundPolicy: "",
  contactEmail: "",
  contactPhone: "",
  website: "",
}

const steps = [
  { id: 1, label: "Basics", hint: "Identity & cover" },
  { id: 2, label: "Logistics", hint: "Schedule & program" },
  { id: 3, label: "Review", hint: "Extras & publish" },
]

const inputClass =
  "w-full rounded-xl border border-border bg-card px-4 py-3 text-sm text-ink outline-none transition-colors focus:border-primary focus:ring-4 focus:ring-primary/10"

// Downscales + re-encodes a source image client-side so the base64 payload
// we send stays small (no object-storage provider is configured, so the
// cover image is stored as a data URL directly on the event document).
function compressImage(file: File, maxWidth = 1280, quality = 0.82): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error("Could not read file"))
    reader.onload = () => {
      const img = new window.Image()
      img.onerror = () => reject(new Error("Could not load image"))
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width)
        const canvas = document.createElement("canvas")
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        const ctx = canvas.getContext("2d")
        if (!ctx) return reject(new Error("Canvas unsupported"))
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL("image/jpeg", quality))
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  })
}

// The backend only accepts future dates on create, but lets organizers keep
// Past/Draft events on past dates when updating — so validation is relaxed
// for those statuses in edit mode.
function requiresFutureDate(status: FormState["status"], mode: "create" | "edit") {
  return mode === "create" || (status !== "Past" && status !== "Draft")
}

export function EventWizard({
  mode,
  initialData,
  isPending = false,
  submitError = "",
  submitLabel = "Publish Event",
  onSubmit,
}: {
  mode: "create" | "edit"
  initialData?: EventData
  isPending?: boolean
  submitError?: string
  submitLabel?: string
  onSubmit: (payload: CreateEventPayload) => void
}) {
  const [step, setStep] = useState(1)
  const [form, setForm] = useState<FormState>(() => {
    if (!initialData) return emptyForm
    const e = initialData
    return {
      title: e.title || "",
      description: e.description || "",
      date: e.date ? toDatetimeLocal(e.date) : "",
      venue: e.venue || "",
      coordinates:
        e.coordinates?.lat != null && e.coordinates?.lng != null
          ? { lat: e.coordinates.lat, lng: e.coordinates.lng }
          : null,
      type: e.type,
      category: e.category || "Technology",
      tags: e.tags ?? [],
      imageUrl: e.imageUrl ?? "",
      capacity: String(e.capacity),
      price: String(e.price?.amount ?? 0),
      // Carry the event's ACTUAL status through. This used to collapse
      // anything that wasn't Past or Live down to "Draft" — so opening a
      // published *Upcoming* event to fix a typo and pressing Save silently
      // unpublished it: gone from Discover, from recommendations, and from
      // registration, with nothing to tell the organizer it had happened.
      status: e.status,
      agenda: e.agenda ?? [],
      speakers: e.speakers ?? [],
      highlights: e.highlights ?? [],
      requirements: e.requirements ?? "",
      refundPolicy: e.refundPolicy ?? "",
      contactEmail: e.contactEmail ?? "",
      contactPhone: e.contactPhone ?? "",
      website: e.website ?? "",
    }
  })
  const [tagInput, setTagInput] = useState("")
  const [highlightInput, setHighlightInput] = useState("")
  const [imageError, setImageError] = useState("")
  const [imageBusy, setImageBusy] = useState(false)
  const [geoBusy, setGeoBusy] = useState(false)
  const [geoError, setGeoError] = useState("")
  const [geoHits, setGeoHits] = useState<GeocodeHit[]>([])
  const [aiDraftBusy, setAiDraftBusy] = useState(false)
  const [aiDraftMsg, setAiDraftMsg] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  const update = <K extends keyof FormState>(field: K, value: FormState[K]) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  // Auto-save draft to localStorage every 2s (professional: survives refresh)
  const draftKey = `eventwizard-draft-${mode}-${initialData?._id || "new"}`
  const [showRestore, setShowRestore] = useState(false)
  const [lastSaved, setLastSaved] = useState<string | null>(null)
  useEffect(() => {
    if (mode === "create" && !initialData) {
      const saved = localStorage.getItem(draftKey)
      if (saved) {
        try {
          const parsed = JSON.parse(saved)
          if (parsed?.title && !form.title) setShowRestore(true)
        } catch {}
      }
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const id = setTimeout(() => {
      if (form.title.trim().length >= 2) {
        localStorage.setItem(draftKey, JSON.stringify(form))
        setLastSaved(new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }))
      }
    }, 1500)
    return () => clearTimeout(id)
  }, [form, draftKey])
  const clearDraft = () => {
    localStorage.removeItem(draftKey)
    setShowRestore(false)
  }

  const draftValid = form.title.trim().length >= 3
  const step1Valid = form.title.trim().length >= 3 && form.description.trim().length >= 20 && !!form.category
  const needFuture = requiresFutureDate(form.status, mode)
  const dateError = needFuture ? eventDateError(form.date) : form.date && isNaN(new Date(form.date).getTime()) ? "That doesn't look like a valid date" : null
  const step2Valid =
    !dateError &&
    form.venue.trim().length >= 2 &&
    Number(form.capacity) >= 1 &&
    Number(form.price) >= 0
  const stepValid = [true, step1Valid, step2Valid, true][step] ?? true

  const goNext = () => setStep((s) => Math.min(3, s + 1))
  const goBack = () => setStep((s) => Math.max(1, s - 1))

  const handleImagePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ""
    if (!file) return
    if (!file.type.startsWith("image/")) {
      setImageError("Please choose an image file.")
      return
    }
    if (file.size > 15 * 1024 * 1024) {
      setImageError("Image is too large (max 15MB).")
      return
    }
    setImageError("")
    setImageBusy(true)
    try {
      const dataUrl = await compressImage(file)
      if (dataUrl.length > 6_000_000) {
        setImageError("Image still too large after compression (6MB limit) — choose a smaller file or lower resolution.")
        return
      }
      update("imageUrl", dataUrl)
    } catch {
      setImageError("Could not process that image — try a different file.")
    } finally {
      setImageBusy(false)
    }
  }

  // Best-effort: geocoding never blocks publishing, because plenty of real
  // venues ("Our office, 3rd floor") aren't in any map database.
  const handleGeocode = async () => {
    setGeoBusy(true)
    setGeoError("")
    setGeoHits([])
    try {
      const hits = await geocodeVenue(form.venue)
      if (hits.length === 0) {
        setGeoError("Couldn't find that venue. Try adding a city, or publish without a pin.")
      } else if (hits.length === 1) {
        update("coordinates", { lat: hits[0].lat, lng: hits[0].lng })
      } else {
        setGeoHits(hits)
      }
    } catch {
      setGeoError("Location lookup is unavailable right now — you can still publish without a pin.")
    } finally {
      setGeoBusy(false)
    }
  }

  // AI-assisted draft: fills description, highlights, tags, agenda from minimal title
  // — organizer only needs to provide title, the AI does the rest, editable afterwards.
  const handleAiDraft = async () => {
    if (!form.title.trim() || form.title.trim().length < 3) {
      setAiDraftMsg("Add a title first (min 3 chars).")
      return
    }
    setAiDraftBusy(true)
    setAiDraftMsg("")
    try {
      const { draft } = await eventsApi.aiDraft({
        title: form.title.trim(),
        category: form.category,
        type: form.type,
        venue: form.venue,
        capacity: Number(form.capacity) || 100,
      })
      // Only fill empty/placeholder fields — never overwrite organizer's manual edits
      // unless the field is still in its empty initial state.
      setForm((prev) => ({
        ...prev,
        description: prev.description.trim().length < 20 ? draft.description : prev.description,
        highlights: prev.highlights.length === 0 ? draft.highlights : prev.highlights,
        tags: prev.tags.length === 0 ? draft.tags : [...new Set([...prev.tags, ...draft.tags])].slice(0, 8),
        agenda: prev.agenda.length === 0 ? draft.agenda : prev.agenda,
        requirements: !prev.requirements.trim() ? draft.requirements : prev.requirements,
        refundPolicy: !prev.refundPolicy.trim() ? draft.refundPolicy : prev.refundPolicy,
      }))
      setAiDraftMsg("AI draft filled — review and edit before publishing.")
    } catch {
      setAiDraftMsg("AI assist is temporarily unavailable — please fill manually.")
    } finally {
      setAiDraftBusy(false)
    }
  }

  const addTag = (raw: string) => {
    const value = raw.trim()
    if (!value || form.tags.includes(value)) return
    update("tags", [...form.tags, value])
  }
  const removeTag = (value: string) => update("tags", form.tags.filter((t) => t !== value))

  const addHighlight = (raw: string) => {
    const value = raw.trim()
    if (!value) return
    update("highlights", [...form.highlights, value])
  }
  const removeHighlight = (idx: number) => update("highlights", form.highlights.filter((_, i) => i !== idx))

  const addAgendaItem = () => update("agenda", [...form.agenda, { time: "", title: "", description: "" }])
  const updateAgendaItem = (idx: number, field: keyof EventAgendaItem, value: string) =>
    update("agenda", form.agenda.map((item, i) => (i === idx ? { ...item, [field]: value } : item)))
  const removeAgendaItem = (idx: number) => update("agenda", form.agenda.filter((_, i) => i !== idx))

  const addSpeaker = () => update("speakers", [...form.speakers, { name: "", role: "", bio: "" }])
  const updateSpeaker = (idx: number, field: keyof EventSpeaker, value: string) =>
    update("speakers", form.speakers.map((sp, i) => (i === idx ? { ...sp, [field]: value } : sp)))
  const removeSpeaker = (idx: number) => update("speakers", form.speakers.filter((_, i) => i !== idx))

  const handleSubmit = (e?: React.SyntheticEvent) => {
    e?.preventDefault()
    if (isPending || imageBusy) return
    // Only the Publish button (step 3) may submit. Clicking "Continue" swaps
    // this form's button into the type=submit button at the same DOM
    // position, and Chromium then fires a submit for it — without this guard
    // a click on "Continue" on step 2 would publish straight away, skipping
    // the review step.
    if (step !== 3) return
    if (!step1Valid || !step2Valid) return
    // Guard NaN
    const capNum = Number(form.capacity)
    const priceNum = Number(form.price)
    if (!Number.isInteger(capNum) || capNum < 1) return
    if (Number.isNaN(priceNum) || priceNum < 0) return
    if (form.imageUrl && form.imageUrl.length > 6_000_000) {
      setImageError("Image is too large after compression — choose a smaller file.")
      return
    }
    clearDraft()
    onSubmit({
      ...form,
      capacity: capNum,
      price: priceNum || 0,
      coordinates: form.coordinates ?? undefined,
      agenda: form.agenda.filter((a) => a.time.trim() || a.title.trim()),
      speakers: form.speakers.filter((s) => s.name.trim()),
      tags: form.tags.slice(0, 20),
      highlights: form.highlights.slice(0, 20),
    })
  }

  const handleSaveDraft = (e?: React.SyntheticEvent) => {
    e?.preventDefault()
    if (isPending || imageBusy) return
    if (!draftValid) return
    clearDraft()
    // Draft saves with minimal payload — backend fills defaults for missing venue/capacity/date
    const capNum = Number(form.capacity)
    const priceNum = Number(form.price)
    onSubmit({
      ...form,
      status: "Draft",
      capacity: Number.isInteger(capNum) && capNum >= 1 ? capNum : 100,
      price: Number.isNaN(priceNum) || priceNum < 0 ? 0 : priceNum,
      coordinates: form.coordinates ?? undefined,
      agenda: form.agenda.filter((a) => a.time.trim() || a.title.trim()),
      speakers: form.speakers.filter((s) => s.name.trim()),
      tags: form.tags.slice(0, 20),
      highlights: form.highlights.slice(0, 20),
    })
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div>
        <div className="flex items-center justify-between">
          <h1 className="font-display text-2xl font-bold tracking-tight text-ink">
            {mode === "create" ? "Create New Event" : "Edit Event"}
          </h1>
          {lastSaved && <span className="text-xs text-muted-foreground">Draft auto-saved at {lastSaved}</span>}
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          {mode === "create"
            ? "A complete, well-documented listing builds trust and drives registrations."
            : "Changes apply immediately — attendees see the updated listing as soon as you save."}
        </p>
        {showRestore && (
          <div className="mt-3 flex items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
            <p className="text-sm text-amber-800">Found an unsaved draft — restore it?</p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => {
                  try {
                    const saved = JSON.parse(localStorage.getItem(draftKey) || "{}")
                    if (saved?.title) setForm((prev) => ({ ...prev, ...saved }))
                  } catch {}
                  setShowRestore(false)
                }}
                className="rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700"
              >
                Restore
              </button>
              <button type="button" onClick={clearDraft} className="rounded-lg border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100">
                Dismiss
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Step indicator */}
      <div className="flex items-center">
        {steps.map((s, i) => (
          <div key={s.id} className="flex flex-1 items-center last:flex-none">
            <button
              type="button"
              onClick={() => s.id < step && setStep(s.id)}
              className="flex items-center gap-3"
            >
              <span
                className={`flex size-9 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-colors ${
                  s.id < step
                    ? "bg-primary text-primary-foreground"
                    : s.id === step
                      ? "bg-primary/10 text-primary ring-2 ring-primary"
                      : "bg-muted text-muted-foreground"
                }`}
              >
                {s.id < step ? <Check className="size-4" /> : s.id}
              </span>
              <span className="hidden text-left sm:block">
                <span className={`block text-sm font-semibold ${s.id <= step ? "text-ink" : "text-muted-foreground"}`}>
                  {s.label}
                </span>
                <span className="block text-xs text-muted-foreground">{s.hint}</span>
              </span>
            </button>
            {i < steps.length - 1 && (
              <div className={`mx-3 h-0.5 flex-1 rounded-full transition-colors ${s.id < step ? "bg-primary" : "bg-muted"}`} />
            )}
          </div>
        ))}
      </div>

      {submitError && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{submitError}</div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {step === 1 && (
          <div className="space-y-6 rounded-2xl border border-border bg-card p-6">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-ink">Cover image</label>
              <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handleImagePick} />
              {form.imageUrl ? (
                <div className="relative overflow-hidden rounded-2xl border border-border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={form.imageUrl} alt="Event cover preview" className="h-52 w-full object-cover" />
                  <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/60 to-transparent p-3">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="rounded-lg bg-white/90 px-3 py-1.5 text-xs font-semibold text-ink hover:bg-white"
                    >
                      Replace
                    </button>
                    <button
                      type="button"
                      onClick={() => update("imageUrl", "")}
                      className="rounded-lg bg-white/90 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-white"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={imageBusy}
                  className="flex h-52 w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border bg-muted/30 text-muted-foreground transition-colors hover:border-primary/40 hover:bg-primary/[0.03] hover:text-primary"
                >
                  {imageBusy ? <Loader2 className="size-6 animate-spin" /> : <ImageIcon className="size-6" />}
                  <span className="text-sm font-medium">{imageBusy ? "Processing…" : "Click to upload a banner image"}</span>
                  <span className="text-xs">PNG or JPG, recommended 1280×720</span>
                </button>
              )}
              {imageError && <p className="text-xs text-red-600">{imageError}</p>}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium text-ink">Event Title</label>
                <button
                  type="button"
                  onClick={handleAiDraft}
                  disabled={aiDraftBusy || form.title.trim().length < 3}
                  className="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/5 px-3 py-1 text-xs font-semibold text-primary transition hover:bg-primary/10 disabled:opacity-40"
                  title="AI will draft description, highlights, tags & agenda from title"
                >
                  {aiDraftBusy ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
                  AI Draft
                </button>
              </div>
              <input
                required
                value={form.title}
                onChange={(e) => update("title", e.target.value)}
                placeholder="DevSummit 2026"
                className={inputClass}
              />
              {aiDraftMsg && <p className={`text-xs ${aiDraftMsg.includes("unavailable") ? "text-amber-600" : "text-secondary"}`}>{aiDraftMsg}</p>}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-ink">Type</label>
                <select value={form.type} onChange={(e) => update("type", e.target.value as FormState["type"])} className={inputClass}>
                  {EVENT_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-ink">Category</label>
                <select value={form.category} onChange={(e) => update("category", e.target.value)} className={inputClass}>
                  {EVENT_CATEGORIES.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-ink">
                Description <span className="text-muted-foreground">({form.description.trim().length}/20 min)</span>
              </label>
              <textarea
                value={form.description}
                onChange={(e) => update("description", e.target.value)}
                placeholder="Describe what the event is about, who it's for, and what makes it worth attending..."
                rows={5}
                className={`${inputClass} resize-none`}
              />
            </div>

            <div className="space-y-1.5">
              <label className="flex items-center gap-1.5 text-sm font-medium text-ink">
                <Tag className="size-3.5" /> Tags
              </label>
              <div className="flex flex-wrap gap-2">
                {form.tags.map((t) => (
                  <span key={t} className="flex items-center gap-1 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                    {t}
                    <button type="button" onClick={() => removeTag(t)}><X className="size-3" /></button>
                  </span>
                ))}
              </div>
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault()
                    addTag(tagInput)
                    setTagInput("")
                  }
                }}
                placeholder="Type a tag and press Enter"
                className={inputClass}
              />
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTED_TAGS.filter((t) => !form.tags.includes(t)).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => addTag(t)}
                    className="rounded-full border border-dashed border-border px-2.5 py-1 text-[11px] text-muted-foreground hover:border-primary/40 hover:text-primary"
                  >
                    + {t}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-6 rounded-2xl border border-border bg-card p-6">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-ink">Date & Time</label>
                <input
                  required
                  type="datetime-local"
                  value={form.date}
                  min={needFuture ? toDatetimeLocal(new Date()) : undefined}
                  max={toDatetimeLocal(maxFutureEventDate())}
                  onChange={(e) => update("date", e.target.value)}
                  className={`${inputClass} ${
                    form.date && dateError ? "border-red-400 focus:border-red-500 focus:ring-red-500/10" : ""
                  }`}
                />
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs text-muted-foreground">
                    {needFuture
                      ? `Must be today or later, and no more than ${MAX_FUTURE_EVENT_YEARS} years out.`
                      : `Past dates are fine while the event is marked ${form.status}.`}
                  </p>
                  {form.date && dateError && (
                    <p className="text-xs font-medium text-red-600">{dateError}</p>
                  )}
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-ink">Venue</label>
                <div className="flex gap-2">
                  <input
                    required
                    value={form.venue}
                    onChange={(e) => {
                      update("venue", e.target.value)
                      // Editing the venue invalidates a previously pinned
                      // location — keeping the old point would silently
                      // advertise the event at the wrong address.
                      if (form.coordinates) update("coordinates", null)
                      setGeoHits([])
                      setGeoError("")
                    }}
                    placeholder="Venue name or address"
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={handleGeocode}
                    disabled={geoBusy || form.venue.trim().length < 3}
                    title="Find this venue on the map"
                    className="flex shrink-0 items-center gap-1.5 rounded-xl border border-border px-3.5 text-sm font-medium text-ink transition-colors hover:border-primary/40 hover:text-primary disabled:opacity-50"
                  >
                    {geoBusy ? <Loader2 className="size-4 animate-spin" /> : <MapPin className="size-4" />}
                    Locate
                  </button>
                </div>

                {/* Pinning a location is what makes "new event near you"
                    alerts, distance ranking and the venue map work for this
                    event — so the state is shown explicitly rather than left
                    as an invisible detail. */}
                {form.coordinates ? (
                  <p className="flex items-center gap-1.5 text-xs font-medium text-secondary">
                    <Check className="size-3.5" />
                    Location pinned — nearby attendees will be alerted when you publish
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Optional: tap <span className="font-medium text-ink">Locate</span> to pin this venue on
                    the map. Without it, attendees near the venue won&apos;t get a &ldquo;new event near
                    you&rdquo; alert.
                  </p>
                )}
                {geoError && <p className="text-xs font-medium text-red-600">{geoError}</p>}

                {geoHits.length > 0 && (
                  <div className="mt-1 overflow-hidden rounded-xl border border-border">
                    {geoHits.map((hit) => (
                      <button
                        key={`${hit.lat},${hit.lng}`}
                        type="button"
                        onClick={() => {
                          update("coordinates", { lat: hit.lat, lng: hit.lng })
                          setGeoHits([])
                        }}
                        className="flex w-full items-start gap-2 border-b border-border/60 px-3 py-2 text-left text-xs transition-colors last:border-b-0 hover:bg-muted/50"
                      >
                        <MapPin className="mt-0.5 size-3.5 shrink-0 text-primary" />
                        <span className="text-muted-foreground">{hit.label}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-ink">Capacity</label>
                <input
                  required
                  type="number"
                  min={1}
                  value={form.capacity}
                  onChange={(e) => update("capacity", e.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-ink">Price (NPR)</label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">Rs.</span>
                  <input
                    type="number"
                    min={0}
                    step="1"
                    value={form.price}
                    onChange={(e) => update("price", e.target.value)}
                    placeholder="0"
                    className={`${inputClass} pl-10`}
                  />
                </div>
                <p className="text-xs text-muted-foreground">Leave at 0 for a free event.</p>
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium text-ink">Status</label>
              <select value={form.status} onChange={(e) => update("status", e.target.value as FormState["status"])} className={inputClass}>
                {[...EVENT_STATUSES, ...(mode === "edit" ? (["Past"] as const) : [])].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <p className="text-xs text-muted-foreground">
                {form.status === "Draft" ? "Hidden from attendees until you publish it as Upcoming or Live." : "Visible to all attendees on the events page."}
              </p>
            </div>

            <div className="space-y-3 border-t border-border pt-5">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-sm font-medium text-ink">
                  <Calendar className="size-3.5" /> Agenda / Run of show
                </label>
                <button type="button" onClick={addAgendaItem} className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-ink hover:bg-muted">
                  <Plus className="size-3.5" /> Add item
                </button>
              </div>
              {form.agenda.length === 0 && <p className="text-xs text-muted-foreground">Optional — break the event into a timed schedule.</p>}
              <div className="space-y-2">
                {form.agenda.map((item, idx) => (
                  <div key={idx} className="flex gap-2 rounded-xl border border-border bg-muted/20 p-3">
                    <input
                      value={item.time}
                      onChange={(e) => updateAgendaItem(idx, "time", e.target.value)}
                      placeholder="10:00 AM"
                      className="w-28 rounded-lg border border-border bg-card px-2.5 py-2 text-xs text-ink outline-none focus:border-primary"
                    />
                    <input
                      value={item.title}
                      onChange={(e) => updateAgendaItem(idx, "title", e.target.value)}
                      placeholder="Session title"
                      className="flex-1 rounded-lg border border-border bg-card px-2.5 py-2 text-xs text-ink outline-none focus:border-primary"
                    />
                    <input
                      value={item.description}
                      onChange={(e) => updateAgendaItem(idx, "description", e.target.value)}
                      placeholder="Details (optional)"
                      className="flex-1 rounded-lg border border-border bg-card px-2.5 py-2 text-xs text-ink outline-none focus:border-primary"
                    />
                    <button type="button" onClick={() => removeAgendaItem(idx)} className="shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-red-50 hover:text-red-600">
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-3 border-t border-border pt-5">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-1.5 text-sm font-medium text-ink">
                  <Mic className="size-3.5" /> Speakers / Hosts
                </label>
                <button type="button" onClick={addSpeaker} className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-ink hover:bg-muted">
                  <Plus className="size-3.5" /> Add speaker
                </button>
              </div>
              {form.speakers.length === 0 && <p className="text-xs text-muted-foreground">Optional — introduce who's presenting or hosting.</p>}
              <div className="space-y-2">
                {form.speakers.map((sp, idx) => (
                  <div key={idx} className="space-y-2 rounded-xl border border-border bg-muted/20 p-3">
                    <div className="flex gap-2">
                      <input
                        value={sp.name}
                        onChange={(e) => updateSpeaker(idx, "name", e.target.value)}
                        placeholder="Speaker name"
                        className="flex-1 rounded-lg border border-border bg-card px-2.5 py-2 text-xs text-ink outline-none focus:border-primary"
                      />
                      <input
                        value={sp.role}
                        onChange={(e) => updateSpeaker(idx, "role", e.target.value)}
                        placeholder="Role / title"
                        className="flex-1 rounded-lg border border-border bg-card px-2.5 py-2 text-xs text-ink outline-none focus:border-primary"
                      />
                      <button type="button" onClick={() => removeSpeaker(idx)} className="shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-red-50 hover:text-red-600">
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                    <textarea
                      value={sp.bio}
                      onChange={(e) => updateSpeaker(idx, "bio", e.target.value)}
                      placeholder="Short bio (optional)"
                      rows={2}
                      className="w-full resize-none rounded-lg border border-border bg-card px-2.5 py-2 text-xs text-ink outline-none focus:border-primary"
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-6">
            <div className="space-y-6 rounded-2xl border border-border bg-card p-6">
              <div className="space-y-1.5">
                <label className="flex items-center gap-1.5 text-sm font-medium text-ink">
                  <Sparkles className="size-3.5" /> Highlights / What to expect
                </label>
                <ul className="space-y-1.5">
                  {form.highlights.map((h, idx) => (
                    <li key={idx} className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-2 text-sm text-ink">
                      {h}
                      <button type="button" onClick={() => removeHighlight(idx)}><X className="size-3.5 text-muted-foreground" /></button>
                    </li>
                  ))}
                </ul>
                <div className="flex gap-2">
                  <input
                    value={highlightInput}
                    onChange={(e) => setHighlightInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        addHighlight(highlightInput)
                        setHighlightInput("")
                      }
                    }}
                    placeholder="e.g. Live Q&A with industry experts"
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => { addHighlight(highlightInput); setHighlightInput("") }}
                    className="shrink-0 rounded-xl border border-border px-4 text-sm font-medium text-ink hover:bg-muted"
                  >
                    Add
                  </button>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-ink">Requirements / what to bring</label>
                <textarea
                  value={form.requirements}
                  onChange={(e) => update("requirements", e.target.value)}
                  placeholder="e.g. Laptop, student ID, comfortable shoes..."
                  rows={2}
                  className={`${inputClass} resize-none`}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-ink">Refund / cancellation policy</label>
                <textarea
                  value={form.refundPolicy}
                  onChange={(e) => update("refundPolicy", e.target.value)}
                  placeholder="e.g. Full refund up to 48 hours before the event."
                  rows={2}
                  className={`${inputClass} resize-none`}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="flex items-center gap-1.5 text-sm font-medium text-ink"><Mail className="size-3.5" /> Contact email</label>
                  <input
                    type="email"
                    value={form.contactEmail}
                    onChange={(e) => update("contactEmail", e.target.value)}
                    placeholder="hello@organizer.com"
                    className={inputClass}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="flex items-center gap-1.5 text-sm font-medium text-ink"><Phone className="size-3.5" /> Contact phone</label>
                  <input
                    value={form.contactPhone}
                    onChange={(e) => update("contactPhone", e.target.value)}
                    placeholder="+977 98XXXXXXXX"
                    className={inputClass}
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-ink">Website / more info link</label>
                <input
                  value={form.website}
                  onChange={(e) => update("website", e.target.value)}
                  placeholder="https://..."
                  className={inputClass}
                />
              </div>
            </div>

            {/* Live preview */}
            <div className="overflow-hidden rounded-2xl border border-border bg-card">
              <div className="border-b border-border px-6 py-3">
                <h3 className="text-sm font-semibold text-ink">Preview</h3>
                <p className="text-xs text-muted-foreground">This is roughly how attendees will see it.</p>
              </div>
              <div className="relative h-40 bg-primary/10">
                {form.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={form.imageUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.3),transparent_55%)]" />
                )}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/50 to-transparent p-4 text-white">
                  <div className="flex gap-2">
                    <span className="rounded-full bg-white/90 px-2.5 py-0.5 text-[11px] font-semibold text-ink">{form.category}</span>
                    <span className="rounded-full bg-black/30 px-2.5 py-0.5 text-[11px] font-medium">{form.type}</span>
                  </div>
                  <h4 className="font-display mt-1.5 text-lg font-bold">{form.title || "Untitled event"}</h4>
                </div>
              </div>
              <div className="space-y-3 p-6">
                <p className="text-sm text-muted-foreground">{form.description || "No description yet."}</p>
                {form.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {form.tags.map((t) => (
                      <span key={t} className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">{t}</span>
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-3 text-xs text-muted-foreground sm:grid-cols-4">
                  <div><span className="block font-semibold text-ink">Venue</span>{form.venue || "—"}</div>
                  <div><span className="block font-semibold text-ink">Capacity</span>{form.capacity}</div>
                  <div><span className="block font-semibold text-ink">Price</span>{Number(form.price) > 0 ? `Rs. ${form.price}` : "Free"}</div>
                  <div><span className="block font-semibold text-ink">Status</span>{form.status}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 pt-2">
          <button
            type="button"
            onClick={goBack}
            disabled={step === 1}
            className="flex items-center gap-1.5 rounded-xl border border-border px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
          >
            <ChevronLeft className="size-4" /> Back
          </button>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSaveDraft}
              disabled={isPending || imageBusy || !draftValid}
              title={!draftValid ? "Title (min 3 chars) required to save draft" : "Save as Draft"}
              className="rounded-xl border border-border bg-card px-4 py-2.5 text-sm font-medium text-ink hover:bg-muted disabled:opacity-50"
            >
              {isPending ? <Loader2 className="size-4 animate-spin" /> : "Save Draft"}
            </button>

            {step < 3 ? (
              <button
                type="button"
                onClick={goNext}
                disabled={!stepValid}
                title={!stepValid ? "Complete required fields to continue" : undefined}
                className="flex items-center gap-1.5 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-all hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-50"
              >
                Continue <ChevronRight className="size-4" />
              </button>
            ) : (
              <button
                type="button"
                onClick={handleSubmit}
                disabled={isPending || imageBusy || !step1Valid || !step2Valid}
                title={imageBusy ? "Image still processing" : undefined}
                className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-[0_8px_20px_-10px_rgba(91,76,245,0.8)] transition-all hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-60"
              >
                {isPending && <Loader2 className="size-4 animate-spin" />}
                {isPending ? "Saving…" : submitLabel}
              </button>
            )}
          </div>
        </div>
      </form>
    </div>
  )
}
