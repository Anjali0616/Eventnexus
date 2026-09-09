"use client"

import { useState } from "react"
import { Send, Check } from "lucide-react"

const TOPICS = ["General", "Sales & Enterprise", "Support", "Partnerships", "Press"] as const

const CONTACT_EMAIL = "hello@eventnexus.app"

export function ContactForm() {
  const [sent, setSent] = useState(false)
  const [form, setForm] = useState({
    name: "",
    email: "",
    org: "",
    topic: "General" as (typeof TOPICS)[number],
    message: "",
  })

  const set =
    (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }))

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    // No contact backend yet — hand off to the visitor's mail client with a
    // fully prefilled message so nothing is lost.
    const subject = `[${form.topic}] EventNexus enquiry from ${form.name || "website"}`
    const body = [
      `Name: ${form.name}`,
      `Email: ${form.email}`,
      form.org && `Organization: ${form.org}`,
      `Topic: ${form.topic}`,
      "",
      form.message,
    ]
      .filter(Boolean)
      .join("\n")
    window.location.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent(
      subject,
    )}&body=${encodeURIComponent(body)}`
    setSent(true)
  }

  const field =
    "w-full rounded-xl border border-border bg-card px-4 py-2.5 text-sm text-ink outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary"

  if (sent) {
    return (
      <div className="rounded-3xl border border-secondary/30 bg-secondary/5 p-8 text-center">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-secondary/15 text-secondary">
          <Check className="size-6" strokeWidth={3} />
        </span>
        <h3 className="font-display mt-4 text-lg font-bold text-ink">Your mail client is opening</h3>
        <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
          Send the pre-filled email and we'll reply within one business day. Nothing arrived? Write to{" "}
          <a href={`mailto:${CONTACT_EMAIL}`} className="font-medium text-primary">
            {CONTACT_EMAIL}
          </a>
          .
        </p>
        <button
          onClick={() => setSent(false)}
          className="mt-5 rounded-full border border-border px-5 py-2 text-sm font-medium text-ink transition-colors hover:bg-muted"
        >
          Back to form
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={onSubmit} className="rounded-3xl border border-border bg-card p-6 sm:p-8">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink">Name</span>
          <input required value={form.name} onChange={set("name")} className={field} placeholder="Jane Doe" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink">Work email</span>
          <input
            required
            type="email"
            value={form.email}
            onChange={set("email")}
            className={field}
            placeholder="jane@company.com"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink">Organization <span className="font-normal text-muted-foreground">(optional)</span></span>
          <input value={form.org} onChange={set("org")} className={field} placeholder="Acme Events" />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs font-semibold text-ink">Topic</span>
          <select value={form.topic} onChange={set("topic")} className={field}>
            {TOPICS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="mt-4 block">
        <span className="mb-1.5 block text-xs font-semibold text-ink">How can we help?</span>
        <textarea
          required
          rows={5}
          value={form.message}
          onChange={set("message")}
          className={`${field} resize-y`}
          placeholder="Tell us about your events, team size, and what you're trying to solve…"
        />
      </label>
      <button
        type="submit"
        className="group mt-5 inline-flex items-center gap-2 rounded-full bg-primary px-7 py-3 text-sm font-semibold text-primary-foreground shadow-[0_12px_32px_-10px_rgba(91,76,245,0.8)] transition-transform hover:-translate-y-0.5"
      >
        Send message
        <Send className="size-4 transition-transform group-hover:translate-x-0.5" />
      </button>
      <p className="mt-3 text-xs text-muted-foreground">
        Opens your email app with everything filled in — we never store form data without you hitting send.
      </p>
    </form>
  )
}
