import Image from "next/image"
import { cn } from "@/lib/utils"

type LogoProps = {
  /**
   * Wrap the mark in a white pill so the dark "Event" wordmark stays legible on
   * dark surfaces (footer, gradient panels, drawers).
   */
  onDark?: boolean
  /** Tailwind height for the image; width auto-scales. Defaults to `h-8`. */
  className?: string
  /** Forward to next/image for above-the-fold placements (navbar, auth panel). */
  priority?: boolean
}

/**
 * Canonical EventNexus brand lockup. Renders the shared `/logo.png` wordmark so
 * every surface stays in sync — do not hand-roll the icon + text again.
 */
export function Logo({ onDark = false, className, priority = false }: LogoProps) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center",
        onDark && "rounded-lg bg-white px-2.5 py-1",
      )}
    >
      <Image
        src="/logo.png"
        alt="EventNexus"
        width={785}
        height={197}
        priority={priority}
        className={cn("h-8 w-auto", className)}
      />
    </span>
  )
}
