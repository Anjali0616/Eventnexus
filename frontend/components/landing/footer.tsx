import Link from "next/link"
import { ArrowRight } from "lucide-react"
import { Reveal } from "@/components/anim/reveal"
import { Logo } from "@/components/ui/logo"

type FooterLink = { label: string; href: string; external?: boolean; hint?: string }

// Every href resolves to a real route / anchor in this app. Features and
// "How It Works" are intentionally absent here — they live in the navbar and
// the landing sections. Notes on the demo targets:
//  - Browse Events → /events is the public attendee browsing experience.
//  - Dashboard → /analytics renders from the public events feed; no login,
//    no real account, never the Admin console.
const columns: { title: string; links: FooterLink[] }[] = [
  {
    title: "Discover",
    links: [
      { label: "Browse Events", href: "/events" },
      { label: "Categories", href: "/events?filters=1" },
      { label: "Recommendations", href: "/recommendations" },
      { label: "Upcoming Events", href: "/events?status=Upcoming" },
    ],
  },
  {
    title: "Organizations",
    links: [
      { label: "Register Organization", href: "/org-register" },
      { label: "Organizer Guide", href: "/organizer-guide" },
      { label: "Create an Event", href: "/create-event" },
      { label: "Collaboration", href: "/collaboration" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About EventNexus", href: "/about" },
      { label: "Our Mission", href: "/about#mission" },
      { label: "Contact", href: "/contact" },
    ],
  },
  {
    title: "Support",
    links: [
      { label: "FAQs", href: "/faqs" },
      { label: "Help Center", href: "/contact" },
      { label: "Privacy Policy", href: "/privacy" },
      { label: "Terms & Conditions", href: "/terms" },
    ],
  },
  {
    title: "Connect",
    links: [
      { label: "LinkedIn", href: "https://www.linkedin.com/in/anjali-mishra-tech2025/", external: true },
      { label: "GitHub", href: "https://github.com/Anjali0616/Eventnexus", external: true },
      { label: "Twitter / X", href: "https://x.com", external: true },
    ],
  },
]

function FooterLinkItem({ link }: { link: FooterLink }) {
  const base = "text-sm text-white/55 transition-colors hover:text-white"
  if (link.external) {
    return (
      <a href={link.href} target="_blank" rel="noreferrer noopener" className={base}>
        {link.label}
      </a>
    )
  }
  if (link.href.startsWith("#")) {
    return (
      <a href={link.href} className={base}>
        {link.label}
      </a>
    )
  }
  return (
    <Link href={link.href} className={base}>
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

      {/* link grid */}
      <div className="mx-auto max-w-7xl px-6 pb-12">
        <div className="grid gap-10 border-t border-white/10 pt-12 lg:grid-cols-[1.3fr_3fr] lg:gap-16">
          {/* brand + tagline */}
          <div>
            <Link href="/" className="inline-flex transition-opacity hover:opacity-80">
              <Logo onDark className="h-8" />
            </Link>
            <p className="font-display mt-4 text-base font-semibold text-white">
              Connect. Collaborate. Create.
            </p>
            <p className="mt-2 max-w-xs text-sm leading-relaxed text-white/55">
              AI-enabled, secure, cloud-based event management for multi-organization collaboration.
            </p>
          </div>

          {/* five link columns */}
          <div className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-3 lg:grid-cols-5">
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
        </div>

        {/* base bar */}
        <div className="mt-12 flex flex-col items-center justify-between gap-3 border-t border-white/10 pt-6 text-center text-xs text-white/45 sm:flex-row sm:text-left">
          <span>© {new Date().getFullYear()} EventNexus. All rights reserved.</span>
          <span>
            Built by{" "}
            <a
              href="https://www.linkedin.com/in/anjali-mishra-tech2025/"
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
