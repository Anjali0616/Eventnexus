"use client"

import { create } from "zustand"
import { persist, createJSONStorage, type StateStorage } from "zustand/middleware"
import { chatbotApi, type ChatMessage } from "@/lib/api/chatbot"
import { USER_KEY } from "@/lib/api/client"

// Chatbot state lives here (not inside the EventBot component) so the
// conversation survives page switches: AppShell unmounts and remounts per
// route, which used to wipe messages + backend context on every navigation.
// Conversations are persisted to localStorage, so history also survives
// full reloads — with multiple conversations to switch between, clear, or
// delete.

export type ChatFrom = "bot" | "user"

export interface ChatMsg {
  id: string
  from: ChatFrom
  text: string
  timestamp: number
  // Context-aware follow-up chips (from the backend) that the bot message
  // renders as tappable quick replies, persisted so switching conversations
  // brings the chips back with the message they belonged to.
  quickReplies?: string[]
  // Set on the "couldn't reach the server" bubble so the UI can offer a
  // Retry button that resends the exact user text that failed.
  error?: boolean
  retryText?: string
}

export interface ChatConversation {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  messages: ChatMsg[]
  // role/content pairs kept in sync with messages — sent to the backend so
  // follow-ups ("and its price?") resolve in conversation context.
  context: ChatMessage[]
}

export interface AiStatus {
  online: boolean
  attendance: boolean
  cf: boolean
  intent: boolean
}

const seedMsg = (): ChatMsg => ({
  id: uid(),
  from: "bot",
  text: "Hi, I'm EventBot 👋 — I can recommend events, check tickets, pricing, capacity and more. Try a suggestion below!",
  timestamp: Date.now(),
})

// The backend only consumes the last ~8 turns per query; keeping ~20 on the
// conversation keeps enough for multi-turn follow-ups without unbounded
// growth in localStorage.
const MAX_CONTEXT = 20
const MAX_STORED_CONVERSATIONS = 20

const uid = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`

// Whichever account is currently logged in (or "anon" when signed out) —
// read FRESH on every storage call, never cached, so a login/logout swap
// is picked up immediately rather than a stale id lingering in a closure.
const getCurrentUserId = (): string => {
  if (typeof window === "undefined") return "anon"
  try {
    const raw = localStorage.getItem(USER_KEY)
    const parsed = raw ? JSON.parse(raw) : null
    return parsed?._id || "anon"
  } catch {
    return "anon"
  }
}

// Namespaces the persisted localStorage key by the logged-in user. Without
// this, a single fixed key ("eventnexus-chatbot") means every account that
// ever uses this browser reads and writes the SAME conversation history —
// log out, a different person logs in, and they see the previous person's
// entire chat. Each user's history now lives under its own key
// ("eventnexus-chatbot:<their id>"), and callers must trigger a rehydrate
// (see resetChatbotForUserChange below) after login/logout so the running
// store re-reads from the newly-correct key instead of keeping whatever
// was loaded for whoever was signed in when the page first loaded.
const userScopedStorage: StateStorage = {
  getItem: (name) => localStorage.getItem(`${name}:${getCurrentUserId()}`),
  setItem: (name, value) => localStorage.setItem(`${name}:${getCurrentUserId()}`, value),
  removeItem: (name) => localStorage.removeItem(`${name}:${getCurrentUserId()}`),
}

export function newConversation(): ChatConversation {
  return {
    id: uid(),
    title: "New chat",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    messages: [seedMsg()],
    context: [],
  }
}

interface ChatbotState {
  open: boolean
  conversations: ChatConversation[]
  activeId: string
  input: string
  typing: boolean
  suggestions: string[]
  aiStatus: AiStatus | null

  setOpen: (open: boolean) => void
  setInput: (value: string) => void
  setTyping: (value: boolean) => void
  setAiStatus: (status: AiStatus | null) => void
  setSuggestions: (suggestions: string[]) => void
  startNewConversation: () => void
  switchConversation: (id: string) => void
  deleteConversation: (id: string) => void
  clearActiveConversation: () => void
  send: (text: string, eventId?: string) => Promise<void>
  pushBotMessage: (text: string) => void
}

export const useChatbotStore = create<ChatbotState>()(
  persist(
    (set, get) => ({
      open: false,
      conversations: [newConversation()],
      activeId: "",
      input: "",
      typing: false,
      suggestions: [],
      aiStatus: null,

      setOpen: (open) => set({ open }),
      setInput: (input) => set({ input }),
      setTyping: (typing) => set({ typing }),
      setAiStatus: (aiStatus) => set({ aiStatus }),
      setSuggestions: (suggestions) => set({ suggestions }),

      startNewConversation: () => {
        const conversation = newConversation()
        set((s) => ({
          conversations: [conversation, ...s.conversations].slice(0, MAX_STORED_CONVERSATIONS),
          activeId: conversation.id,
          input: "",
        }))
      },

      switchConversation: (id) => {
        if (get().conversations.some((c) => c.id === id)) set({ activeId: id })
      },

      deleteConversation: (id) => {
        set((s) => {
          const rest = s.conversations.filter((c) => c.id !== id)
          if (!rest.length) {
            const fresh = newConversation()
            return { conversations: [fresh], activeId: fresh.id, input: "" }
          }
          return { conversations: rest, activeId: s.activeId === id ? rest[0].id : s.activeId }
        })
      },

      clearActiveConversation: () => {
        const fresh = newConversation()
        set((s) => ({
          conversations: s.conversations.map((c) =>
            c.id === s.activeId ? fresh : c
          ),
          input: "",
        }))
      },

      // Programmatic bot reply (wizard results, system events): appends a
      // message and keeps the conversation context in sync, exactly as a
      // regular assistant turn would.
      pushBotMessage: (text) => {
        const { conversations, activeId } = get()
        const active = conversations.find((c) => c.id === activeId)
        if (!active) return
        set({
          conversations: conversations.map((c) =>
            c.id === activeId
              ? {
                  ...c,
                  messages: [...c.messages, { id: uid(), from: "bot" as const, text, timestamp: Date.now() }],
                  context: [...c.context, { role: "assistant" as const, content: text }].slice(-MAX_CONTEXT),
                  updatedAt: Date.now(),
                }
              : c
          ),
        })
      },

      send: async (text, eventId) => {
        const { typing, conversations, activeId } = get()
        const trimmed = text.trim()
        if (!trimmed || typing) return
        if (!conversations.some((c) => c.id === activeId)) return

        const priorContext = get().conversations.find((c) => c.id === activeId)!.context;
        const historyForApi = priorContext.slice(-8); // only prior turns, not current message (backend gets message separately)
        const historyForStore = [...priorContext, { role: "user" as const, content: trimmed }];

        set({ input: "", typing: true })

        // Append the user message and (on first real message) name the
        // conversation after it. Functional update so concurrent sends stay
        // consistent even though the UI disables sending while typing.
        const appendUser = (state: ChatbotState) => ({
          conversations: state.conversations.map((c) =>
            c.id === state.activeId
              ? {
                  ...c,
                  title: c.messages.length <= 1 ? trimmed.slice(0, 40) : c.title,
                  messages: [...c.messages, { id: uid(), from: "user" as const, text: trimmed, timestamp: Date.now() }],
                  context: historyForStore.slice(-MAX_CONTEXT),
                  updatedAt: Date.now(),
                }
              : c
          ),
        })
        set(appendUser)

        try {
          // The backend only needs the most recent turns for context (without duplicating current message).
          const res = await chatbotApi.query(trimmed, eventId, historyForApi)
          const reply = res.reply
          set((state) => ({
            conversations: state.conversations.map((c) =>
              c.id === state.activeId
                ? {
                    ...c,
                    messages: [
                      ...c.messages,
                      { id: uid(), from: "bot" as const, text: reply, timestamp: Date.now(), quickReplies: res.quickReplies },
                    ],
                    context: [...historyForStore, { role: "assistant" as const, content: reply }].slice(-MAX_CONTEXT),
                    updatedAt: Date.now(),
                  }
                : c
            ),
          }))
        } catch {
          set((state) => ({
            conversations: state.conversations.map((c) =>
              c.id === state.activeId
                ? {
                    ...c,
                    messages: [
                      ...c.messages,
                      {
                        id: uid(),
                        from: "bot" as const,
                        text: "I couldn't reach the server just now — please try again.",
                        timestamp: Date.now(),
                        error: true,
                        retryText: trimmed,
                      },
                    ],
                    updatedAt: Date.now(),
                  }
                : c
            ),
          }))
        } finally {
          set({ typing: false })
        }
      },
    }),
    {
      name: "eventnexus-chatbot",
      storage: createJSONStorage(() => userScopedStorage),
      partialize: (s) => ({
        conversations: s.conversations,
        activeId: s.activeId || s.conversations[0]?.id,
      }),
      // Repair rehydrated data (schema changes, hand-edited localStorage):
      // every conversation gets a seed greeting if empty, a title, and a
      // context array; the active conversation must exist in the list.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<ChatbotState>
        const stored = Array.isArray(p.conversations) && p.conversations.length ? p.conversations : current.conversations
        const conversations = stored
          .map((c) => ({
            ...newConversation(),
            ...c,
            title: c.title || "New chat",
            // Backfills id/timestamp on messages persisted before those
            // fields existed, so older localStorage history doesn't crash
            // React's key prop or show a blank timestamp.
            messages: c.messages?.length
              ? c.messages.map((m) => ({ ...m, id: m.id || uid(), timestamp: m.timestamp || c.updatedAt || Date.now() }))
              : [seedMsg()],
            context: Array.isArray(c.context) ? c.context : [],
          }))
          .slice(0, MAX_STORED_CONVERSATIONS)
        const activeId = conversations.some((c) => c.id === p.activeId)
          ? (p.activeId as string)
          : conversations[0].id
        return { ...current, conversations, activeId }
      },
    }
  )
)

// Call this right after login/register/Google-login succeeds and right
// after logout. The store is a module-level singleton created once when
// the app loads, so it doesn't automatically notice that localStorage's
// USER_KEY changed underneath it — without this, switching accounts in the
// same tab (no full page reload) would keep showing whichever user's
// conversations happened to be loaded first. Clears in-memory state to a
// fresh conversation immediately (so nothing from the previous account
// flashes on screen) then re-reads from the now-correct per-user key.
export function resetChatbotForUserChange() {
  const fresh = newConversation()
  useChatbotStore.setState({
    conversations: [fresh],
    activeId: fresh.id,
    open: false,
    input: "",
    typing: false,
  })
  void useChatbotStore.persist.rehydrate()
}
