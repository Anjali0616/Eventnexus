"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import {
  Camera,
  Copy,
  Check,
  ExternalLink,
  Flashlight,
  FlashlightOff,
  FlipHorizontal,
  Link2,
  Loader2,
  ScanLine,
  Ticket,
  Upload,
  Volume2,
  VolumeX,
  X,
  ZoomIn,
  ZoomOut,
  AlertCircle,
  Calendar,
} from "lucide-react"

// ─────────────────────────────────────────────────────────────
// Public props — MUST stay stable. Existing callers on
// /organizer/tickets pass exactly { onScan, active, onClose }.
// New optional props are additive and default to advanced behavior.
// ─────────────────────────────────────────────────────────────
interface QrScannerProps {
  onScan: (decodedText: string) => void
  active: boolean
  onClose: () => void
  /** Called when an event URL is detected instead of onScan. Defaults to router.push. */
  onEventDetected?: (eventId: string, raw: string) => void
  /** Called when a generic http(s) URL is detected. */
  onUrlDetected?: (url: string) => void
  /** Beep via WebAudio on successful decode. Default true. */
  enableBeep?: boolean
  /** Haptics via navigator.vibrate on successful decode. Default true. */
  enableVibration?: boolean
}

// ─────────────────────────────────────────────────────────────
// Classification
// ─────────────────────────────────────────────────────────────
export type ScanContentType = "ticket_jwt" | "event_url" | "url" | "text"

export interface ClassifiedScan {
  type: ScanContentType
  raw: string
  eventId?: string
  url?: string
  jwtPayload?: Record<string, unknown> | null
}

const JWT_RE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/
const EVENT_PATH_RE = /\/event\/([a-f0-9]{24})(?:[/?#]|$)/i
// also catches raw "/event/<id>" without origin
const RELATIVE_EVENT_RE = /^\/event\/[a-f0-9]{24}/i

function tryDecodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split(".")
    if (parts.length !== 3) return null
    const payload = parts[1]
    // base64url → base64
    const b64 = payload.replace(/-/g, "+").replace(/_/g, "/")
    const pad = b64.length % 4
    const padded = pad ? b64 + "=".repeat(4 - pad) : b64
    const json = atob(padded)
    const parsed = JSON.parse(json)
    if (typeof parsed === "object" && parsed !== null) return parsed as Record<string, unknown>
    return null
  } catch {
    return null
  }
}

function isTicketJwt(raw: string): { match: boolean; payload: Record<string, unknown> | null } {
  const trimmed = raw.trim()
  if (!JWT_RE.test(trimmed)) return { match: false, payload: null }
  const payload = tryDecodeJwtPayload(trimmed)
  if (!payload) return { match: false, payload: null }
  // EventNexus ticket tokens always contain these three ids. A plain
  // 3-segment string that is not a ticket JWT will be treated as text.
  const hasKeys = "ticketId" in payload && "eventId" in payload && "attendeeId" in payload
  return { match: hasKeys, payload }
}

function extractEventId(raw: string): string | null {
  const trimmed = raw.trim()
  // Direct relative path
  const rel = trimmed.match(/^\/event\/([a-f0-9]{24})/i)
  if (rel) return rel[1]
  // Absolute or protocol-relative URL
  try {
    // Handles both "https://x/event/<id>" and "x/event/<id>" by forcing a base
    const url = new URL(trimmed, typeof window !== "undefined" ? window.location.origin : "http://localhost")
    const m = url.pathname.match(EVENT_PATH_RE)
    if (m) return m[1]
  } catch {}
  // Fallback: raw contains /event/<id> anywhere (covers qrcode that encodes "eventnexus.com/event/<id>" without scheme)
  const fallback = trimmed.match(EVENT_PATH_RE)
  if (fallback) return fallback[1]
  return null
}

export function classifyScanContent(raw: string): ClassifiedScan {
  const trimmed = raw.trim()
  if (!trimmed) return { type: "text", raw: trimmed }

  // 1) Ticket JWT — highest priority
  const ticket = isTicketJwt(trimmed)
  if (ticket.match) {
    return { type: "ticket_jwt", raw: trimmed, jwtPayload: ticket.payload }
  }

  // 2) Event URL
  const eventId = extractEventId(trimmed)
  if (eventId) {
    return { type: "event_url", raw: trimmed, eventId }
  }

  // 3) Generic URL
  const looksLikeUrl = /^https?:\/\//i.test(trimmed) || /^www\./i.test(trimmed)
  if (looksLikeUrl) {
    let url = trimmed
    if (/^www\./i.test(url)) url = `https://${url}`
    try {
      // Validate
      new URL(url)
      return { type: "url", raw: trimmed, url }
    } catch {}
  }
  // Also treat bare "eventnexus.com/..." or similar host+path as URL
  // (qrcodes sometimes omit scheme). Detect if it parses with a forced scheme.
  try {
    const forced = new URL(`https://${trimmed}`)
    if (forced.hostname.includes(".") && forced.hostname.length > 3) {
      // Avoid false positives on random text with dots — require at least one slash or typical TLD
      if (trimmed.includes("/") || /\.[a-z]{2,}$/i.test(trimmed)) {
        return { type: "url", raw: trimmed, url: `https://${trimmed}` }
      }
    }
  } catch {}

  return { type: "text", raw: trimmed }
}

// ─────────────────────────────────────────────────────────────
// Sound + haptics (gated behind user gesture / secure context)
// ─────────────────────────────────────────────────────────────
function playSuccessBeep(volume = 0.22) {
  try {
    const Ctx = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext })
      .AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = "sine"
    osc.frequency.value = 880 // A5, crisp but not harsh
    gain.gain.value = volume
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    // Quick two-tone chirp: 880Hz → 1320Hz for perceived "success"
    osc.frequency.linearRampToValueAtTime(1320, ctx.currentTime + 0.08)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22)
    osc.stop(ctx.currentTime + 0.24)
    setTimeout(() => ctx.close().catch(() => {}), 400)
  } catch {}
}

function vibrate(pattern: number | number[]) {
  try {
    if ("vibrate" in navigator) navigator.vibrate(pattern)
  } catch {}
}

// ─────────────────────────────────────────────────────────────
// Helpers to reach the underlying <video> + MediaStreamTrack
// (html5-qrcode mounts a <video> inside our container div)
// ─────────────────────────────────────────────────────────────
function getVideoTrack(containerId: string): MediaStreamTrack | null {
  try {
    const container = document.getElementById(containerId)
    if (!container) return null
    const video = container.querySelector("video") as HTMLVideoElement | null
    if (!video) return null
    const stream = video.srcObject as MediaStream | null
    if (!stream) return null
    return stream.getVideoTracks()[0] ?? null
  } catch {
    return null
  }
}

function supportsTorch(track: MediaStreamTrack): boolean {
  try {
    const caps = (track.getCapabilities as unknown as () => Record<string, unknown>)?.() as
      | Record<string, unknown>
      | undefined
    if (!caps) return false
    return "torch" in caps
  } catch {
    return false
  }
}

function getZoomCapabilities(track: MediaStreamTrack): { min: number; max: number; step: number } | null {
  try {
    const caps = (track.getCapabilities as unknown as () => Record<string, unknown>)?.() as
      | Record<string, unknown>
      | undefined
    if (!caps || !("zoom" in caps)) return null
    const z = caps.zoom as { min: number; max: number; step: number }
    if (typeof z?.min !== "number" || typeof z?.max !== "number") return null
    return z
  } catch {
    return null
  }
}

// ─────────────────────────────────────────────────────────────
// Component
// ─────────────────────────────────────────────────────────────
export function QrScanner({
  onScan,
  active,
  onClose,
  onEventDetected,
  onUrlDetected,
  enableBeep = true,
  enableVibration = true,
}: QrScannerProps) {
  const router = useRouter()
  const containerId = useRef(`qr-scanner-${Math.random().toString(36).slice(2, 9)}`)
  const scannerRef = useRef<unknown>(null)
  const onScanRef = useRef(onScan)
  onScanRef.current = onScan
  const onEventRef = useRef(onEventDetected)
  onEventRef.current = onEventDetected
  const onUrlRef = useRef(onUrlDetected)
  onUrlRef.current = onUrlDetected

  const lastDecodedAt = useRef(0)
  const lastDecodedText = useRef<string | null>(null)

  const [error, setError] = useState<string | null>(null)
  const [isStarting, setIsStarting] = useState(false)
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment")
  const [torchOn, setTorchOn] = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [zoomCaps, setZoomCaps] = useState<{ min: number; max: number; step: number } | null>(null)
  const [availableCameras, setAvailableCameras] = useState<{ id: string; label: string }[]>([])
  const [selectedCameraId, setSelectedCameraId] = useState<string | null>(null)
  const [classified, setClassified] = useState<ClassifiedScan | null>(null)
  const [muted, setMuted] = useState(false)
  const [copied, setCopied] = useState(false)
  const [fileScanning, setFileScanning] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Keep derived behavior readable for future maintainers: classification
  // is intentionally inside the component, not delegated to the parent,
  // so any consumer (organizer verify, admin, future kiosk) gets smart
  // detection without re-implementing branching.
  const handleDecoded = useCallback(
    (decodedText: string) => {
      const now = Date.now()
      // Deduplicate: same payload within 1.6s is ignored (html5-qrcode fires every frame otherwise)
      const isDuplicate = decodedText === lastDecodedText.current && now - lastDecodedAt.current < 1600
      if (isDuplicate) return
      lastDecodedAt.current = now
      lastDecodedText.current = decodedText

      const result = classifyScanContent(decodedText)
      setClassified(result)

      if (!muted) {
        if (enableBeep) playSuccessBeep()
        if (enableVibration) vibrate(result.type === "ticket_jwt" ? [70, 30, 90] : 80)
      }

      // Ticket JWT — always forward to parent's verify flow (organizer check-in)
      if (result.type === "ticket_jwt") {
        onScanRef.current(decodedText)
        return
      }

      // Event URL — prefer explicit handler, otherwise navigate
      if (result.type === "event_url" && result.eventId) {
        if (onEventRef.current) {
          onEventRef.current(result.eventId, decodedText)
        } else {
          router.push(`/event/${result.eventId}`)
        }
        return
      }

      // Generic URL — expose to parent if provided; otherwise just surface preview
      if (result.type === "url" && result.url) {
        if (onUrlRef.current) onUrlRef.current(result.url)
        return
      }

      // Plain text — surface in preview, don't auto-navigate; parent can still
      // read `classified` if it wires an observer, or rely on manual copy.
    },
    [enableBeep, enableVibration, muted, router]
  )

  // Torch toggle — reach into the live MediaStreamTrack
  const toggleTorch = useCallback(async () => {
    const track = getVideoTrack(containerId.current)
    if (!track) return
    const next = !torchOn
    try {
      // `torch` is part of the advanced constraints; type is not in lib.dom yet
      await (track as unknown as { applyConstraints: (c: unknown) => Promise<void> }).applyConstraints({
        advanced: [{ torch: next }],
      })
      setTorchOn(next)
    } catch {
      // Silently ignore; some devices expose the capability but reject the constraint
    }
  }, [torchOn])

  const applyZoom = useCallback(
    async (next: number) => {
      const track = getVideoTrack(containerId.current)
      if (!track) return
      try {
        await (track as unknown as { applyConstraints: (c: unknown) => Promise<void> }).applyConstraints({
          advanced: [{ zoom: next }],
        })
        setZoom(next)
      } catch {}
    },
    []
  )

  const switchCamera = useCallback(() => {
    // If we have enumerated deviceIds, cycle through them; otherwise flip facingMode
    if (availableCameras.length > 1 && selectedCameraId) {
      const idx = availableCameras.findIndex((c) => c.id === selectedCameraId)
      const next = availableCameras[(idx + 1) % availableCameras.length]
      setSelectedCameraId(next.id)
      setFacingMode(next.label.toLowerCase().includes("front") ? "user" : "environment")
      setTorchOn(false)
      return
    }
    setFacingMode((prev) => (prev === "environment" ? "user" : "environment"))
    setTorchOn(false)
  }, [availableCameras, selectedCameraId])

  const copyRaw = useCallback(async () => {
    if (!classified?.raw) return
    try {
      await navigator.clipboard.writeText(classified.raw)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {}
  }, [classified])

  const handleOpenExternal = useCallback(() => {
    if (!classified) return
    let href: string | null = null
    if (classified.type === "event_url" && classified.eventId) href = `/event/${classified.eventId}`
    else if (classified.type === "url" && classified.url) href = classified.url
    if (!href) return
    if (href.startsWith("/")) router.push(href)
    else window.open(href, "_blank", "noopener,noreferrer")
  }, [classified, router])

  const handleFilePick = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (!file) return
      setFileScanning(true)
      setError(null)
      try {
        const { Html5Qrcode } = await import("html5-qrcode")
        // Use a throwaway instance for file scanning so the live camera stays untouched
        const tempId = `qr-file-${Math.random().toString(36).slice(2, 7)}`
        const holder = document.createElement("div")
        holder.id = tempId
        holder.style.display = "none"
        document.body.appendChild(holder)
        const tempScanner = new Html5Qrcode(tempId)
        const decoded = await tempScanner.scanFile(file, true)
        holder.remove()
        try { tempScanner.clear() } catch {}
        handleDecoded(decoded)
      } catch {
        setError("Couldn't read a QR code from that image. Try a clearer photo.")
      } finally {
        setFileScanning(false)
        if (fileInputRef.current) fileInputRef.current.value = ""
      }
    },
    [handleDecoded]
  )

  // Enumerate cameras once when scanner becomes active (helps flip + selector)
  useEffect(() => {
    if (!active) return
    let cancelled = false
    import("html5-qrcode")
      .then(({ Html5Qrcode }) =>
        (Html5Qrcode.getCameras as unknown as () => Promise<{ id: string; label: string }[]>)()
          .then((cameras) => {
            if (cancelled) return
            if (Array.isArray(cameras) && cameras.length) {
              setAvailableCameras(cameras)
              // Default to back camera if we can identify it
              const back =
                cameras.find((c) => /back|rear|environment/i.test(c.label)) ?? cameras[0]
              setSelectedCameraId(back.id)
            }
          })
          .catch(() => {})
      )
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [active])

  // Start / restart camera
  useEffect(() => {
    if (!active) return
    let cancelled = false
    setError(null)
    setIsStarting(true)

    import("html5-qrcode")
      .then(({ Html5Qrcode }) => {
        if (cancelled) return
        const scanner: any = new (Html5Qrcode as any)(containerId.current, {
          verbose: false,
          experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        })
        scannerRef.current = scanner as unknown

        // Prefer explicit deviceId when we have it — more reliable than facingMode
        // on desktops with multiple cameras. Fall back to facingMode constraint.
        const cameraConfig: unknown = selectedCameraId
          ? selectedCameraId
          : { facingMode }

        scanner
          .start(
            cameraConfig as never,
            {
              fps: 12,
              qrbox: (w: number, h: number) => {
                // Responsive scan box: 78% of the smaller viewport dimension, capped
                const size = Math.floor(Math.min(w, h) * 0.78)
                const clamped = Math.max(220, Math.min(320, size))
                return { width: clamped, height: clamped }
              },
              aspectRatio: 1.0,
              disableFlip: false,
            } as never,
            (decodedText: string) => handleDecoded(decodedText),
            () => {
              // per-frame "not found" — ignore
            }
          )
          .then(() => {
            if (cancelled) return
            setIsStarting(false)
            // Probe capabilities after the stream is live
            setTimeout(() => {
              const track = getVideoTrack(containerId.current)
              if (!track) return
              setTorchSupported(supportsTorch(track))
              const zc = getZoomCapabilities(track)
              setZoomCaps(zc)
              if (zc) {
                try {
                  const settings = (track.getSettings as unknown as () => Record<string, unknown>)?.() as
                    | Record<string, unknown>
                    | undefined
                  if (settings && typeof (settings as { zoom?: unknown }).zoom === "number") {
                    setZoom((settings as { zoom: number }).zoom)
                  }
                } catch {}
              }
            }, 500)
          })
          .catch((err: unknown) => {
            if (cancelled) return
            setIsStarting(false)
            const msg = (err as { message?: string })?.message ?? ""
            if (/permission|notallowed|denied/i.test(msg)) {
              setError("Camera permission denied. Allow access in your browser settings, or paste the token below.")
            } else if (/notfound|no camera|overconstrained/i.test(msg)) {
              setError("No camera found. Use file upload or paste the token manually.")
            } else {
              setError("Couldn't start the camera. Check permissions, or use file upload / manual entry below.")
            }
          })
      })
      .catch(() => {
        if (!cancelled) {
          setIsStarting(false)
          setError("Scanner failed to load. Refresh the page or use manual entry.")
        }
      })

    return () => {
      cancelled = true
      const scanner = scannerRef.current as unknown as {
        stop?: () => Promise<void>
        clear?: () => Promise<void> | void
      } | null
      if (scanner?.stop) {
        scanner
          .stop()
          .then(() => {
            try {
              scanner.clear?.()
            } catch {}
          })
          .catch(() => {})
      } else if (scanner?.clear) {
        try {
          scanner.clear()
        } catch {}
      }
      scannerRef.current = null
    }
  }, [active, facingMode, selectedCameraId, handleDecoded])

  // Reset transient UI when closed
  useEffect(() => {
    if (!active) {
      setClassified(null)
      setTorchOn(false)
      setError(null)
      setIsStarting(false)
      lastDecodedAt.current = 0
      lastDecodedText.current = null
    }
  }, [active])

  if (!active) return null

  const preview = classified
  const previewLabel =
    preview?.type === "ticket_jwt"
      ? "Ticket"
      : preview?.type === "event_url"
        ? "Event"
        : preview?.type === "url"
          ? "Link"
          : preview
            ? "Text"
            : null
  const previewAccent =
    preview?.type === "ticket_jwt"
      ? "bg-secondary/15 text-secondary border-secondary/20"
      : preview?.type === "event_url"
        ? "bg-primary/10 text-primary border-primary/15"
        : preview?.type === "url"
          ? "bg-flame/10 text-flame border-flame/15"
          : "bg-muted text-muted-foreground border-border"

  return (
    <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      {/* Header */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Camera className="size-4" />
          </span>
          Scan ticket QR
          {facingMode === "user" && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-700">Front</span>}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setMuted((v) => !v)}
            title={muted ? "Sound off — tap to enable beep + vibration" : "Sound on"}
            className={`rounded-lg p-1.5 transition-colors ${muted ? "bg-muted text-muted-foreground" : "text-primary hover:bg-primary/10"}`}
            aria-label={muted ? "Enable sound" : "Mute sound"}
          >
            {muted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-ink"
            aria-label="Close scanner"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      {/* Viewfinder */}
      <div className="relative overflow-hidden rounded-xl border border-border bg-black">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <div
          id={containerId.current}
          className="mx-auto w-full max-w-sm overflow-hidden [&_video]:w-full [&_video]:object-cover"
          style={facingMode === "user" ? { transform: "scaleX(-1)" } : undefined}
        />

        {/* Overlay chrome — hidden until video is live to avoid covering error states */}
        {!error && (
          <div className="pointer-events-none absolute inset-0">
            {/* Vignette */}
            <div className="absolute inset-0 bg-gradient-to-b from-black/15 via-transparent to-black/20" />
            {/* Corner brackets — classic viewfinder cues */}
            <div className="absolute left-1/2 top-1/2 size-[72%] max-h-[320px] max-w-[320px] -translate-x-1/2 -translate-y-1/2">
              <span className="absolute left-0 top-0 size-7 rounded-tl-xl border-l-[3px] border-t-[3px] border-white drop-shadow" />
              <span className="absolute right-0 top-0 size-7 rounded-tr-xl border-r-[3px] border-t-[3px] border-white drop-shadow" />
              <span className="absolute bottom-0 left-0 size-7 rounded-bl-xl border-b-[3px] border-l-[3px] border-white drop-shadow" />
              <span className="absolute bottom-0 right-0 size-7 rounded-br-xl border-b-[3px] border-r-[3px] border-white drop-shadow" />
              {/* Scanning line */}
              <span className="absolute left-2 right-2 top-1/2 h-px -translate-y-1/2 bg-white/80 shadow-[0_0_12px_rgba(255,255,255,0.9)] animate-[scan_1.8s_ease-in-out_infinite]" />
              <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-black/55 px-2.5 py-1 text-[10px] font-semibold tracking-wide text-white backdrop-blur">
                Align QR inside frame
              </span>
            </div>
          </div>
        )}

        {isStarting && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/70 text-white backdrop-blur-sm">
            <Loader2 className="size-6 animate-spin" />
            <span className="text-xs font-medium">Starting camera…</span>
            <span className="text-[11px] text-white/70">Allow permission if prompted</span>
          </div>
        )}

        {error && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/75 p-6 text-center backdrop-blur-sm">
            <span className="flex size-10 items-center justify-center rounded-full bg-white/15 text-white">
              <AlertCircle className="size-5" />
            </span>
            <p className="max-w-[28ch] text-sm font-medium leading-snug text-white">{error}</p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setError(null)
                  setIsStarting(true)
                  // Nudge the effect to restart: flip a throwaway state
                  setFacingMode((m) => m)
                }}
                className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-ink hover:bg-white/90"
              >
                Retry camera
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/25"
              >
                Upload image
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={switchCamera}
          title={availableCameras.length > 1 ? `Switch camera (${availableCameras.length} available)` : "Switch front / back camera"}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold text-ink hover:bg-muted"
        >
          <FlipHorizontal className="size-3.5" /> {availableCameras.length > 1 ? "Switch camera" : facingMode === "environment" ? "Front camera" : "Back camera"}
        </button>

        <button
          type="button"
          onClick={toggleTorch}
          disabled={!torchSupported}
          title={torchSupported ? (torchOn ? "Turn torch off" : "Turn torch on") : "Torch not supported on this device"}
          className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
            !torchSupported
              ? "cursor-not-allowed border-border bg-muted text-muted-foreground opacity-60"
              : torchOn
                ? "border-amber-500/30 bg-amber-500 text-white"
                : "border-border bg-background text-ink hover:bg-muted"
          }`}
        >
          {torchOn ? <Flashlight className="size-3.5" /> : <FlashlightOff className="size-3.5" />} {torchOn ? "Torch on" : "Torch"}
        </button>

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={fileScanning}
          className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-background px-3 py-2 text-xs font-semibold text-ink hover:bg-muted disabled:opacity-60"
        >
          {fileScanning ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />} Upload image
        </button>

        <input ref={fileInputRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={handleFilePick} />
      </div>

      {/* Zoom — only when hardware exposes it */}
      {zoomCaps && (
        <div className="mt-3 flex items-center gap-3 rounded-xl border border-border bg-muted/40 px-3 py-2.5">
          <ZoomOut className="size-3.5 shrink-0 text-muted-foreground" />
          <input
            type="range"
            min={zoomCaps.min}
            max={zoomCaps.max}
            step={zoomCaps.step || 0.1}
            value={zoom}
            onChange={(e) => applyZoom(Number(e.target.value))}
            className="h-1 flex-1 accent-primary"
            aria-label="Zoom"
          />
          <ZoomIn className="size-3.5 shrink-0 text-muted-foreground" />
          <span className="min-w-[3.5ch] text-center text-xs font-semibold text-ink">{zoom.toFixed(1)}×</span>
        </div>
      )}

      {availableCameras.length > 1 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {availableCameras.map((cam) => (
            <button
              key={cam.id}
              type="button"
              onClick={() => {
                setSelectedCameraId(cam.id)
                setFacingMode(cam.label.toLowerCase().includes("front") ? "user" : "environment")
              }}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                cam.id === selectedCameraId
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-background text-muted-foreground hover:text-ink"
              }`}
            >
              {cam.label || `Camera ${cam.id.slice(0, 6)}`}
            </button>
          ))}
        </div>
      )}

      {/* Detection preview — the "advanced and user-friendly" heart */}
      {preview ? (
        <div className={`mt-3 rounded-xl border p-3.5 ${previewAccent}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="flex size-8 items-center justify-center rounded-lg bg-white text-ink shadow-sm">
                {preview.type === "ticket_jwt" ? (
                  <Ticket className="size-4 text-secondary" />
                ) : preview.type === "event_url" ? (
                  <Calendar className="size-4 text-primary" />
                ) : preview.type === "url" ? (
                  <Link2 className="size-4 text-flame" />
                ) : (
                  <ScanLine className="size-4 text-muted-foreground" />
                )}
              </span>
              <div>
                <div className="flex items-center gap-1.5">
                  <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-bold tracking-wide text-ink shadow-sm">
                    {previewLabel}
                  </span>
                  {preview.type === "ticket_jwt" && (
                    <span className="text-[11px] font-medium text-ink/70">Valid ticket token</span>
                  )}
                  {preview.type === "event_url" && (
                    <span className="text-[11px] font-medium text-ink/70">Event link detected</span>
                  )}
                </div>
                <p className="mt-1 max-w-[32ch] break-all text-xs font-medium leading-snug text-ink/80">
                  {preview.type === "ticket_jwt"
                    ? `Ticket ${String((preview.jwtPayload?.ticketId as string) ?? "").slice(-8).toUpperCase() || "••••••••"}`
                    : preview.type === "event_url"
                      ? `Event ${preview.eventId?.slice(-6).toUpperCase()}`
                      : preview.raw.length > 64
                        ? `${preview.raw.slice(0, 64)}…`
                        : preview.raw}
                </p>
                {preview.type === "ticket_jwt" && Boolean(preview.jwtPayload?.eventId) && (
                  <p className="text-[11px] text-ink/60">Event {String(preview.jwtPayload!.eventId as string).slice(-8).toUpperCase()}</p>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={copyRaw}
              className="flex shrink-0 items-center gap-1 rounded-lg border border-black/10 bg-white px-2 py-1 text-[11px] font-semibold text-ink hover:bg-white/90"
            >
              {copied ? <Check className="size-3 text-secondary" /> : <Copy className="size-3" />} {copied ? "Copied" : "Copy"}
            </button>
          </div>

          {/* Truncated raw for ticket JWTs — staff can verify last chars */}
          {preview.type === "ticket_jwt" && (
            <p className="mt-2 break-all rounded-lg bg-white/70 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-ink/70">
              {`•••••${preview.raw.slice(-28)}`}
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            {preview.type === "ticket_jwt" && (
              <span className="flex items-center gap-1.5 rounded-lg bg-secondary px-3 py-2 text-xs font-semibold text-white">
                <Check className="size-3.5" /> Ready to verify — see result below
              </span>
            )}
            {preview.type === "event_url" && (
              <button
                type="button"
                onClick={handleOpenExternal}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
              >
                <ExternalLink className="size-3.5" /> Open event &amp; Register
              </button>
            )}
            {preview.type === "url" && (
              <>
                <button
                  type="button"
                  onClick={handleOpenExternal}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-ink px-3.5 py-2 text-xs font-semibold text-white hover:bg-ink/90"
                >
                  <ExternalLink className="size-3.5" /> Open link
                </button>
                <span className="inline-flex items-center rounded-xl border border-amber-500/30 bg-amber-50 px-2.5 py-1 text-[11px] font-medium text-amber-800">
                  External — verify before opening
                </span>
              </>
            )}
            {preview.type === "text" && (
              <span className="text-[11px] font-medium text-muted-foreground">
                Not a ticket or event link — copied for manual lookup.
              </span>
            )}
          </div>

          {preview.type === "ticket_jwt" && (
            <p className="mt-2 text-[11px] leading-relaxed text-ink/60">
              This QR encodes a signed JWT ticket. Verification is performed server-side against the
              ticket's organization and live status — a forged or cross-org token will be rejected.
            </p>
          )}
        </div>
      ) : (
        <p className="mt-3 flex items-center justify-center gap-1.5 rounded-xl bg-muted/50 px-3 py-2 text-center text-xs text-muted-foreground">
          <ScanLine className="size-3.5" /> Point the camera at a ticket QR, event poster, or link — detection is automatic
        </p>
      )}

      <p className="mt-2 text-center text-[11px] text-muted-foreground">
        Tip: on desktops with multiple cameras, pick the right device above. Torch and zoom appear only on supported devices.
      </p>

      <style>{`@keyframes scan{0%,100%{transform:translateY(-14px)}50%{transform:translateY(14px)}}`}</style>
    </div>
  )
}
