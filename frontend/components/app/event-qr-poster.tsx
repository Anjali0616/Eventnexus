"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  QrCode as QrCodeIcon,
  Share2,
  Printer,
  Mail,
  MessageCircle,
  Eye,
  Sparkles,
  Ticket as TicketIcon,
  Calendar,
  MapPin,
  Tag,
  Wallet,
  Link2,
  Settings2,
  Hexagon,
  Loader2,
  Crown,
  Zap,
  Image as ImageIcon,
  Palette,
  Maximize2,
} from "lucide-react"
import { QrCodeCanvas, type QrLevel } from "@/components/app/qr-code"
import { useEvent } from "@/lib/queries/events"
import { useMyTickets, useRegisterForEvent } from "@/lib/queries/tickets"
import { useCurrentUser } from "@/lib/queries/auth"
import { formatPrice, isFreeEvent } from "@/lib/price"
import { buildPublicUrl, buildShareText, buildWhatsAppUrl, buildMailtoShare, downloadIcs, buildGoogleCalendarUrl } from "@/lib/qr"
import type { EventData } from "@/lib/api/events"
import type { Ticket } from "@/lib/api/tickets"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { toast } from "sonner"

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

export type PosterSize = "Small" | "Medium" | "Large" | "HD"
export type PosterStyle = "minimal" | "branded" | "poster"

const POSTER_SPECS: Record<
  PosterSize,
  { qrDisplay: number; w: number; h: number; label: string; short: string }
> = {
  Small: { qrDisplay: 160, w: 600, h: 850, label: "Small — 600×850", short: "S" },
  Medium: { qrDisplay: 200, w: 900, h: 1270, label: "Medium — 900×1270", short: "M" },
  Large: { qrDisplay: 264, w: 1200, h: 1600, label: "Large — 1200×1600", short: "L" },
  HD: { qrDisplay: 320, w: 1800, h: 2400, label: "HD Print — 1800×2400", short: "HD" },
}

const STYLE_META: Record<PosterStyle, { label: string; desc: string; icon: typeof Sparkles }> = {
  minimal: { label: "Minimal", desc: "Clean white", icon: Palette },
  branded: { label: "Branded", desc: "EventNexus gradient", icon: Crown },
  poster: { label: "Poster", desc: "Photo + details", icon: ImageIcon },
}

function slugify(title: string) {
  return title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "event"
}

// ---------------------------------------------------------------------------
// Canvas helpers (pure)
// ---------------------------------------------------------------------------

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  if (typeof (ctx as any).roundRect === "function") {
    ;(ctx as any).roundRect(x, y, w, h, r)
    return
  }
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number
): number {
  const words = text.split(/\s+/)
  let line = ""
  let curY = y
  for (let i = 0; i < words.length; i++) {
    const test = line ? line + " " + words[i] : words[i]
    const w = ctx.measureText(test).width
    if (w > maxWidth && line) {
      ctx.fillText(line, x, curY)
      line = words[i]
      curY += lineHeight
    } else {
      line = test
    }
  }
  if (line) {
    ctx.fillText(line, x, curY)
    curY += lineHeight
  }
  return curY
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.crossOrigin = "anonymous"
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = src
  })
}

// ---------------------------------------------------------------------------
// Props (backward compatible)
// ---------------------------------------------------------------------------

export interface EventQrPosterProps {
  eventId: string
  eventTitle: string
  /** Optional full event to avoid an extra fetch; falls back to useEvent(). */
  event?: EventData | null
  /** Optional pre-resolved ticket; otherwise resolved from useMyTickets(). */
  ticket?: Ticket | null
  /** Viewer role for CTA logic. When omitted, derived from useCurrentUser(). */
  role?: string
  /** Custom register handler. Defaults to mutation + toast. */
  onRegister?: () => void
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function EventQrPoster({
  eventId,
  eventTitle,
  event: eventProp,
  ticket: ticketProp,
  role: roleProp,
  onRegister,
}: EventQrPosterProps) {
  const router = useRouter()
  const qrCanvasRef = useRef<HTMLCanvasElement>(null)
  const ticketCanvasRef = useRef<HTMLCanvasElement>(null)
  const posterCanvasRef = useRef<HTMLCanvasElement>(null)

  const [activeTab, setActiveTab] = useState<"share" | "ticket">("share")
  const [posterSize, setPosterSize] = useState<PosterSize>("Medium")
  const [posterStyle, setPosterStyle] = useState<PosterStyle>("branded")
  const [level, setLevel] = useState<QrLevel>("M")
  const [includeLogo, setIncludeLogo] = useState(false)
  const [copied, setCopied] = useState(false)
  const [shareFeedback, setShareFeedback] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [posterDataUrl, setPosterDataUrl] = useState<string>("")
  const [isGenerating, setIsGenerating] = useState(false)

  const publicUrl = useMemo(() => {
    try {
      const origin = typeof window !== "undefined" ? window.location.origin : ""
      return buildPublicUrl(eventId, { baseUrl: origin || undefined, qrHint: true, withTracking: true })
    } catch {
      return typeof window !== "undefined" ? `${window.location.origin}/event/${eventId}` : `/event/${eventId}`
    }
  }, [eventId])

  // Data: prefer prop, else fetch. useEvent is safe to call even when prop present —
  // the extra fetch is cheap and keeps the poster usable as a standalone drop-in.
  const { data: eventData } = useEvent(eventId)
  const { data: ticketData } = useMyTickets({ limit: 100 })
  const { data: userData } = useCurrentUser()
  const registerMutation = useRegisterForEvent()

  const event: EventData | null = (eventProp as EventData | null) ?? eventData?.event ?? null
  // Show the same title that the parent page is rendering while the fetch settles,
  // so the poster doesn't flash "Event" for a frame.
  const displayTitle = event?.title ?? eventTitle
  const displayDate = event?.date ? new Date(event.date) : null
  const displayVenue = event?.venue ?? "Venue TBA"
  const displayCategory = event?.category ?? "Event"
  const displayPrice = event?.price ? formatPrice(event.price) : "Free"
  const displayOrganizer =
    event && typeof event.organizer === "object" && (event.organizer as any)?.name
      ? (event.organizer as any).name
      : "Organizer"

  const tickets = ticketData?.tickets ?? []
  const resolvedTicket: Ticket | null =
    (ticketProp as Ticket | null) ??
    (tickets.find((t) => {
      const ev = typeof t.event === "object" ? (t.event as any) : null
      return ev?._id === eventId
    }) as Ticket | undefined) ??
    null
  const isRegistered = !!resolvedTicket && resolvedTicket.status !== "cancelled"
  const ticketToken = resolvedTicket?.qrToken ?? ""
  const currentUser = userData?.user as any
  const isAttendee =
    roleProp === "Attendee" ||
    currentUser?.role === "attendee" ||
    currentUser?.role === "Attendee" ||
    // When no session yet, treat visitor as an attendee so the Register CTA still shows
    // inside the standalone public QR card — the actual registration still gates on auth.
    (!roleProp && !currentUser)

  const isPast = displayDate ? displayDate.getTime() <= Date.now() : false
  const isFull = event ? event.registered >= event.capacity : false
  const free = event ? isFreeEvent(event.price) : true

  // Keep tab in sync: if the user becomes registered, default to Share but allow Ticket.
  // Don't auto-switch away from ticket if they're inspecting it.
  useEffect(() => {
    if (!isRegistered && activeTab === "ticket") setActiveTab("share")
  }, [isRegistered, activeTab])

  const seedForQr = activeTab === "ticket" && isRegistered ? ticketToken : publicUrl
  const spec = POSTER_SPECS[posterSize]
  const qrDisplaySize = spec.qrDisplay

  // --- Actions ---------------------------------------------------------------

  const handleCopy = async (value: string = publicUrl) => {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      toast.success("Link copied")
      setTimeout(() => setCopied(false), 1800)
    } catch {
      toast.error("Copy failed")
    }
  }

  const handleDownloadQr = () => {
    const canvas = activeTab === "ticket" ? ticketCanvasRef.current : qrCanvasRef.current
    if (!canvas) {
      toast.error("QR not ready yet")
      return
    }
    const link = document.createElement("a")
    const suffix = activeTab === "ticket" ? "ticket-qr" : "event-qr"
    link.download = `${slugify(displayTitle)}-${suffix}-${posterStyle}-${posterSize.toLowerCase()}.png`
    link.href = canvas.toDataURL("image/png")
    link.click()
    toast.success("QR downloaded")
  }

  const renderPoster = useCallback(async (): Promise<string> => {
    const canvas = posterCanvasRef.current
    const qrCanvas = activeTab === "ticket" ? ticketCanvasRef.current : qrCanvasRef.current
    if (!canvas) throw new Error("Poster canvas not mounted")
    const { w, h, qrDisplay } = spec
    const dpr = 2
    // Size the backing store (physical pixels) separately from the CSS size.
    canvas.width = w * dpr
    canvas.height = h * dpr
    canvas.style.width = `${w}px`
    canvas.style.height = `${h}px`
    const ctx = canvas.getContext("2d")
    if (!ctx) throw new Error("2d context unavailable")
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // Background
    if (posterStyle === "poster") {
      ctx.fillStyle = "#ffffff"
      ctx.fillRect(0, 0, w, h)
      // Top media band — if event has an imageUrl, attempt to paint it; otherwise gradient.
      const bandH = 360
      if (event?.imageUrl) {
        try {
          const img = await loadImage(event.imageUrl)
          // Cover
          const scale = Math.max(w / img.width, bandH / img.height)
          const iw = img.width * scale
          const ih = img.height * scale
          const ix = (w - iw) / 2
          const iy = (bandH - ih) / 2
          ctx.save()
          roundRect(ctx, 0, 0, w, bandH, 0)
          ctx.clip()
          ctx.drawImage(img, ix, iy, iw, ih)
          // Darken for legibility
          ctx.fillStyle = "rgba(15, 10, 40, 0.42)"
          ctx.fillRect(0, 0, w, bandH)
          ctx.restore()
          // Title over image
          ctx.fillStyle = "#ffffff"
          ctx.font = "800 30px Inter, system-ui, -apple-system, sans-serif"
          const titleY = 42
          // Shadow for readability
          ctx.shadowColor = "rgba(0,0,0,0.35)"
          ctx.shadowBlur = 12
          wrapText(ctx, displayTitle, 28, titleY, w - 56, 34)
          ctx.shadowBlur = 0
          ctx.fillStyle = "rgba(255,255,255,0.9)"
          ctx.font = "600 12px Inter, system-ui, sans-serif"
          ctx.fillText(`${displayCategory}  •  ${displayOrganizer}`, 28, bandH - 18)
        } catch {
          // fallback to gradient if image fails CORS
          const g = ctx.createLinearGradient(0, 0, w, 0)
          g.addColorStop(0, "#5b4cf5")
          g.addColorStop(1, "#00c9a7")
          ctx.fillStyle = g
          ctx.fillRect(0, 0, w, bandH)
          ctx.fillStyle = "#ffffff"
          ctx.font = "800 30px Inter, system-ui, sans-serif"
          wrapText(ctx, displayTitle, 28, 42, w - 56, 34)
          ctx.fillStyle = "rgba(255,255,255,0.92)"
          ctx.font = "600 12px Inter, system-ui, sans-serif"
          ctx.fillText(`${displayCategory}  •  ${displayOrganizer}`, 28, bandH - 18)
        }
      } else {
        const g = ctx.createLinearGradient(0, 0, w, 0)
        g.addColorStop(0, "#5b4cf5")
        g.addColorStop(0.55, "#5b4cf5")
        g.addColorStop(1, "#00c9a7")
        ctx.fillStyle = g
        ctx.fillRect(0, 0, w, bandH)
        // Decorative radial highlight
        ctx.fillStyle = "rgba(255,255,255,0.14)"
        ctx.beginPath()
        ctx.arc(w - 80, 64, 160, 0, Math.PI * 2)
        ctx.fill()
        // Brand + title
        ctx.fillStyle = "#fff"
        ctx.font = "700 13px Inter, system-ui, sans-serif"
        ctx.fillText("EventNexus", 28, 34)
        ctx.font = "500 11px Inter, system-ui, sans-serif"
        ctx.fillStyle = "rgba(255,255,255,0.88)"
        ctx.fillText("Scan to view & register  •  eventnexus.app", 28, 54)
        ctx.fillStyle = "#ffffff"
        ctx.font = "800 32px Inter, system-ui, sans-serif"
        const after = wrapText(ctx, displayTitle, 28, 88, w - 56, 36)
        // Category pill under title
        const pillY = after + 8
        const pillText = displayCategory
        ctx.font = "700 11px Inter, system-ui, sans-serif"
        const pillW = ctx.measureText(pillText).width + 22
        ctx.fillStyle = "rgba(255,255,255,0.18)"
        roundRect(ctx, 28, pillY, pillW, 26, 13)
        ctx.fill()
        ctx.fillStyle = "#fff"
        ctx.fillText(pillText, 28 + 11, pillY + 17)
        // Organizer line
        ctx.fillStyle = "rgba(255,255,255,0.9)"
        ctx.font = "500 12px Inter, system-ui, sans-serif"
        ctx.fillText(`by ${displayOrganizer}`, 28, pillY + 48)
      }
    } else if (posterStyle === "branded") {
      ctx.fillStyle = "#ffffff"
      ctx.fillRect(0, 0, w, h)
      // Top gradient bar
      const g = ctx.createLinearGradient(0, 0, w, 0)
      g.addColorStop(0, "#5b4cf5")
      g.addColorStop(1, "#00c9a7")
      ctx.fillStyle = g
      ctx.fillRect(0, 0, w, 84)
      ctx.fillStyle = "#ffffff"
      ctx.font = "700 14px Inter, system-ui, sans-serif"
      ctx.fillText("EventNexus", 22, 30)
      ctx.font = "500 11px Inter, system-ui, sans-serif"
      ctx.fillStyle = "rgba(255,255,255,0.9)"
      ctx.fillText("eventnexus.app  •  Scan to open event", 22, 48)
      // Small hexagon mark top-right
      ctx.fillStyle = "rgba(255,255,255,0.16)"
      ctx.beginPath()
      ctx.arc(w - 32, 42, 22, 0, Math.PI * 2)
      ctx.fill()
      ctx.fillStyle = "#fff"
      ctx.font = "700 11px Inter, system-ui, sans-serif"
      ctx.textAlign = "center"
      ctx.fillText("EN", w - 32, 46)
      ctx.textAlign = "left"
    } else {
      // minimal
      ctx.fillStyle = "#ffffff"
      ctx.fillRect(0, 0, w, h)
      ctx.strokeStyle = "#e7e5df"
      ctx.lineWidth = 1
      ctx.strokeRect(0.5, 0.5, w - 1, h - 1)
      ctx.fillStyle = "#1a1a2e"
      ctx.font = "700 11px Inter, system-ui, sans-serif"
      ctx.fillStyle = "#6b7280"
      ctx.fillText("EVENTNEXUS  •  SCAN TO VIEW", 22, 28)
      ctx.strokeStyle = "#eef0ff"
      ctx.beginPath()
      ctx.moveTo(22, 36)
      ctx.lineTo(w - 22, 36)
      ctx.stroke()
    }

    // --- QR card (centered) ---
    const isPoster = posterStyle === "poster"
    const qrBandTop = isPoster ? 360 : posterStyle === "branded" ? 84 : 48
    // Compute available vertical space for QR
    const qrSize = qrDisplay + (posterSize === "HD" ? 40 : 0) // slightly larger on HD for print
    const cardPad = 18
    const cardW = qrSize + cardPad * 2
    const cardH = qrSize + cardPad * 2
    const cardX = (w - cardW) / 2
    // Vertically: center in the band below header, but nudge up so text below isn't cramped
    const belowHeaderH = h - qrBandTop - 200 // reserve for title/meta/footer
    const cardY = qrBandTop + Math.max(28, (belowHeaderH - cardH) / 2)

    // Card shadow
    ctx.fillStyle = "rgba(26,26,46,0.08)"
    roundRect(ctx, cardX + 2, cardY + 6, cardW, cardH, 22)
    ctx.fill()
    // Card fill
    ctx.fillStyle = "#ffffff"
    roundRect(ctx, cardX, cardY, cardW, cardH, 20)
    ctx.fill()
    ctx.strokeStyle = posterStyle === "minimal" ? "#e7e5df" : "#eef0ff"
    ctx.lineWidth = 1
    roundRect(ctx, cardX, cardY, cardW, cardH, 20)
    ctx.stroke()

    if (qrCanvas) {
      // Ensure sharpness: draw the source canvas stretched to qrSize with smoothing off for modules
      ctx.imageSmoothingEnabled = false
      ctx.drawImage(qrCanvas, cardX + cardPad, cardY + cardPad, qrSize, qrSize)
      ctx.imageSmoothingEnabled = true
    } else {
      ctx.fillStyle = "#eef0ff"
      ctx.fillRect(cardX + cardPad, cardY + cardPad, qrSize, qrSize)
      ctx.fillStyle = "#9aa0b5"
      ctx.font = "600 11px Inter, system-ui, sans-serif"
      ctx.textAlign = "center"
      ctx.fillText("QR unavailable", cardX + cardW / 2, cardY + cardH / 2)
      ctx.textAlign = "left"
    }

    // Captions below QR
    const capY = cardY + cardH + 28
    ctx.textAlign = "center"
    if (activeTab === "ticket" && isRegistered) {
      ctx.fillStyle = "#5b4cf5"
      ctx.font = "700 11px Inter, system-ui, sans-serif"
      ctx.fillText(`TICKET  #${resolvedTicket!._id.slice(-8).toUpperCase()}`, w / 2, capY)
      ctx.fillStyle = "#6b7280"
      ctx.font = "500 11px Inter, system-ui, sans-serif"
      ctx.fillText("Present this at check-in", w / 2, capY + 18)
      if (resolvedTicket!.status === "checked-in") {
        ctx.fillStyle = "#00c9a7"
        ctx.font = "700 10px Inter, system-ui, sans-serif"
        ctx.fillText("✓  CHECKED IN", w / 2, capY + 36)
      }
    } else {
      ctx.fillStyle = "#1a1a2e"
      ctx.font = "700 11px Inter, system-ui, sans-serif"
      ctx.fillText("SCAN WITH YOUR PHONE CAMERA", w / 2, capY)
      ctx.fillStyle = "#6b7280"
      ctx.font = "400 10px Inter, system-ui, sans-serif"
      ctx.fillText("Opens the public event page  •  No account required to scan", w / 2, capY + 18)
    }
    ctx.textAlign = "left"

    // --- Event identity block ---
    const blockY = capY + (activeTab === "ticket" ? 52 : 42)
    // Title
    ctx.fillStyle = "#1a1a2e"
    ctx.font = "800 24px Inter, system-ui, sans-serif"
    const titleBottom = wrapText(ctx, displayTitle, 28, blockY, w - 56, 28)

    // Meta row 1: date • venue
    let metaY = titleBottom + 14
    ctx.fillStyle = "#5b4cf5"
    ctx.font = "600 11px Inter, system-ui, sans-serif"
    const dateStr = displayDate
      ? displayDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) +
        "  •  " +
        displayDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
      : "Date TBA"
    // Venue
    ctx.fillStyle = "#6b7280"
    ctx.font = "500 11px Inter, system-ui, sans-serif"
    const metaLine = `${dateStr}     ${displayVenue}`
    // Use a single line with truncation if too long
    let metaDisplay = metaLine
    while (ctx.measureText(metaDisplay).width > w - 56 && metaDisplay.length > 40) {
      metaDisplay = metaDisplay.slice(0, -4) + "…"
    }
    ctx.fillText(metaDisplay, 28, metaY)
    metaY += 20

    // Meta row 2: category pill + price + capacity
    const priceText = displayPrice
    const capText = event ? `${event.registered}/${event.capacity} joined` : ""
    ctx.fillStyle = "#eef0ff"
    // Category pill
    ctx.font = "700 11px Inter, system-ui, sans-serif"
    const catW = ctx.measureText(displayCategory).width + 20
    roundRect(ctx, 28, metaY, catW, 24, 12)
    ctx.fill()
    ctx.fillStyle = "#5b4cf5"
    ctx.fillText(displayCategory, 28 + 10, metaY + 16)
    // Price
    let px = 28 + catW + 10
    ctx.fillStyle = isFreeEvent(event?.price) ? "#00c9a7" : "#1a1a2e"
    ctx.font = "800 13px Inter, system-ui, sans-serif"
    ctx.fillText(priceText, px, metaY + 16)
    px += ctx.measureText(priceText).width + 12
    if (capText) {
      ctx.fillStyle = "#6b7280"
      ctx.font = "500 11px Inter, system-ui, sans-serif"
      ctx.fillText(capText, px, metaY + 16)
    }

    // Organizer
    metaY += 34
    ctx.fillStyle = "#9aa0b5"
    ctx.font = "500 10px Inter, system-ui, sans-serif"
    ctx.fillText(`Hosted by ${displayOrganizer}`, 28, metaY)

    // Footer URL band
    const footerH = 56
    ctx.fillStyle = posterStyle === "minimal" ? "#f8f7f4" : "#1a1a2e"
    ctx.fillRect(0, h - footerH, w, footerH)
    ctx.fillStyle = posterStyle === "minimal" ? "#9aa0b5" : "rgba(255,255,255,0.72)"
    ctx.font = "600 10px JetBrains Mono, monospace"
    // Truncate URL if HD
    let urlText = publicUrl
    ctx.textAlign = "center"
    while (ctx.measureText(urlText).width > w - 48 && urlText.length > 24) {
      urlText = urlText.slice(0, -8) + "…"
    }
    ctx.fillText(urlText, w / 2, h - 26)
    ctx.fillStyle = posterStyle === "minimal" ? "#c8c5bd" : "rgba(255,255,255,0.42)"
    ctx.font = "500 9px Inter, system-ui, sans-serif"
    ctx.fillText("EventNexus  •  eventnexus.app", w / 2, h - 12)
    ctx.textAlign = "left"

    return canvas.toDataURL("image/png")
  }, [
    activeTab,
    displayCategory,
    displayDate,
    displayOrganizer,
    displayTitle,
    displayVenue,
    displayPrice,
    event,
    isRegistered,
    posterStyle,
    publicUrl,
    resolvedTicket,
    spec,
  ])

  const handleDownloadPoster = async () => {
    setIsGenerating(true)
    try {
      // Ensure QR has painted at current size/level — wait a frame.
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r as any)))
      const dataUrl = await renderPoster()
      setPosterDataUrl(dataUrl)
      const link = document.createElement("a")
      link.download = `${slugify(displayTitle)}-poster-${posterStyle}-${posterSize.toLowerCase()}.png`
      link.href = dataUrl
      link.click()
      toast.success("Poster downloaded")
    } catch (e: any) {
      toast.error(e?.message || "Couldn't render poster")
    } finally {
      setIsGenerating(false)
    }
  }

  const handlePreview = async () => {
    setIsGenerating(true)
    try {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r as any)))
      const dataUrl = await renderPoster()
      setPosterDataUrl(dataUrl)
      setPreviewOpen(true)
    } catch (e: any) {
      toast.error(e?.message || "Couldn't render preview")
    } finally {
      setIsGenerating(false)
    }
  }

  const handleNativeShare = async () => {
    const shareUrl = activeTab === "ticket" ? publicUrl : publicUrl // tickets are private — always share event
    const title = displayTitle
    const text = `Check out ${displayTitle} on EventNexus — ${displayCategory} at ${displayVenue}.`
    if (navigator.share) {
      try {
        // Try sharing the poster file when available (Chrome/Edge desktop + mobile)
        if (posterDataUrl && (navigator as any).canShare) {
          try {
            const res = await fetch(posterDataUrl)
            const blob = await res.blob()
            const file = new File([blob], `${slugify(displayTitle)}-poster.png`, { type: "image/png" })
            if ((navigator as any).canShare({ files: [file] })) {
              await navigator.share({ title, text, url: shareUrl, files: [file] } as any)
              return
            }
          } catch {}
        }
        await navigator.share({ title, text, url: shareUrl })
        return
      } catch (err: any) {
        if (err?.name === "AbortError") return
      }
    }
    await handleCopy(shareUrl)
    setShareFeedback(true)
    setTimeout(() => setShareFeedback(false), 1800)
  }

  const handleWhatsApp = () => {
    const text = encodeURIComponent(
      activeTab === "ticket"
        ? `My ticket for ${displayTitle} — ${publicUrl}`
        : `${displayTitle} — ${displayCategory} at ${displayVenue}. Join here: ${publicUrl}`
    )
    window.open(`https://wa.me/?text=${text}`, "_blank", "noopener,noreferrer")
  }

  const handleEmail = () => {
    const subject = encodeURIComponent(
      activeTab === "ticket" ? `My ticket — ${displayTitle}` : `You're invited: ${displayTitle}`
    )
    const body = encodeURIComponent(
      activeTab === "ticket"
        ? `My ticket for ${displayTitle}:\n${publicUrl}\n\nTicket #${resolvedTicket!._id.slice(-8).toUpperCase()} — present at check-in.`
        : `${displayTitle}\n${displayCategory} • ${displayVenue}\n${displayDate ? displayDate.toLocaleString() : ""}\n\nJoin here: ${publicUrl}\n\nHosted by ${displayOrganizer}${event ? ` • ${event.registered}/${event.capacity} joined • ${displayPrice}` : ""}`
    )
    window.location.href = `mailto:?subject=${subject}&body=${body}`
  }

  const handlePrint = async () => {
    try {
      setIsGenerating(true)
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r as any)))
      const dataUrl = await renderPoster()
      const w = window.open("", "_blank")
      if (!w) {
        toast.error("Pop-up blocked — allow pop-ups to print")
        return
      }
      w.document.write(
        `<!doctype html><title>${displayTitle} — Poster</title><style>html,body{margin:0;background:#f8f7f4;display:grid;place-items:center;min-height:100vh} img{max-width:92vw;max-height:92vh;box-shadow:0 20px 60px rgba(26,26,46,0.22);border-radius:16px} @media print{body{background:#fff} img{max-width:100%;max-height:100%;box-shadow:none;border-radius:0}}</style><img src="${dataUrl}" alt="Poster" onload="setTimeout(()=>{window.print();},300)" />`
      )
      w.document.close()
    } catch (e: any) {
      toast.error(e?.message || "Print failed")
    } finally {
      setIsGenerating(false)
    }
  }

  const handleRegister = () => {
    if (onRegister) {
      onRegister()
      return
    }
    if (!currentUser) {
      router.push(`/register?redirect=${encodeURIComponent(`/event/${eventId}`)}`)
      return
    }
    if (!event || isPast || isFull) return
    registerMutation.mutate(eventId, {
      onSuccess: () => setActiveTab("ticket"),
    })
  }

  // Keep hidden poster canvas in sync for instant preview (debounced)
  useEffect(() => {
    // Cheap preview debounce so toggling size/style doesn't hammer canvas.
    const id = setTimeout(() => {
      // fire-and-forget; errors are surfaced on explicit actions.
      renderPoster()
        .then((url) => setPosterDataUrl(url))
        .catch(() => {})
    }, 280)
    return () => clearTimeout(id)
  }, [renderPoster])

  const fgForStyle = posterStyle === "poster" ? "#1a1a2e" : "#1a1a2e"
  const bgForStyle = "#ffffff"

  const TicketBadge = () => {
    if (!isRegistered || !resolvedTicket) return null
    const st = resolvedTicket.status
    const label = st === "checked-in" ? "Checked in" : st === "cancelled" ? "Cancelled" : "Valid"
    const cls =
      st === "checked-in"
        ? "bg-secondary/15 text-secondary border-secondary/20"
        : st === "cancelled"
          ? "bg-destructive/10 text-destructive border-destructive/20"
          : "bg-primary/10 text-primary border-primary/20"
    return (
      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cls}`}>
        {label}
      </span>
    )
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-[0_2px_24px_rgba(0,0,0,0.04)]">
      {/* Header */}
      <div className="border-b border-border bg-muted/20 px-5 py-4 sm:px-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex gap-3">
            <span className="bg-brand-gradient hidden size-9 shrink-0 items-center justify-center rounded-xl text-white shadow sm:flex">
              <QrCodeIcon className="size-4" />
            </span>
            <div>
              <h2 className="flex items-center gap-1.5 font-display text-[15px] font-bold leading-none text-ink">
                <QrCodeIcon className="size-3.5 text-primary sm:hidden" />
                {activeTab === "ticket" ? "Your ticket" : "Public event QR"}
                {isRegistered && activeTab === "share" && (
                  <span className="hidden items-center gap-1 rounded-full bg-secondary/10 px-2 py-0.5 text-[10px] font-semibold text-secondary sm:inline-flex">
                    <Check className="size-3" /> You’re in
                  </span>
                )}
              </h2>
              <p className="mt-1 max-w-[52ch] text-xs leading-relaxed text-muted-foreground">
                {activeTab === "ticket"
                  ? `Ticket #${resolvedTicket!._id.slice(-8).toUpperCase()} for “${displayTitle}” — present this at check-in.`
                  : `Scan to open “${displayTitle}” on EventNexus. Visitors can register on the spot; anyone already registered sees their ticket instead.`}
              </p>
            </div>
          </div>
          <span className="hidden shrink-0 items-center gap-1 rounded-full bg-card px-2.5 py-1 text-[11px] font-medium text-muted-foreground shadow-sm ring-1 ring-border sm:inline-flex">
            <Link2 className="size-3" /> event/{eventId.slice(-6)}
          </span>
        </div>

        {/* Tabs when registered */}
        {isRegistered && (
          <div className="mt-4 inline-flex gap-1 rounded-xl bg-card p-1 ring-1 ring-border">
            <button
              onClick={() => setActiveTab("share")}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                activeTab === "share" ? "bg-ink text-white shadow" : "text-muted-foreground hover:text-ink"
              }`}
            >
              <Share2 className="size-3.5" /> Share event
            </button>
            <button
              onClick={() => setActiveTab("ticket")}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-all ${
                activeTab === "ticket" ? "bg-ink text-white shadow" : "text-muted-foreground hover:text-ink"
              }`}
            >
              <TicketIcon className="size-3.5" /> My ticket <TicketBadge />
            </button>
          </div>
        )}
      </div>

      <div className="grid gap-6 p-5 sm:p-6 lg:grid-cols-[1.05fr_1fr]">
        {/* Left: event detail card + QR */}
        <div className="space-y-4">
          {/* Event detail card (always visible — gives context before someone even scans) */}
          <div className="overflow-hidden rounded-2xl border border-border bg-muted/20">
            {event?.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={event.imageUrl} alt={displayTitle} className="h-28 w-full object-cover sm:h-32" />
            ) : (
              <div className="bg-brand-gradient relative h-28 w-full sm:h-32">
                <div className="absolute inset-0 bg-[radial-gradient(circle_at_80%_20%,rgba(255,255,255,0.26),transparent_55%)]" />
                <div className="absolute bottom-3 left-3 flex items-center gap-2">
                  <span className="rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-semibold text-ink">{displayCategory}</span>
                  <span className="hidden rounded-full bg-black/20 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur sm:inline-flex">
                    {event?.type ?? "In-person"}
                  </span>
                </div>
              </div>
            )}
            <div className="space-y-3 p-4">
              <div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">{displayCategory}</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{event?.type ?? "In-person"}</span>
                  {isPast && <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[11px] font-medium">Concluded</span>}
                  {isFull && !isPast && <span className="rounded-full bg-flame/10 px-2 py-0.5 text-[11px] font-semibold text-flame">Full</span>}
                </div>
                <h3 className="font-display mt-2 line-clamp-2 text-[15px] font-bold leading-snug text-ink">{displayTitle}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">by {displayOrganizer}</p>
              </div>

              <div className="grid grid-cols-3 gap-2 text-xs">
                <div className="rounded-xl bg-card px-2.5 py-2 ring-1 ring-border">
                  <Calendar className="size-3.5 text-primary" />
                  <div className="mt-1 font-semibold text-ink">
                    {displayDate ? displayDate.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "TBA"}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {displayDate ? displayDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }) : "—"}
                  </div>
                </div>
                <div className="rounded-xl bg-card px-2.5 py-2 ring-1 ring-border">
                  <MapPin className="size-3.5 text-primary" />
                  <div className="mt-1 truncate font-semibold text-ink" title={displayVenue}>
                    {displayVenue}
                  </div>
                  <div className="text-[11px] text-muted-foreground">Venue</div>
                </div>
                <div className="rounded-xl bg-card px-2.5 py-2 ring-1 ring-border">
                  <Wallet className="size-3.5 text-primary" />
                  <div className="mt-1 font-semibold text-ink">{displayPrice}</div>
                  <div className="text-[11px] text-muted-foreground">{free ? "No payment" : "Per ticket"}</div>
                </div>
              </div>

              {event?.description && (
                <p className="line-clamp-3 text-xs leading-relaxed text-muted-foreground">{event.description}</p>
              )}

              <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                {event && (
                  <>
                    <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-1 font-medium text-muted-foreground">
                      <Tag className="size-3" /> {event.registered}/{event.capacity}
                    </span>
                    {event.tags?.slice(0, 3).map((t) => (
                      <span key={t} className="rounded-full bg-card px-2 py-1 ring-1 ring-border">
                        {t}
                      </span>
                    ))}
                  </>
                )}
              </div>

              <div className="flex items-center gap-2 pt-2">
                <Link
                  href={publicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-ink px-3 py-2 text-xs font-semibold text-white transition hover:bg-ink/90"
                >
                  <ExternalLink className="size-3.5" /> View public page
                </Link>
                <button
                  onClick={() => handleCopy(publicUrl)}
                  className="inline-flex items-center gap-1 rounded-xl border border-border bg-card px-3 py-2 text-xs font-medium text-ink hover:bg-muted"
                  title="Copy link"
                >
                  {copied ? <Check className="size-3.5 text-secondary" /> : <Copy className="size-3.5" />}
                </button>
              </div>

              {publicUrl && (
                <div className="break-all rounded-xl bg-ink px-3 py-2 font-mono text-[11px] leading-relaxed text-white/90">
                  {publicUrl}
                </div>
              )}
            </div>
          </div>

          {/* Register CTA — prominent when attendee is not yet registered */}
          {activeTab === "share" && !isRegistered && isAttendee && (
            <div
              className={`rounded-2xl border p-4 ${
                isPast || isFull ? "border-border bg-muted/30" : "border-primary/20 bg-primary/[0.04]"
              }`}
            >
              <div className="flex items-start gap-3">
                <span className={`flex size-9 shrink-0 items-center justify-center rounded-xl ${isPast || isFull ? "bg-muted text-muted-foreground" : "bg-primary text-white"}`}>
                  {isPast ? <Calendar className="size-4" /> : isFull ? <Tag className="size-4" /> : <Zap className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-ink">
                    {isPast ? "This event has concluded" : isFull ? "Event is full" : free ? "Join this event — it's free" : `Secure your spot — ${displayPrice}`}
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {isPast
                      ? "Registration is closed. Browse other upcoming events."
                      : isFull
                        ? "All spots are taken. Check back for cancellations or explore similar events."
                        : "Scan the QR or use the button below — you'll get an instant ticket with a scannable QR for check-in."}
                  </p>
                  {!isPast && !isFull && (
                    <button
                      onClick={handleRegister}
                      disabled={registerMutation.isPending}
                      className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white shadow-[0_8px_20px_-10px_rgba(91,76,245,0.45)] transition hover:-translate-y-0.5 disabled:opacity-60 sm:w-auto"
                    >
                      {registerMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <TicketIcon className="size-4" />}
                      {registerMutation.isPending ? "Registering…" : free ? "Register now — Free" : `Register — ${displayPrice}`}
                    </button>
                  )}
                  {registerMutation.isError && (
                    <p className="mt-2 text-xs text-amber-600">
                      {(registerMutation.error as any)?.response?.data?.message || "Registration failed"}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Ticket status callout when on ticket tab */}
          {activeTab === "ticket" && isRegistered && resolvedTicket && (
            <div className="rounded-2xl border border-secondary/20 bg-secondary/[0.06] p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-secondary">
                <Sparkles className="size-3.5" /> You’re registered
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span>
                  Ticket #{resolvedTicket._id.slice(-8).toUpperCase()} • {resolvedTicket.status === "checked-in" ? "Checked in" : "Valid — present at door"}
                </span>
                <TicketBadge />
              </div>
              {resolvedTicket.status === "checked-in" && resolvedTicket.checkedInAt && (
                <p className="mt-1 text-[11px] text-muted-foreground">Checked in {new Date(resolvedTicket.checkedInAt).toLocaleString()}</p>
              )}
            </div>
          )}
        </div>

        {/* Right: QR stage + controls */}
        <div className="space-y-4">
          {/* QR stage */}
          <div
            className={`relative flex flex-col items-center gap-3 rounded-2xl border p-5 sm:p-6 ${
              posterStyle === "minimal"
                ? "border-border bg-white"
                : posterStyle === "poster"
                  ? "border-border bg-gradient-to-br from-muted/40 to-card"
                  : "border-primary/10 bg-gradient-to-br from-primary/[0.06] to-card"
            }`}
          >
            {posterStyle !== "minimal" && (
              <div className="bg-brand-gradient pointer-events-none absolute inset-x-0 top-0 h-1 rounded-t-2xl" />
            )}
            <div className="flex w-full items-center justify-between">
              <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                <Hexagon className="size-3 text-primary" /> {activeTab === "ticket" ? "Ticket QR" : "Event QR"}
              </span>
              <span className="rounded-full bg-card px-2 py-0.5 text-[11px] font-medium text-muted-foreground ring-1 ring-border">
                {level} • {posterSize}
              </span>
            </div>

            <div className="relative">
              {/* Soft brand glow behind QR on branded/poster styles */}
              {posterStyle !== "minimal" && (
                <div className="bg-brand-gradient absolute -inset-3 rounded-[28px] opacity-[0.08] blur-xl" aria-hidden />
              )}
              <div className="relative">
                {activeTab === "ticket" && isRegistered ? (
                  <QrCodeCanvas
                    ref={ticketCanvasRef}
                    seed={ticketToken}
                    size={qrDisplaySize}
                    level={level}
                    fgColor={fgForStyle}
                    bgColor={bgForStyle}
                    styleVariant={posterStyle === "minimal" ? "minimal" : "branded"}
                    bordered
                    logoUrl={includeLogo ? undefined : undefined}
                    includeMargin={false}
                    title={`Ticket ${resolvedTicket!._id.slice(-8)}`}
                  />
                ) : (
                  <QrCodeCanvas
                    ref={qrCanvasRef}
                    seed={publicUrl}
                    size={qrDisplaySize}
                    level={level}
                    fgColor={fgForStyle}
                    bgColor={bgForStyle}
                    styleVariant={posterStyle === "minimal" ? "minimal" : "branded"}
                    bordered
                    logoUrl={
                      includeLogo ? (typeof window !== "undefined" ? window.location.origin + "/favicon.ico" : undefined) : undefined
                    }
                    logoSize={Math.round(qrDisplaySize * 0.2)}
                    includeMargin={false}
                    title={displayTitle}
                  />
                )}
              </div>
            </div>

            <div className="text-center">
              <div className="font-mono text-[11px] font-medium text-muted-foreground">
                {activeTab === "ticket" && isRegistered
                  ? `Ticket #${resolvedTicket!._id.slice(-8).toUpperCase()}`
                  : publicUrl.replace(/^https?:\/\//, "")}
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {activeTab === "ticket" ? "Scan at check-in desk" : "Scan to open • Register on the spot"}
              </div>
            </div>

            {/* Quick stats row under QR when event data is present */}
            {event && activeTab === "share" && (
              <div className="grid w-full grid-cols-3 gap-2 pt-2 text-center text-xs">
                <div className="rounded-xl bg-card p-2 ring-1 ring-border">
                  <div className="font-bold text-ink">{event.registered}</div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Joined</div>
                </div>
                <div className="rounded-xl bg-card p-2 ring-1 ring-border">
                  <div className="font-bold text-ink">{Math.max(0, event.capacity - event.registered)}</div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Left</div>
                </div>
                <div className="rounded-xl bg-card p-2 ring-1 ring-border">
                  <div className="font-bold text-ink">{displayPrice}</div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground">Price</div>
                </div>
              </div>
            )}
          </div>

          {/* Controls: size + style + level */}
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-ink">
              <Settings2 className="size-3.5 text-primary" /> Customize
            </div>

            <div className="mt-3 space-y-4">
              <div>
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Size</span>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{POSTER_SPECS[posterSize].label}</span>
                </div>
                <div className="grid grid-cols-4 gap-1.5">
                  {(Object.keys(POSTER_SPECS) as PosterSize[]).map((s) => {
                    const active = posterSize === s
                    return (
                      <button
                        key={s}
                        onClick={() => setPosterSize(s)}
                        className={`rounded-xl border px-2 py-2 text-xs font-semibold transition-all ${
                          active ? "border-primary bg-primary text-white shadow" : "border-border bg-card text-ink hover:bg-muted"
                        }`}
                      >
                        <span className="block text-[11px] leading-none">{s}</span>
                        <span className={`mt-1 block font-mono text-[10px] ${active ? "text-white/80" : "text-muted-foreground"}`}>
                          {POSTER_SPECS[s].short}
                        </span>
                      </button>
                    )
                  })}
                </div>
                <p className="mt-1.5 text-[11px] text-muted-foreground">Controls QR + poster export resolution. HD is print-ready.</p>
              </div>

              <div>
                <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Style</div>
                <div className="grid grid-cols-3 gap-1.5">
                  {(Object.keys(STYLE_META) as PosterStyle[]).map((k) => {
                    const meta = STYLE_META[k]
                    const Icon = meta.icon
                    const active = posterStyle === k
                    return (
                      <button
                        key={k}
                        onClick={() => setPosterStyle(k)}
                        className={`flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-xs font-semibold transition-all ${
                          active ? "border-primary bg-primary text-white shadow" : "border-border bg-card text-ink hover:bg-muted"
                        }`}
                        title={meta.desc}
                      >
                        <Icon className={`size-4 ${active ? "text-white" : "text-primary"}`} />
                        <span className="leading-none">{meta.label}</span>
                        <span className={`text-[10px] font-normal leading-none ${active ? "text-white/80" : "text-muted-foreground"}`}>{meta.desc}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Error correction</span>
                  <select
                    value={level}
                    onChange={(e) => setLevel(e.target.value as QrLevel)}
                    className="w-full rounded-xl border border-border bg-card px-2.5 py-2 text-xs font-medium text-ink outline-none ring-primary/20 focus:ring-2"
                  >
                    <option value="L">L — Low</option>
                    <option value="M">M — Medium</option>
                    <option value="Q">Q — Quartile</option>
                    <option value="H">H — High</option>
                  </select>
                  <span className="text-[10px] text-muted-foreground">Use Q/H with logos or small print.</span>
                </label>
                <label className="flex flex-col justify-between rounded-xl border border-border bg-muted/20 px-3 py-2.5">
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Center logo</span>
                  <span className="mt-1 flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={includeLogo}
                      onChange={(e) => setIncludeLogo(e.target.checked)}
                      className="size-3.5 rounded border-border accent-primary"
                    />
                    <span className="font-medium text-ink">{includeLogo ? "On (H)" : "Off"}</span>
                  </span>
                  <span className="text-[10px] text-muted-foreground">Auto-bumps ECC to H</span>
                </label>
              </div>
            </div>
          </div>

          {/* Action bar */}
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => handleCopy(activeTab === "ticket" ? (ticketToken || publicUrl) : publicUrl)}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2.5 text-xs font-semibold text-ink hover:bg-muted"
              >
                {copied ? <Check className="size-3.5 text-secondary" /> : <Copy className="size-3.5" />}
                {copied ? "Copied" : "Copy link"}
              </button>
              <button
                onClick={handleDownloadQr}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2.5 text-xs font-semibold text-ink hover:bg-muted"
              >
                <Download className="size-3.5" /> Download QR
              </button>
              <button
                onClick={handleDownloadPoster}
                disabled={isGenerating}
                className="flex items-center justify-center gap-1.5 rounded-xl bg-ink px-3 py-2.5 text-xs font-semibold text-white shadow hover:bg-ink/90 disabled:opacity-60"
              >
                {isGenerating ? <Loader2 className="size-3.5 animate-spin" /> : <ImageIcon className="size-3.5" />}
                {isGenerating ? "Rendering…" : "Download poster"}
              </button>
              <button
                onClick={handlePreview}
                disabled={isGenerating}
                className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2.5 text-xs font-semibold text-ink hover:bg-muted disabled:opacity-60"
              >
                <Eye className="size-3.5" /> Preview
              </button>
            </div>

            <div className="grid grid-cols-4 gap-2">
              <button
                onClick={handleNativeShare}
                className="flex flex-col items-center justify-center gap-1 rounded-xl border border-border bg-card px-2 py-2.5 text-[11px] font-semibold text-ink hover:bg-muted"
              >
                <Share2 className="size-4 text-primary" /> Share
              </button>
              <button
                onClick={handleWhatsApp}
                className="flex flex-col items-center justify-center gap-1 rounded-xl border border-border bg-card px-2 py-2.5 text-[11px] font-semibold text-ink hover:bg-muted"
                title="Share via WhatsApp"
              >
                <MessageCircle className="size-4 text-[#25D366]" /> WhatsApp
              </button>
              <button
                onClick={handleEmail}
                className="flex flex-col items-center justify-center gap-1 rounded-xl border border-border bg-card px-2 py-2.5 text-[11px] font-semibold text-ink hover:bg-muted"
              >
                <Mail className="size-4 text-primary" /> Email
              </button>
              <button
                onClick={handlePrint}
                disabled={isGenerating}
                className="flex flex-col items-center justify-center gap-1 rounded-xl border border-border bg-card px-2 py-2.5 text-[11px] font-semibold text-ink hover:bg-muted disabled:opacity-60"
              >
                <Printer className="size-4" /> Print
              </button>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <Maximize2 className="size-3" /> {spec.w}×{spec.h}px • PNG
              </span>
              <a
                href={publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-primary hover:underline"
              >
                <ExternalLink className="size-3" /> Open public page
              </a>
            </div>
            {shareFeedback && <p className="text-center text-xs font-medium text-secondary">Link copied — share it anywhere</p>}
          </div>
        </div>
      </div>

      {/* Footer hint */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/20 px-5 py-3 text-[11px] text-muted-foreground sm:px-6">
        <span className="inline-flex items-center gap-1.5">
          <Sparkles className="size-3 text-primary" />
          Tip: Use HD + H for print. Branded poster is best for flyers and slides.
        </span>
        <span className="hidden items-center gap-1 font-mono sm:inline-flex">
          <Palette className="size-3" /> Minimal • Branded • Poster
        </span>
      </div>

      {/* Hidden composite canvas (offscreen export) */}
      <canvas ref={posterCanvasRef} className="pointer-events-none fixed -left-[9999px] -top-[9999px] opacity-0" aria-hidden width={900} height={1270} />

      {/* Preview dialog */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-[92vw] gap-0 overflow-hidden p-0 sm:max-w-[560px]">
          <DialogHeader className="px-6 pt-6">
            <DialogTitle className="flex items-center gap-2 font-display">
              <ImageIcon className="size-4 text-primary" /> Poster preview — {posterSize} • {STYLE_META[posterStyle].label}
            </DialogTitle>
            <DialogDescription className="text-xs leading-relaxed">
              {displayTitle} • {displayCategory} • {displayVenue} • {displayPrice}. Use Download to save the full-resolution PNG.
            </DialogDescription>
          </DialogHeader>

          <div className="max-h-[68vh] overflow-auto bg-muted/20 p-4 sm:p-6">
            {/* Poster image preview — rendered from canvas dataUrl for crisp scroll */}
            {posterDataUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={posterDataUrl}
                alt={`Poster for ${displayTitle}`}
                className="mx-auto w-full max-w-[420px] rounded-2xl border border-border bg-white shadow-[0_20px_60px_-24px_rgba(26,26,46,0.35)]"
              />
            ) : (
              <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-border bg-card p-10 text-center">
                <Loader2 className="size-6 animate-spin text-primary" />
                <span className="text-xs text-muted-foreground">Rendering preview…</span>
              </div>
            )}

            {/* Inline event detail card inside modal — doubles as “see detail and register” surface */}
            <div className="mx-auto mt-4 max-w-[420px] rounded-2xl border border-border bg-card p-4">
              <div className="flex gap-3">
                {event?.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={event.imageUrl} alt="" className="hidden size-16 shrink-0 rounded-xl object-cover sm:block" />
                ) : (
                  <div className="bg-brand-gradient hidden size-16 shrink-0 rounded-xl sm:block" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="font-display text-sm font-bold leading-tight text-ink">{displayTitle}</div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">{displayCategory}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{displayPrice}</span>
                  </div>
                  <div className="mt-2 space-y-1 text-[11px] leading-relaxed text-muted-foreground">
                    <span className="flex items-center gap-1.5">
                      <Calendar className="size-3" /> {displayDate ? displayDate.toLocaleString() : "Date TBA"}
                    </span>
                    <span className="flex items-center gap-1.5">
                      <MapPin className="size-3" /> {displayVenue}
                    </span>
                  </div>
                </div>
              </div>
              {!isRegistered && isAttendee && !isPast && !isFull && (
                <button
                  onClick={handleRegister}
                  disabled={registerMutation.isPending}
                  className="mt-3 inline-flex w-full items-center justify-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white disabled:opacity-60"
                >
                  {registerMutation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <TicketIcon className="size-3.5" />}
                  {registerMutation.isPending ? "Registering…" : free ? "Register now — Free" : `Register — ${displayPrice}`}
                </button>
              )}
              <Link
                href={publicUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-2 flex w-full items-center justify-center gap-1.5 rounded-xl border border-border bg-card py-2 text-xs font-medium text-ink hover:bg-muted"
              >
                <ExternalLink className="size-3.5" /> Open event page
              </Link>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 border-t border-border bg-card p-4">
            <button
              onClick={handleDownloadPoster}
              disabled={isGenerating}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-ink px-4 py-2.5 text-xs font-semibold text-white disabled:opacity-60 sm:flex-none"
            >
              <Download className="size-3.5" /> Download PNG
            </button>
            <button
              onClick={handleNativeShare}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-xs font-semibold text-ink hover:bg-muted sm:flex-none"
            >
              <Share2 className="size-3.5" /> Share
            </button>
            <button
              onClick={handlePrint}
              className="flex items-center justify-center gap-1.5 rounded-xl border border-border bg-card px-4 py-2.5 text-xs font-semibold text-ink hover:bg-muted"
            >
              <Printer className="size-3.5" /> Print
            </button>
            <button
              onClick={() => setPreviewOpen(false)}
              className="ml-auto rounded-xl bg-muted px-4 py-2.5 text-xs font-semibold text-ink hover:bg-muted/80"
            >
              Close
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Integration notes (for role-event-detail.tsx)
// ---------------------------------------------------------------------------
//
// The import path is unchanged — role-event-detail.tsx keeps:
//   import { EventQrPoster } from "@/components/app/event-qr-poster"
// and the minimal call still works verbatim:
//   <EventQrPoster eventId={eventId} eventTitle={event.title} />
//
// Enhanced usage (optional, no migration required):
//
//   <EventQrPoster
//     eventId={event._id}
//     eventTitle={event.title}
//     event={event}                // avoids refetch when the parent already has it
//     ticket={registeredTicket}      // avoids useMyTickets lookup — parent owns it
//     role={role}                  // "Attendee" | "Organizer" | "Administrator"
//     onRegister={() => registerMutation.mutate(eventId)}
//   />
//
// When embedded in RoleEventDetail, the poster will:
//  - fetch its own event via useEvent(eventId) only if `event` is omitted,
//  - resolve ticket state via useMyTickets({limit:100}) only if `ticket` is omitted,
//  - show the "Share Event" tab always, and a "My Ticket" tab auto-enabled when
//    the viewer already holds a valid ticket,
//  - render a prominent Register CTA for attendees who haven't joined yet,
//  - handle download high-res, copy link, native share (+ clipboard fallback),
//    WhatsApp, email, print, and HD poster composition entirely on the client
//    via an offscreen 2D canvas (no server round-trip or image proxy needed).
//
// QrCode / QrCodeCanvas upgrades are backward compatible — existing callers
// like role-event-detail's ticket QR and my-tickets/page.tsx keep working:
//   <QrCode seed={ticket.qrToken} size={120} />
//   <QrCodeCanvas ref={ref} seed={publicUrl} size={140} />
// but can now opt into:
//   <QrCode seed={url} size="lg" level="H" fgColor="#5b4cf5" logoUrl="/logo.png" bordered styleVariant="branded" />
//
