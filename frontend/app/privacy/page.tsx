import Link from "next/link"
import type { Metadata } from "next"
import { LegalDoc, type LegalSection } from "@/components/landing/legal-doc"

export const metadata: Metadata = {
  title: "Privacy Policy — EventNexus",
  description: "How EventNexus collects, uses, and protects your personal data.",
}

const sections: LegalSection[] = [
  {
    heading: "Who we are",
    body: (
      <p>
        EventNexus is an AI-enabled event management platform for individuals and organizations. This
        policy explains what personal data we process when you use the website and app, and the choices
        you have. Questions? <Link href="/contact">Contact us</Link>.
      </p>
    ),
  },
  {
    heading: "Information we collect",
    body: (
      <>
        <p>We collect only what we need to run the service:</p>
        <ul>
          <li><strong>Account data</strong> — name, email, password hash (or Google sign-in identifier), and role.</li>
          <li><strong>Event &amp; ticket data</strong> — events you create or register for, ticket and check-in records.</li>
          <li><strong>Organization data</strong> — organization name and team membership, for organizers.</li>
          <li><strong>Payment metadata</strong> — for paid events, transaction status and references from Stripe or eSewa. We never store full card numbers.</li>
          <li><strong>Usage &amp; device data</strong> — basic logs (IP, timestamps, actions) used for security, auditing, and debugging.</li>
          <li><strong>Location</strong> — only if you grant it, to sort nearby events. You can decline.</li>
        </ul>
      </>
    ),
  },
  {
    heading: "How we use it",
    body: (
      <ul>
        <li>To provide the service: authentication, event registration, tickets, notifications.</li>
        <li>To generate recommendations and attendance forecasts from your activity.</li>
        <li>To keep the platform secure — rate limiting, abuse detection, and audit trails.</li>
        <li>To send transactional email (confirmations, reminders, receipts). We do not sell your data or send marketing without consent.</li>
      </ul>
    ),
  },
  {
    heading: "Sharing",
    body: (
      <>
        <p>We share personal data only with:</p>
        <ul>
          <li><strong>Event organizers</strong> — your name and registration details for events you register for.</li>
          <li><strong>Processors we rely on</strong> — payment providers (Stripe, eSewa), email delivery, cloud hosting (AWS), and the AI inference service, each acting on our instructions.</li>
          <li><strong>Authorities</strong> — where required by law.</li>
        </ul>
      </>
    ),
  },
  {
    heading: "Retention",
    body: (
      <p>
        We keep account and event data for as long as your account is active. When you close your
        account we delete or anonymize your personal data within a reasonable period, except records we
        must retain for legal, tax, or dispute-resolution purposes.
      </p>
    ),
  },
  {
    heading: "Your rights",
    body: (
      <p>
        You can access, correct, export, or delete your personal data. Most of this is available in your
        account settings; for the rest, email us from the <Link href="/contact">Contact</Link> page and
        we will action verified requests promptly.
      </p>
    ),
  },
  {
    heading: "Cookies & local storage",
    body: (
      <p>
        We use local storage to keep you signed in and remember lightweight preferences (such as a
        selected filter or tab). We do not use third-party advertising or cross-site tracking cookies.
      </p>
    ),
  },
  {
    heading: "Security",
    body: (
      <p>
        Traffic is encrypted in transit (HTTPS). Access is role-based and enforced on the server for
        every route; passwords are hashed; sensitive actions are logged. No system is perfectly secure,
        but we work to keep the risk low and will notify affected users of any material breach.
      </p>
    ),
  },
  {
    heading: "Changes",
    body: (
      <p>
        We may update this policy as the product evolves. Material changes will be surfaced in the app
        or by email. The &ldquo;last updated&rdquo; date above always reflects the current version.
      </p>
    ),
  },
  {
    heading: "Contact",
    body: (
      <p>
        For any privacy question or request, reach us via the{" "}
        <Link href="/contact">Contact</Link> page or at{" "}
        <a href="mailto:privacy@eventnexus.app">privacy@eventnexus.app</a>.
      </p>
    ),
  },
]

export default function PrivacyPage() {
  return (
    <LegalDoc
      kicker="Privacy Policy"
      title="Your data, handled carefully"
      intro="We collect the minimum needed to run EventNexus, use it only to provide and secure the service, and never sell it."
      updated="September 2026"
      sections={sections}
    />
  )
}
