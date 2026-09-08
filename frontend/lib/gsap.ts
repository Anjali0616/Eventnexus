"use client"

// Lazy-load gsap + ScrollTrigger so the heavy animation chunk is code-split
// and not included in the initial bundle for pages that don't need it.
// Callers should use ensureGsapAsync() where possible; ensureGsap() remains
// sync for backward compat but returns null until the chunk loads.
let gsapInstance: any = null
let ScrollTriggerInstance: any = null
let registered = false
let loadingPromise: Promise<any> | null = null

function loadGsap(): Promise<any> {
  if (loadingPromise) return loadingPromise
  loadingPromise = Promise.all([import("gsap"), import("gsap/ScrollTrigger")]).then(([gsapMod, stMod]) => {
    const g = (gsapMod as any).default ?? (gsapMod as any).gsap ?? gsapMod
    const ST = (stMod as any).ScrollTrigger ?? (stMod as any).default ?? stMod
    g.registerPlugin(ST)
    gsapInstance = g
    ScrollTriggerInstance = ST
    registered = true
    return g
  })
  return loadingPromise
}

// Sync version – triggers load but returns null until ready.
// Existing callers that check for null will handle gracefully; new code
// should prefer the async version.
export function ensureGsap() {
  if (typeof window === "undefined") return null as any
  if (gsapInstance && registered) return gsapInstance
  void loadGsap()
  return gsapInstance
}

export function ensureGsapAsync(): Promise<any> {
  if (typeof window === "undefined") return Promise.resolve(null)
  if (gsapInstance && registered) return Promise.resolve(gsapInstance)
  return loadGsap()
}

export function prefersReducedMotion() {
  if (typeof window === "undefined") return false
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches
}

// Re-export for callers that imported { gsap, ScrollTrigger } directly –
// now lazily initialized; may be null until first ensureGsapAsync().
export { gsapInstance as gsap, ScrollTriggerInstance as ScrollTrigger }
