import Link from "next/link"
import type { Metadata } from "next"
import { LegalDoc, type LegalSection } from "@/components/landing/legal-doc"

export const metadata: Metadata = {
  title: "Terms & Conditions — EventNexus",
  description: "The terms that govern your use of the EventNexus platform.",
}

const sections: LegalSection[] = [
  {
    heading: "Acceptance",
    body: (
      <p>
        By creating an account or using EventNexus (the &ldquo;Service&rdquo;) you agree to these Terms
        and to our <Link href="/privacy">Privacy Policy</Link>. If you use the Service on behalf of an
        organization, you confirm you are authorized to bind that organization.
      </p>
    ),
  },
  {
    heading: "Your account",
    body: (
      <ul>
        <li>Provide accurate information and keep your credentials secure.</li>
        <li>You are responsible for activity under your account.</li>
        <li>Email/password accounts must verify their address; you must be legally able to enter a contract in your jurisdiction.</li>
      </ul>
    ),
  },
  {
    heading: "Acceptable use",
    body: (
      <>
        <p>You agree not to:</p>
        <ul>
          <li>Use the Service for unlawful, fraudulent, or deceptive events or payments.</li>
          <li>Upload malware, attempt to breach access controls, or disrupt the platform.</li>
          <li>Scrape, resell, or misrepresent the Service, or infringe others&rsquo; rights.</li>
          <li>Forge, duplicate, or resell tickets outside an organizer&rsquo;s terms.</li>
        </ul>
      </>
    ),
  },
  {
    heading: "Events, tickets & payments",
    body: (
      <p>
        Organizers are solely responsible for their events, including content, pricing, capacity,
        admission, refunds, and compliance with local law. Paid transactions are processed by Stripe or
        eSewa under their terms; EventNexus is not a party to the contract between an organizer and an
        attendee. NPR prices may be converted to USD for card charges at checkout — the listed price is
        unchanged.
      </p>
    ),
  },
  {
    heading: "Plans & billing",
    body: (
      <p>
        Paid plans renew until cancelled. Upgrades take effect immediately; downgrades apply at the end
        of the current period. Fees are non-refundable except where required by law. See the{" "}
        <Link href="/pricing">Pricing</Link> page for current plans and limits.
      </p>
    ),
  },
  {
    heading: "Intellectual property",
    body: (
      <p>
        EventNexus and its software, design, and branding are owned by us. You retain ownership of
        content you upload, and grant us a limited licence to host and display it solely to operate the
        Service.
      </p>
    ),
  },
  {
    heading: "Availability & changes",
    body: (
      <p>
        We aim for high availability but the Service is provided on an &ldquo;as is&rdquo; and &ldquo;as
        available&rdquo; basis. We may add, change, or remove features, and may suspend the Service for
        maintenance or security.
      </p>
    ),
  },
  {
    heading: "Disclaimers & liability",
    body: (
      <p>
        To the fullest extent permitted by law, EventNexus is not liable for indirect, incidental, or
        consequential damages, or for losses arising from an organizer&rsquo;s event, third-party
        payment processing, or your failure to secure your account. Nothing here excludes liability that
        cannot lawfully be excluded.
      </p>
    ),
  },
  {
    heading: "Termination",
    body: (
      <p>
        You may stop using the Service at any time. We may suspend or terminate accounts that breach
        these Terms or create risk for other users. On termination, your right to use the Service ends;
        data handling follows the <Link href="/privacy">Privacy Policy</Link>.
      </p>
    ),
  },
  {
    heading: "Governing terms",
    body: (
      <p>
        These Terms are governed by the laws of the operator&rsquo;s principal place of business, without
        regard to conflict-of-law rules. If any provision is unenforceable, the rest remains in effect.
      </p>
    ),
  },
  {
    heading: "Contact",
    body: (
      <p>
        Questions about these Terms? Reach us via the <Link href="/contact">Contact</Link> page or at{" "}
        <a href="mailto:legal@eventnexus.app">legal@eventnexus.app</a>.
      </p>
    ),
  },
]

export default function TermsPage() {
  return (
    <LegalDoc
      kicker="Terms & Conditions"
      title="The rules of the road"
      intro="Plain-language terms for using EventNexus as an attendee, organizer, or organization."
      updated="September 2026"
      sections={sections}
    />
  )
}
