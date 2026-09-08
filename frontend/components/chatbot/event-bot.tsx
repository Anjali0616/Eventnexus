"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import {
  Plus,
  Sparkles,
  X,
  Send,
  MessageCircle,
  ChevronDown,
  Trash2,
  Eraser,
  Copy,
  Check,
  RotateCcw,
  ArrowDown,
} from "lucide-react"
import { ensureGsap, prefersReducedMotion } from "@/lib/gsap"
import { chatbotApi } from "@/lib/api/chatbot"
import {
  useChatbotStore,
  type ChatConversation,
  type ChatMsg,
} from "@/lib/stores/chatbot-store"

// Renders bot replies as markdown: bold, lists, tables and clickable event
// links. Internal links (/events/...) use Next Link so navigation keeps the
// SPA shell; anything external opens in a new tab.
const markdownComponents = {
  a: ({ href, children }: { href?: string; children?: React.ReactNode }) => {
    if (!href) return <span>{children}</span>
    if (/^(javascript|data|vbscript):/i.test(href)) return <span>{children}</span>
    if (href.startsWith("/")) {
      return (
        <Link href={href} className="font-medium text-primary underline underline-offset-2 hover:opacity-80">
          {children}
        </Link>
      )
    }
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-primary underline underline-offset-2 hover:opacity-80">
        {children}
      </a>
    )
  },
  table: ({ children }: { children?: React.ReactNode }) => (
    <div className="my-1.5 max-w-full overflow-x-auto rounded-lg border border-border">
      <table className="w-full min-w-full border-collapse text-left text-xs">{children}</table>
    </div>
  ),
  thead: ({ children }: { children?: React.ReactNode }) => (
    <thead className="bg-muted/70 text-secondary">{children}</thead>
  ),
  th: ({ children }: { children?: React.ReactNode }) => (
    <th className="border-b border-border px-2.5 py-1.5 font-semibold">{children}</th>
  ),
  td: ({ children }: { children?: React.ReactNode }) => (
    <td className="border-b border-border/60 px-2.5 py-1.5 align-top last:border-b-0">{children}</td>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-semibold text-ink">{children}</strong>,
  em: ({ children }: { children?: React.ReactNode }) => <em className="text-muted-foreground">{children}</em>,
  ul: ({ children }: { children?: React.ReactNode }) => <ul className="my-1 list-disc space-y-0.5 pl-4">{children}</ul>,
  ol: ({ children }: { children?: React.ReactNode }) => <ol className="my-1 list-decimal space-y-0.5 pl-4">{children}</ol>,
}

const formatTime = (ts: number) =>
  new Date(ts).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          // Clipboard API can fail (permissions, insecure context) — the
          // button just silently stays in its normal state rather than
          // showing a false "copied" confirmation.
        }
      }}
      aria-label="Copy message"
      className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-ink"
    >
      {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
      {copied ? "Copied" : "Copy"}
    </button>
  )
}

function BotBubble({
  text,
  timestamp,
  quickReplies,
  error,
  retryText,
  onQuickReply,
  onRetry,
}: {
  text: string
  timestamp: number
  quickReplies?: string[]
  error?: boolean
  retryText?: string
  onQuickReply?: (q: string) => void
  onRetry?: (text: string) => void
}) {
  return (
    <div className="bot-msg group flex flex-col items-start gap-1">
      <div
        className={`max-w-[90%] rounded-2xl rounded-bl-md border-l-2 px-3.5 py-2.5 text-sm leading-relaxed text-ink ${
          error ? "border-destructive bg-destructive/[0.06]" : "border-secondary bg-muted"
        }`}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
          {text}
        </ReactMarkdown>
      </div>
      <div className="flex items-center gap-2 px-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <span className="text-[10px] text-muted-foreground">{formatTime(timestamp)}</span>
        <CopyButton text={text} />
        {error && retryText && (
          <button
            onClick={() => onRetry?.(retryText)}
            className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] font-medium text-destructive transition-colors hover:bg-destructive/10"
          >
            <RotateCcw className="size-3" /> Retry
          </button>
        )}
      </div>
      {quickReplies && quickReplies.length > 0 && (
        <div className="flex max-w-[92%] flex-wrap gap-1.5">
          {quickReplies.map((q) => (
            <button
              key={q}
              onClick={() => onQuickReply?.(q)}
              className="rounded-full border border-primary/25 bg-primary/[0.06] px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/15"
            >
              {q}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function UserBubble({ text, timestamp }: { text: string; timestamp: number }) {
  return (
    <div className="bot-msg group flex flex-col items-end gap-1">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5 text-sm leading-relaxed text-primary-foreground">
        {text}
      </div>
      <span className="px-1 text-[10px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
        {formatTime(timestamp)}
      </span>
    </div>
  )
}

const timeAgo = (ts: number) => {
  const diff = Date.now() - ts
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return "just now"
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

// Header dropdown listing every saved conversation — the "advanced chat
// history": switch between past chats, start a new one, delete old ones or
// wipe the current conversation. Everything lives in the zustand store
// (persisted), so it all survives page navigation and reloads.
function ConversationMenu() {
  const [open, setOpen] = useState(false)
  const conversations = useChatbotStore((s) => s.conversations)
  const activeId = useChatbotStore((s) => s.activeId)
  const switchConversation = useChatbotStore((s) => s.switchConversation)
  const startNewConversation = useChatbotStore((s) => s.startNewConversation)
  const deleteConversation = useChatbotStore((s) => s.deleteConversation)
  const clearActiveConversation = useChatbotStore((s) => s.clearActiveConversation)

  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt)
  const active = conversations.find((c) => c.id === activeId)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Chat history"
        className="group flex items-center gap-1 rounded-lg px-1.5 py-1 transition-colors hover:bg-muted"
      >
        <div className="text-left">
          <div className="max-w-[150px] truncate font-display text-sm font-bold text-ink">
            {active?.title || "EventBot"}
          </div>
          <div className="text-[10px] text-muted-foreground">{conversations.length} conversation{conversations.length === 1 ? "" : "s"}</div>
        </div>
        <ChevronDown className={`size-3.5 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-10 mt-2 w-64 overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
          <button
            onClick={() => {
              startNewConversation()
              setOpen(false)
            }}
            className="flex w-full items-center gap-2 border-b border-border px-3 py-2.5 text-sm font-semibold text-primary transition-colors hover:bg-muted/60"
          >
            <Plus className="size-4" /> New chat
          </button>

          <div className="max-h-52 overflow-y-auto">
            {sorted.map((c) => (
              <div
                key={c.id}
                className={`group flex items-center gap-1 border-b border-border/60 last:border-b-0 ${
                  c.id === activeId ? "bg-primary/5" : ""
                }`}
              >
                <button
                  onClick={() => {
                    switchConversation(c.id)
                    setOpen(false)
                  }}
                  className="flex min-w-0 flex-1 items-center justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
                >
                  <span className="truncate text-sm font-medium text-ink">{c.title}</span>
                  <span className="shrink-0 text-[10px] text-muted-foreground">{timeAgo(c.updatedAt)}</span>
                </button>
                <button
                  onClick={() => deleteConversation(c.id)}
                  aria-label={`Delete ${c.title}`}
                  className="mr-1 shrink-0 rounded-md p-1.5 text-muted-foreground opacity-0 transition-all hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            ))}
          </div>

          {active && active.messages.length > 1 && (
            <button
              onClick={() => {
                clearActiveConversation()
                setOpen(false)
              }}
              className="flex w-full items-center gap-2 border-t border-border px-3 py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/60 hover:text-ink"
            >
              <Eraser className="size-4" /> Clear current chat
            </button>
          )}
        </div>
      )}
    </div>
  )
}

export function EventBot({
  eventId,
}: {
  // The event currently open (from AppShell reading the route), if any —
  // lets event-specific questions (capacity, venue, schedule, price,
  // registration status) resolve instead of always asking "which event?".
  eventId?: string
}) {
  const panel = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  // Pixel override for the panel — null falls back to the CSS defaults
  // (h-[min(620px,...)] w-[min(400px,...)]). w/h are split so one axis can
  // be dragged without touching the other.
  const [size, setSize] = useState<{ w: number | null; h: number | null }>({ w: null, h: null })
  const [resizing, setResizing] = useState<"w" | "h" | null>(null)
  const [showScrollButton, setShowScrollButton] = useState(false)

  const open = useChatbotStore((s) => s.open)
  const setOpen = useChatbotStore((s) => s.setOpen)
  const input = useChatbotStore((s) => s.input)
  const setInput = useChatbotStore((s) => s.setInput)
  const typing = useChatbotStore((s) => s.typing)
  const conversations = useChatbotStore((s) => s.conversations)
  const activeId = useChatbotStore((s) => s.activeId)
  const suggestions = useChatbotStore((s) => s.suggestions)
  const setSuggestions = useChatbotStore((s) => s.setSuggestions)
  const aiStatus = useChatbotStore((s) => s.aiStatus)
  const setAiStatus = useChatbotStore((s) => s.setAiStatus)
  const send = useChatbotStore((s) => s.send)

  const activeConversation: ChatConversation | undefined = conversations.find((c) => c.id === activeId)
  const messages: ChatMsg[] = activeConversation?.messages ?? []

  useEffect(() => {
    if (!open || prefersReducedMotion()) return
    const gsap = ensureGsap()
    const ctx = gsap.context((self) => {
      const q = self.selector!
      gsap.from(panel.current, { y: 24, scale: 0.96, opacity: 0, duration: 0.35, ease: "power3.out" })
      gsap.from(q(".bot-msg"), { y: 12, opacity: 0, stagger: 0.06, duration: 0.3, delay: 0.1 })
      gsap.to(q(".bot-orb"), { scale: 1.12, duration: 1.4, ease: "sine.inOut", repeat: -1, yoyo: true })
    }, panel)
    return () => ctx.revert()
  }, [open])

  // Only auto-scroll to the newest message when the user is already near
  // the bottom — otherwise a reply arriving while they've scrolled up to
  // re-read earlier context would yank the view away from what they're
  // reading. When they're not near the bottom, show the jump-to-latest
  // button instead.
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (nearBottom) {
      el.scrollTo({ top: el.scrollHeight, behavior: "smooth" })
      setShowScrollButton(false)
    } else if (messages.length) {
      setShowScrollButton(true)
    }
  }, [messages, typing, open])

  // Hide the jump-to-latest button once the user manually scrolls back down.
  useEffect(() => {
    const el = listRef.current
    if (!el || !open) return
    const onScroll = () => {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
      if (nearBottom) setShowScrollButton(false)
    }
    el.addEventListener("scroll", onScroll)
    return () => el.removeEventListener("scroll", onScroll)
  }, [open])

  // Escape closes the panel; autofocus the composer whenever it opens so
  // typing can start immediately without an extra click.
  useEffect(() => {
    if (!open) return
    textareaRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, setOpen])

  // Auto-grow the composer up to a cap so a long question doesn't shrink
  // the message list to nothing, then scrolls internally past that.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`
  }, [input])

  // Live AI model status (attendance / CF / intent) from the backend —
  // surfaces whether the trained Python models are serving or the app is in
  // deterministic fallback mode.
  useEffect(() => {
    if (!open || aiStatus !== null) return
    chatbotApi
      .health()
      .then(setAiStatus)
      .catch(() => setAiStatus({ online: false, attendance: false, cf: false, intent: false }))
  }, [open, aiStatus, setAiStatus])

  const lastSuggestFetch = useRef(0)
  // Refresh personalized suggestion chips when panel opens — cached 60s to avoid
  // hammering DB on every toggle (was previously fetched on *every* open with
  // no TTL, causing 3 DB queries per toggle).
  useEffect(() => {
    if (!open) return
    const now = Date.now()
    if (now - lastSuggestFetch.current < 60_000 && suggestions.length) return
    lastSuggestFetch.current = now
    chatbotApi
      .suggestions()
      .then(({ suggestions: s }) => {
        if (s?.length) setSuggestions(s)
      })
      .catch(() => {})
  }, [open, setSuggestions, suggestions.length])

  // Drag a panel edge to resize. The chat is anchored bottom-right, so the
  // free edges are left (width) and top (height). Bounds: usable minimum,
  // and the viewport minus the fixed 24px offsets (bottom-6/right-6) with
  // 24px of top clearance. Pointer events on window keep the drag smooth
  // even when the cursor outruns the handle.
  const startResize = (axis: "w" | "h") => (e: React.PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const el = panel.current
    if (!el) return
    const startX = e.clientX
    const startY = e.clientY
    const startW = el.offsetWidth
    const startH = el.offsetHeight
    const minW = 280
    const minH = 300
    const maxW = Math.max(minW, window.innerWidth - 32)
    const maxH = Math.max(minH, window.innerHeight - 48)

    setResizing(axis)
    document.body.style.cursor = axis === "w" ? "ew-resize" : "ns-resize"
    document.body.style.userSelect = "none"

    const onMove = (ev: PointerEvent) => {
      if (axis === "w") {
        const w = Math.min(maxW, Math.max(minW, startW + (startX - ev.clientX)))
        setSize((s) => ({ ...s, w }))
      } else {
        const h = Math.min(maxH, Math.max(minH, startH + (startY - ev.clientY)))
        setSize((s) => ({ ...s, h }))
      }
    }
    const onUp = () => {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
      setResizing(null)
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  const handleSend = useCallback(() => {
    if (!input.trim() || typing) return
    send(input, eventId)
  }, [input, typing, send, eventId])

  return (
    <>
      {/* Floating action button — hidden while the panel is open */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="bg-brand-gradient fixed bottom-6 right-6 z-50 flex size-14 items-center justify-center rounded-full text-white shadow-[0_12px_30px_-8px_rgba(91,76,245,0.6)] transition-transform hover:scale-105 active:scale-95"
          aria-label="Open EventBot AI assistant"
        >
          <MessageCircle className="size-6" />
        </button>
      )}

      {/* Floating chat window — bottom-right, no full-screen overlay */}
      {open && (
        <div
          ref={panel}
          role="dialog"
          aria-label="EventBot AI assistant"
          aria-modal="true"
          className={`group fixed bottom-6 right-6 z-50 flex h-[min(620px,calc(100dvh-3rem))] w-[min(400px,calc(100vw-1.5rem))] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl ${resizing ? "select-none" : ""}`}
          style={{ width: size.w ?? undefined, height: size.h ?? undefined }}
        >
          {/* Resize handles — left edge drags width, top edge drags height
              (bottom and right are the fixed anchors). */}
          <div
            onPointerDown={startResize("w")}
            aria-hidden
            className={`absolute -left-1 bottom-0 top-0 z-10 w-1.5 cursor-ew-resize touch-none transition-colors ${
              resizing === "w" ? "bg-primary/60" : "bg-transparent group-hover:bg-primary/30"
            }`}
          />
          <div
            onPointerDown={startResize("h")}
            aria-hidden
            className={`absolute -top-1 left-0 right-0 z-10 h-1.5 cursor-ns-resize touch-none transition-colors ${
              resizing === "h" ? "bg-primary/60" : "bg-transparent group-hover:bg-primary/30"
            }`}
          />
          {/* header */}
          <div className="flex items-center justify-between bg-muted/40 px-4 py-3">
            <div className="flex items-center gap-2.5">
              <span className="bot-orb bg-brand-gradient flex size-9 shrink-0 items-center justify-center rounded-full text-white">
                <Sparkles className="size-4" />
              </span>
              <ConversationMenu />
            </div>
            <div className="flex items-center gap-2">
              <div className="hidden items-center gap-1.5 text-[11px] text-secondary sm:flex">
                {aiStatus === null ? (
                  <>
                    <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground" /> Checking status…
                  </>
                ) : aiStatus.online ? (
                  aiStatus.attendance && aiStatus.cf && aiStatus.intent ? (
                    <>
                      <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" /> ML Models · Online
                    </>
                  ) : (
                    <>
                      <span className="size-1.5 animate-pulse rounded-full bg-amber-500" /> ML Models · Partial
                    </>
                  )
                ) : (
                  <>
                    <span className="size-1.5 animate-pulse rounded-full bg-amber-500" /> Fallback Mode
                  </>
                )}
              </div>
              <button
                onClick={() => setOpen(false)}
                className="flex size-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-ink"
                aria-label="Close chat"
              >
                <X className="size-4" />
              </button>
            </div>
          </div>

          {/* messages */}
          <div
            ref={listRef}
            role="log"
            aria-live="polite"
            aria-relevant="additions"
            className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
          >
            {messages.map((m, idx) =>
              m.from === "user" ? (
                <UserBubble key={m.id} text={m.text} timestamp={m.timestamp} />
              ) : (
                <BotBubble
                  key={m.id}
                  text={m.text}
                  timestamp={m.timestamp}
                  quickReplies={idx === messages.length - 1 ? m.quickReplies : undefined}
                  error={m.error}
                  retryText={m.retryText}
                  onQuickReply={(q) => send(q, eventId)}
                  onRetry={(t) => send(t, eventId)}
                />
              )
            )}
            {typing && (
              <div className="flex justify-start" aria-label="EventBot is typing">
                <div className="flex gap-1 rounded-2xl rounded-bl-md bg-muted px-4 py-3">
                  {[0, 1, 2].map((d) => (
                    <span
                      key={d}
                      className="size-1.5 animate-bounce rounded-full bg-muted-foreground"
                      style={{ animationDelay: `${d * 0.15}s` }}
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Jump-to-latest — appears once the user has scrolled up while
              more of the conversation is below the fold. Auto-scroll only
              fires on new messages when already near the bottom (see the
              scroll useEffect), so this is the way back without losing
              whatever the user scrolled up to read. */}
          {showScrollButton && (
            <button
              onClick={() => {
                listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" })
              }}
              aria-label="Scroll to latest message"
              className="absolute bottom-[104px] left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-ink shadow-lg transition-colors hover:bg-muted"
            >
              <ArrowDown className="size-3.5" /> New messages
            </button>
          )}

          {/* suggested options — shown until the first user message */}
          {messages.length <= 1 && (
            <div className="flex flex-wrap gap-2 px-4 pb-3">
              {(suggestions.length ? suggestions : []).map((s) => (
                <button
                  key={s}
                  onClick={() => send(s, eventId)}
                  disabled={typing}
                  className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium text-ink transition-colors hover:bg-muted disabled:opacity-60"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* input */}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              handleSend()
            }}
            className="flex items-end gap-2 border-t border-border px-3 py-3"
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends; Shift+Enter inserts a newline for a longer,
                // multi-line question instead of firing prematurely.
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault()
                  handleSend()
                }
              }}
              placeholder="Ask EventBot anything..."
              rows={1}
              className="max-h-[120px] min-h-[42px] flex-1 resize-none rounded-xl border border-border bg-background px-3.5 py-2.5 text-sm text-ink outline-none focus:border-primary focus:ring-4 focus:ring-primary/10"
            />
            <button
              type="submit"
              disabled={!input.trim() || typing}
              className="bg-brand-gradient flex size-10 shrink-0 items-center justify-center rounded-xl text-white transition-opacity disabled:opacity-50"
              aria-label="Send message"
            >
              <Send className="size-4" />
            </button>
          </form>
        </div>
      )}
    </>
  )
}
