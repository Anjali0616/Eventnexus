import type { Metadata } from "next"
import { Mail, MessageSquare, Building2, LifeBuoy } from "lucide-react"
import { Navbar } from "@/components/landing/navbar"
import { Footer } from "@/components/landing/footer"
import { Reveal } from "@/components/anim/reveal"
import { ContactForm } from "@/components/landing/contact-form"

export const metadata: Metadata = {
  title: "Contact — EventNexus",
  description:
    "Get in touch with the EventNexus team about sales, enterprise deployments, support, or partnerships.",
}

const channels = [
  {
    icon: Mail,
    title: "General",
    body: "Questions about the product or your account.",
    action: { label: "hello@eventnexus.app", href: "mailto:hello@eventnexus.app" },
  },
  {
    icon: Building2,
    title: "Sales & Enterprise",
    body: "Multi-org deployments, SSO, SLAs, and custom limits.",
    action: { label: "sales@eventnexus.app", href: "mailto:sales@eventnexus.app" },
  },
  {
    icon: LifeBuoy,
    title: "Support",
    body: "Running an event and hit a snag? We're quick.",
    action: { label: "support@eventnexus.app", href: "mailto:support@eventnexus.app" },
  },
  {
    icon: MessageSquare,
    title: "Community",
    body: "Chat with other organizers and the team.",
    action: { label: "Join the Discord", href: "https://discord.com" },
  },
]

export default function ContactPage() {
  return (
    <div className="min-h-screen bg-background">
      <Navbar />
      <main className="pt-28">
        <section className="mx-auto max-w-7xl px-6 pb-14">
          <Reveal>
            <span className="inline-block rounded-full bg-primary/10 px-4 py-1.5 text-xs font-medium text-primary">
              Contact
            </span>
            <h1 className="font-display mt-5 max-w-3xl text-balance text-4xl font-bold tracking-tight text-ink sm:text-5xl">
              Talk to the EventNexus team
            </h1>
            <p className="mt-5 max-w-xl text-pretty leading-relaxed text-muted-foreground">
              Whether you're sizing up a plan, planning a multi-organization program, or just stuck —
              send a note and a real person will get back to you within one business day.
            </p>
          </Reveal>
        </section>

        <section className="mx-auto max-w-7xl px-6 pb-24">
          <div className="grid gap-10 lg:grid-cols-[1.15fr_0.85fr]">
            <Reveal x={-24} y={0}>
              <ContactForm />
            </Reveal>

            <Reveal x={24} y={0} className="space-y-4">
              {channels.map((c) => {
                const Icon = c.icon
                const external = c.action.href.startsWith("http")
                return (
                  <div key={c.title} className="rounded-2xl border border-border bg-card p-5">
                    <div className="flex items-center gap-3">
                      <span className="bg-brand-gradient flex size-9 items-center justify-center rounded-xl text-white">
                        <Icon className="size-4" />
                      </span>
                      <h2 className="font-display text-sm font-bold text-ink">{c.title}</h2>
                    </div>
                    <p className="mt-2.5 text-sm leading-relaxed text-muted-foreground">{c.body}</p>
                    <a
                      href={c.action.href}
                      {...(external ? { target: "_blank", rel: "noreferrer noopener" } : {})}
                      className="mt-3 inline-block text-sm font-semibold text-primary transition-colors hover:text-primary/80"
                    >
                      {c.action.label} →
                    </a>
                  </div>
                )
              })}
            </Reveal>
          </div>
        </section>
      </main>
      <Footer />
    </div>
  )
}
