import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Reveal } from "@/components/anim/reveal"
import { Logo } from "@/components/ui/logo"

type FooterLink = { label: string; href: string; external?: boolean }

// Every link points at a route or in-page anchor that actually exists in this
// codebase (see app/ and the landing section ids) — no dead "#" placeholders.
const columns: { title: string; links: FooterLink[] }[] = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "/#features" },
      { label: "How It Works", href: "/#how" },
      { label: "The Problem", href: "/#problems" },
      { label: "Browse Events", href: "/events" },
    ],
  },
  {
    title: "Platform",
    links: [
      { label: "Dashboard", href: "/dashboard" },
      { label: "For Organizers", href: "/organizer" },
      { label: "Admin Console", href: "/admin" },
      { label: "Recommendations", href: "/recommendations" },
    ],
  },
  {
    title: "Account",
    links: [
      { label: "Log In", href: "/login" },
      { label: "Create Account", href: "/register" },
      { label: "Register an Org", href: "/org-register" },
      { label: "My Tickets", href: "/my-tickets" },
    ],
  },
  {
    title: "Connect",
    links: [
      { label: "GitHub", href: "https://github.com", external: true },
      { label: "Twitter", href: "https://twitter.com", external: true },
      { label: "LinkedIn", href: "https://linkedin.com", external: true },
      { label: "Contact", href: "mailto:hello@eventnexus.app" },
    ],
  },
]

function FooterLinkItem({ link }: { link: FooterLink }) {
  const className = "text-sm text-white/50 transition-colors hover:text-white"

  if (link.external) {
    return (
      <a href={link.href} target="_blank" rel="noreferrer noopener" className={className}>
        {link.label}
      </a>
    )
  }
  if (link.href.startsWith("mailto:") || link.href.startsWith("#")) {
    return (
      <a href={link.href} className={className}>
        {link.label}
      </a>
    )
  }
  return (
    <Link href={link.href} className={className}>
      {link.label}
    </Link>
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

      {/* links */}
      <div className="mx-auto max-w-7xl px-6 pb-12">
        <div className="grid grid-cols-2 gap-10 border-t border-white/10 pt-12 sm:grid-cols-3 lg:grid-cols-6">
          <div className="col-span-2 sm:col-span-3 lg:col-span-2">
            <Link href="/" className="inline-flex transition-opacity hover:opacity-80">
              <Logo onDark className="h-8" />
            </Link>

            <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/50">
              AI-enabled secure cloud-based event management for multi-organization collaboration.
            </p>
          </div>

          {columns.map((col) => (
            <div key={col.title}>
              <h4 className="font-display text-sm font-semibold">{col.title}</h4>
              <ul className="mt-4 space-y-3">
                {col.links.map((l) => (
                  <li key={l.label}>
                    <FooterLinkItem link={l} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-white/10 pt-6 text-center text-xs text-white/40 sm:flex-row sm:text-left">
          <span>© {new Date().getFullYear()} EventNexus. All rights reserved.</span>
          <span className="font-mono">Built with MERN Stack · Hosted on AWS</span>
        </div>
      </div>
    </footer>
  )
}
