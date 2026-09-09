import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Reveal } from "@/components/anim/reveal"
import { Logo } from "@/components/ui/logo"

type FooterLink = { label: string; href: string; hint?: string }

// Every href resolves to a real route or in-page anchor in this app.
// Notes on the two "demo" targets:
//  - Browse Events → /events is the public attendee browsing experience
//    (search + filters + listings), NOT an account dashboard.
//  - Dashboard → /analytics renders the charts dashboard from the public
//    events feed; it needs no login and never touches a real account.
const columns: { title: string; links: FooterLink[] }[] = [
  {
    title: "Explore",
    links: [
      { label: "Browse Events", href: "/events" },
      { label: "How It Works", href: "/#how" },
      { label: "Recommendations", href: "/recommendations" },
    ],
  },
  {
    title: "For Organizations",
    links: [
      { label: "Register an Organization", href: "/org-register" },
      { label: "Create Events", href: "/organizer/events/create" },
      { label: "Collaboration", href: "/organizer/collaboration" },
    ],
  },
  {
    title: "Platform",
    links: [
      { label: "Dashboard", href: "/analytics", hint: "Live demo — no sign-in" },
      { label: "For Organizers", href: "/organizer" },
    ],
  },
  {
    title: "Support",
    links: [
      { label: "Contact Us", href: "/contact" },
      { label: "FAQs", href: "/faqs" },
      { label: "Privacy Policy", href: "/privacy" },
      { label: "Terms & Conditions", href: "/terms" },
    ],
  },
]

const LINKEDIN_URL = "https://www.linkedin.com/in/anjali-mishra-tech2025/"

function FooterLinkItem({ link }: { link: FooterLink }) {
  const base = "text-sm text-white/55 transition-colors hover:text-white"
  const inner = link.href.startsWith("#") ? (
    <a href={link.href} className={base}>
      {link.label}
    </a>
  ) : (
    <Link href={link.href} className={base}>
      {link.label}
    </Link>
  )
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
      {inner}
      {link.hint && (
        <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] font-medium text-white/45">
          {link.hint}
        </span>
      )}
    </span>
  )
}

export function Footer() {
  return (
    <footer id="about" className="bg-ink text-white">
      {/* CTA band */}
      <Reveal scale={0.97} className="mx-auto max-w-7xl px-6 py-16 sm:py-20">
        <div className="bg-brand-gradient relative overflow-hidden rounded-3xl px-6 py-12 text-center shadow-2xl sm:px-8 sm:py-14">
          <h2 className="font-display mx-auto max-w-2xl text-balance text-2xl font-bold leading-tight sm:text-4xl">
            Ready to run smarter events, together?
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-pretty text-sm text-white/80 sm:text-base">
            Join the teams using EventNexus to automate, secure, and scale their events.
          </p>
          <Link
            href="/register"
            className="group mt-8 inline-flex items-center gap-2 rounded-full bg-white px-7 py-3.5 text-sm font-semibold text-ink transition-transform hover:-translate-y-0.5"
          >
            Get Started Free
            <ArrowRight className="size-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
      </Reveal>

      {/* link grid */}
      <div className="mx-auto max-w-7xl px-6 pb-12">
        <div className="grid grid-cols-2 gap-x-8 gap-y-10 border-t border-white/10 pt-12 md:grid-cols-3 lg:grid-cols-6">
          <div className="col-span-2 md:col-span-3 lg:col-span-2">
            <Link href="/" className="inline-flex transition-opacity hover:opacity-80">
              <Logo onDark className="h-8" />
            </Link>
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/55">
              AI-enabled, secure, cloud-based event management for multi-organization collaboration.
            </p>
          </div>

          {columns.map((col) => (
            <nav key={col.title} aria-label={col.title}>
              <h3 className="font-display text-sm font-semibold text-white">{col.title}</h3>
              <ul className="mt-4 space-y-3">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <FooterLinkItem link={l} />
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        {/* base bar */}
        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-white/10 pt-6 text-center text-xs text-white/45 sm:flex-row sm:text-left">
          <span>© {new Date().getFullYear()} EventNexus. All rights reserved.</span>
          <span>
            Built by{" "}
            <a
              href={LINKEDIN_URL}
              target="_blank"
              rel="noreferrer noopener"
              className="font-medium text-white/70 underline-offset-4 transition-colors hover:text-white hover:underline"
            >
              Anjali Mishra
            </a>
          </span>
        </div>
      </div>
    </footer>
  )
}
