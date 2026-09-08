"use client"

import { forwardRef, useMemo } from "react"
import { QRCodeSVG as LibQRCodeSVG, QRCodeCanvas as LibQRCodeCanvas } from "qrcode.react"

// ---------------------------------------------------------------------------
// Types & presets
// ---------------------------------------------------------------------------

export type QrLevel = "L" | "M" | "Q" | "H"
export type QrSizeToken = number | "sm" | "md" | "lg" | "xl" | "2xl"

export const QR_SIZE_PRESETS = {
  sm: 84,
  md: 140,
  lg: 200,
  xl: 280,
  "2xl": 360,
} as const

export const QR_LEVEL_LABEL: Record<QrLevel, string> = {
  L: "L — Low (7%)",
  M: "M — Medium (15%)",
  Q: "Q — Quartile (25%)",
  H: "H — High (30%)",
}

export function resolveQrSize(token: QrSizeToken): number {
  if (typeof token === "number") return token
  return QR_SIZE_PRESETS[token] ?? QR_SIZE_PRESETS.md
}

// Shared visual options for both SVG and Canvas variants.
export interface QrBaseProps {
  /** Value to encode. Empty string renders a placeholder so layout doesn't jump. */
  seed: string
  /** Pixel size or preset token. */
  size?: QrSizeToken
  /** Error correction level. Use Q/H when a centered logo is overlaid. */
  level?: QrLevel
  /** Foreground (module) color. */
  fgColor?: string
  /** Background color. Supports transparent for overlay use. */
  bgColor?: string
  /** Optional centered logo overlay URL. Automatically bumps level to H if needed. */
  logoUrl?: string
  /** Logo side length in px. Defaults to ~22% of QR size. */
  logoSize?: number
  /** Logo white padding / excavation margin in px. */
  logoMargin?: number
  /** Whether to excavate (clear) modules under the logo. Defaults true when logoUrl set. */
  logoExcavate?: boolean
  /** Show a subtle border around the white QR card. */
  bordered?: boolean
  /** Deprecated — prefer marginSize. */
  includeMargin?: boolean
  /** Quiet-zone size in modules. 4 is spec, 0 is tight. */
  marginSize?: number
  /** Extra class for the outer wrapper. */
  className?: string
  /** Accessible title for the QR (<title> inside SVG / aria). */
  title?: string
  /** Minimum QR version clamp 1-40. */
  minVersion?: number
  /** Visual container style. */
  styleVariant?: "minimal" | "branded" | "inverted"
}

type QrSvgProps = QrBaseProps & React.SVGAttributes<SVGSVGElement>
type QrCanvasProps = QrBaseProps & React.CanvasHTMLAttributes<HTMLCanvasElement>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function useResolvedLevel(level: QrLevel | undefined, hasLogo: boolean): QrLevel {
  return useMemo(() => {
    if (!level) return hasLogo ? "H" : "M"
    // If a logo is present but caller asked for low correction, silently upgrade
    // so the QR remains scannable — otherwise the logo punches a hole that
    // low-ECC can't recover from.
    if (hasLogo && (level === "L" || level === "M")) return "H"
    return level
  }, [level, hasLogo])
}

function wrapperClasses(variant: QrBaseProps["styleVariant"], bordered: boolean | undefined, className: string | undefined) {
  const base = "inline-flex items-center justify-center rounded-xl p-2 shadow-sm"
  const variantCls =
    variant === "inverted"
      ? "bg-ink"
      : variant === "branded"
        ? "bg-white ring-1 ring-primary/10 shadow-[0_8px_24px_-12px_rgba(91,76,245,0.35)]"
        : "bg-white"
  const borderCls = bordered ? " border border-border" : ""
  return [base, variantCls, borderCls, className].filter(Boolean).join(" ")
}

// ---------------------------------------------------------------------------
// QrCode — SVG, crisp at any scale, ideal for UI display & print export via
// <svg> serialization. Not directly exportable as PNG without canvas path.
// ---------------------------------------------------------------------------

export function QrCode({
  seed,
  size = "md",
  level,
  fgColor = "#1a1a2e",
  bgColor = "#ffffff",
  logoUrl,
  logoSize,
  logoMargin = 4,
  logoExcavate,
  bordered,
  includeMargin = false,
  marginSize,
  className,
  title,
  minVersion,
  styleVariant = "minimal",
  ...rest
}: QrSvgProps) {
  const px = resolveQrSize(size as QrSizeToken)
  const hasLogo = !!logoUrl
  const resolvedLevel = useResolvedLevel(level, hasLogo)

  const imageSettings = hasLogo
    ? {
        src: logoUrl!,
        width: logoSize ?? Math.round(px * 0.22),
        height: logoSize ?? Math.round(px * 0.22),
        excavate: logoExcavate ?? true,
        // small white padding handled by excavate + margin; logoMargin could be used
        // to inset further but qrcode.react centers by default so we keep it simple.
      }
    : undefined

  // Inverted = dark bg, light modules
  const fg = styleVariant === "inverted" ? "#ffffff" : fgColor
  const bg = styleVariant === "inverted" ? "#1a1a2e" : bgColor

  // Safe fallback: render placeholder pattern when seed empty so UI doesn't collapse.
  const value = seed || "https://eventnexus.app"

  return (
    <div className={wrapperClasses(styleVariant, bordered, className)} style={{ background: bg }}>
      <LibQRCodeSVG
        value={value}
        size={px}
        level={resolvedLevel}
        bgColor={bg}
        fgColor={fg}
        includeMargin={includeMargin}
        marginSize={marginSize}
        title={title}
        minVersion={minVersion}
        imageSettings={imageSettings as any}
        {...rest}
      />
    </div>
  )
}

// ---------------------------------------------------------------------------
// QrCodeCanvas — canvas variant so callers can grab a ref and export PNG via
// canvas.toDataURL / toBlob. Supports identical props plus native canvas attrs.
// ---------------------------------------------------------------------------

export const QrCodeCanvas = forwardRef<HTMLCanvasElement, QrCanvasProps>(function QrCodeCanvasInner(
  {
    seed,
    size = "md",
    level,
    fgColor = "#1a1a2e",
    bgColor = "#ffffff",
    logoUrl,
    logoSize,
    logoMargin = 4,
    logoExcavate,
    bordered,
    includeMargin = false,
    marginSize,
    className,
    title,
    minVersion,
    styleVariant = "minimal",
    ...rest
  },
  ref
) {
  const px = resolveQrSize(size as QrSizeToken)
  const hasLogo = !!logoUrl
  const resolvedLevel = useResolvedLevel(level, hasLogo)

  const imageSettings = hasLogo
    ? {
        src: logoUrl!,
        width: logoSize ?? Math.round(px * 0.22),
        height: logoSize ?? Math.round(px * 0.22),
        excavate: logoExcavate ?? true,
      }
    : undefined

  const fg = styleVariant === "inverted" ? "#ffffff" : fgColor
  const bg = styleVariant === "inverted" ? "#1a1a2e" : bgColor
  const value = seed || "https://eventnexus.app"

  return (
    <div className={wrapperClasses(styleVariant, bordered, className)} style={{ background: bg }}>
      <LibQRCodeCanvas
        ref={ref}
        value={value}
        size={px}
        level={resolvedLevel}
        bgColor={bg}
        fgColor={fg}
        includeMargin={includeMargin}
        marginSize={marginSize}
        title={title}
        minVersion={minVersion}
        imageSettings={imageSettings as any}
        {...rest}
      />
    </div>
  )
})

// Small indirection so the forwardRef name doesn't shadow the imported symbol.
const QRCodeCanvasComponent = forwardRef<HTMLCanvasElement, any>(function Inner(props, ref) {
  return <LibQRCodeCanvas {...(props as any)} ref={ref} />
})

// ---------------------------------------------------------------------------
// Utilities for high-res export (used by the poster composer)
// ---------------------------------------------------------------------------

/**
 * Resolve a token to its effective pixel size at a given devicePixelRatio.
 * Useful when exporting poster-rate QR at 2-3x density.
 */
export function qrExportSize(token: QrSizeToken, dpr = 2): number {
  return resolveQrSize(token) * dpr
}

/**
 * Preset labels for UI selects.
 */
export const QR_SIZE_OPTIONS: { value: QrSizeToken; label: string; px: number }[] = [
  { value: "sm", label: "Small", px: QR_SIZE_PRESETS.sm },
  { value: "md", label: "Medium", px: QR_SIZE_PRESETS.md },
  { value: "lg", label: "Large", px: QR_SIZE_PRESETS.lg },
  { value: "xl", label: "XL", px: QR_SIZE_PRESETS.xl },
  { value: "2xl", label: "2XL (print)", px: QR_SIZE_PRESETS["2xl"] },
]
