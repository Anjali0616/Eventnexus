/**
 * Database seed script.
 *
 * Wipes the collections it manages and inserts a realistic demo dataset:
 * one organization, 24 attendees (plus admin/organizer/org-admin), events
 * (9 hand-authored + 100 generated for search/analytics volume), real
 * tickets with payment data on every rail (eSewa / Stripe / pending /
 * refunded), check-ins on past + live events, feedback, feedback sentiment,
 * event sessions, speakers, and notifications.
 *
 * Every hand-authored upcoming/live event has ALL attendees registered with
 * a payment where the event is priced, so the organizer workspace roster,
 * the check-in flow, the ledger, and analytics all light up immediately.
 *
 * Run with:  pnpm seed   (from the backend/ directory)
 *
 * Login credentials created by this script are printed at the end. Every
 * account uses the same demo password.
 */
import dotenv from "dotenv";
dotenv.config();
import mongoose from "mongoose";
import crypto from "crypto";

import User from "./models/User";
import Session from "./models/Session";
import Mail from "./models/Mail";
import Organization from "./models/Organization";
import OrganizationMember from "./models/OrganizationMember";
import Role from "./models/Role";
import Permission from "./models/Permission";
import Event from "./models/Event";
import EventSession from "./models/EventSession";
import Speaker from "./models/Speaker";
import Ticket from "./models/Ticket";
import Notification from "./models/Notification";
import Feedback from "./models/Feedback";
import { signTicketToken } from "./utils/qrToken";
import { classifySentiment } from "./utils/sentiment";

const DEMO_PASSWORD = "password123";
const NPR_TO_USD = 133; // ~current NPR per USD, used for the Stripe demo rail

const day = 24 * 60 * 60 * 1000;
const now = Date.now();

// Deterministic PRNG (mulberry32) so ticket assignment is reproducible
// across seed runs even though the generated events themselves re-roll.
const seededRand = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const ATTENDEES = [
  { name: "Alex Attendee", email: "attendee@eventnexus.dev", city: "Kathmandu", lat: 27.7172, lng: 85.324 },
  { name: "Priya Sharma", email: "priya@eventnexus.dev", city: "Kathmandu", lat: 27.7, lng: 85.33 },
  { name: "Sam Gurung", email: "sam@eventnexus.dev", city: "Kathmandu", lat: 27.73, lng: 85.34 },
  { name: "Riya Maharjan", email: "riya@eventnexus.dev", city: "Lalitpur", lat: 27.6667, lng: 85.3167 },
  { name: "Arjun K.C.", email: "arjun@eventnexus.dev", city: "Kathmandu", lat: 27.7101, lng: 85.318 },
  { name: "Sushmita Rai", email: "sushmita@eventnexus.dev", city: "Bhaktapur", lat: 27.671, lng: 85.4298 },
  { name: "Bibek Thapa", email: "bibek@eventnexus.dev", city: "Kathmandu", lat: 27.722, lng: 85.332 },
  { name: "Anisha Khadka", email: "anisha@eventnexus.dev", city: "Kathmandu", lat: 27.705, lng: 85.31 },
  { name: "Prabin Shrestha", email: "prabin@eventnexus.dev", city: "Lalitpur", lat: 27.675, lng: 85.325 },
  { name: "Sunita Tamang", email: "sunita@eventnexus.dev", city: "Kathmandu", lat: 27.715, lng: 85.328 },
  { name: "Deepak Adhikari", email: "deepak@eventnexus.dev", city: "Pokhara", lat: 28.2096, lng: 83.9856 },
  { name: "Nisha Bajracharya", email: "nisha@eventnexus.dev", city: "Lalitpur", lat: 27.669, lng: 85.318 },
  { name: "Karan Lama", email: "karan@eventnexus.dev", city: "Kathmandu", lat: 27.719, lng: 85.305 },
  { name: "Aarti Poudel", email: "aarti@eventnexus.dev", city: "Kathmandu", lat: 27.711, lng: 85.315 },
  { name: "Bikash Rana", email: "bikash@eventnexus.dev", city: "Chitwan", lat: 27.5985, lng: 84.0885 },
  { name: "Sneha Karki", email: "sneha@eventnexus.dev", city: "Kathmandu", lat: 27.7205, lng: 85.3271 },
  { name: "Roshan Koirala", email: "roshan@eventnexus.dev", city: "Kathmandu", lat: 27.6882, lng: 85.341 },
  { name: "Manisha Joshi", email: "manisha@eventnexus.dev", city: "Lalitpur", lat: 27.6631, lng: 85.3276 },
  { name: "Subash Mahato", email: "subash@eventnexus.dev", city: "Kathmandu", lat: 27.696, lng: 85.302 },
  { name: "Isha Acharya", email: "isha@eventnexus.dev", city: "Kathmandu", lat: 27.7024, lng: 85.3131 },
  { name: "Nabin Chand", email: "nabin@eventnexus.dev", city: "Pokhara", lat: 28.2313, lng: 83.9987 },
  { name: "Pragya Neupane", email: "pragya@eventnexus.dev", city: "Lalitpur", lat: 27.6593, lng: 85.3115 },
  { name: "Pradeep Malla", email: "pradeep@eventnexus.dev", city: "Kathmandu", lat: 27.7094, lng: 85.3302 },
  { name: "Sajana Shrestha", email: "sajana@eventnexus.dev", city: "Kathmandu", lat: 27.7048, lng: 85.3347 },
];

// Feedback comment pools so the seeded sentiment classifier gets realistic
// spread across past events.
const COMMENT_POOL = {
  5: [
    "Fantastic workshop, the instructors were excellent and very helpful!",
    "Absolutely loved it — smooth check-in, great venue, would 100% recommend.",
    "One of the best events I've attended this year. Inspiring speakers and a warm crowd.",
    "Everything was well organized from start to finish. Loved the sessions.",
    "Great energy and really useful takeaways. The staff were friendly and helpful too.",
  ],
  4: [
    "Really enjoyed it, well organized. Venue was a bit crowded though.",
    "Good event overall — content was engaging, though the sound could be better.",
    "Solid sessions and a nice space. Slightly longer than needed in places.",
    "Enjoyed the networking; wish there were more breaks between talks.",
    "Very informative and professional. The lunch queue was a bit slow.",
  ],
  3: [
    "It was okay — some sessions were great, some dragged on.",
    "Decent event. The Wi-Fi was slow but the talks themselves were useful.",
  ],
  2: [
    "Disappointing — audio was broken for the first half and the schedule slipped badly.",
    "Overpriced for what it was. The talks felt rushed and the venue was messy.",
  ],
};

async function seed() {
  if (!process.env.MONGODB_URI) {
    console.error("✗ MONGODB_URI is not set. Copy .env.example to .env first.");
    process.exit(1);
  }

  await mongoose.connect(process.env.MONGODB_URI as string);
  console.log(`MongoDB connected: ${mongoose.connection.host}`);

  // --- Clean slate ---------------------------------------------------------
  // AuditLog is intentionally NOT wiped: the audit trail is append-only by
  // design (report §24) and should survive reseeds.
  await Promise.all([
    User.deleteMany({}),
    Organization.deleteMany({}),
    OrganizationMember.deleteMany({}),
    Role.deleteMany({}),
    Permission.deleteMany({}),
    Session.deleteMany({}),
    Mail.deleteMany({}),
    Event.deleteMany({}),
    EventSession.deleteMany({}),
    Speaker.deleteMany({}),
    Ticket.deleteMany({}),
    Notification.deleteMany({}),
    Feedback.deleteMany({}),
  ]);
  console.log("✓ Cleared existing collections");

  // Align indexes with the current schemas. The ticket index was once a
  // plain unique (event, attendee); it is now partial (status != cancelled)
  // so re-registration after a cancel works — syncIndexes drops the legacy
  // index, otherwise the seeded refunded/cancelled tickets collide with the
  // attendee's active one.
  await Ticket.syncIndexes();
  console.log("✓ Synced collection indexes");

  // --- Users ---------------------------------------------------------------
  const admin = await User.create({
    name: "Admin User",
    email: "admin@eventnexus.dev",
    password: DEMO_PASSWORD,
    role: "admin",
    emailVerifiedAt: new Date(),
  });

  const organizer = await User.create({
    name: "Olivia Organizer",
    email: "organizer@eventnexus.dev",
    password: DEMO_PASSWORD,
    role: "organizer",
    emailVerifiedAt: new Date(),
  });

  const orgAdmin = await User.create({
    name: "Dev Adhikari",
    email: "orgadmin@eventnexus.dev",
    password: DEMO_PASSWORD,
    role: "org_admin",
    emailVerifiedAt: new Date(),
  });

  // 24 attendees; nearly all carry a Kathmandu-Valley (or nearby) location
  // so distance-based recommendations have real spread to work with.
  const attendees = [];
  for (const a of ATTENDEES) {
    const user = await User.create({
      name: a.name,
      email: a.email,
      password: DEMO_PASSWORD,
      role: "attendee",
      emailVerifiedAt: new Date(),
      location: {
        lat: a.lat,
        lng: a.lng,
        city: a.city,
        updatedAt: new Date(),
      },
    });
    attendees.push(user);
  }
  console.log(`✓ Created ${attendees.length} users (admin, organizer, org-admin, 24 attendees)`);

  // --- Organization --------------------------------------------------------
  const org = await Organization.create({
    name: "EventNexus Demo Org",
    slug: "eventnexus-demo",
    owner: organizer._id,
    status: "active",
    email: "hello@eventnexus.dev",
    phone: "+977-1-5551234",
    address: "Durbar Marg",
    city: "Kathmandu",
    country: "Nepal",
    type: "Company",
    description: "Demo organization for the EventNexus platform.",
    website: "https://eventnexus.dev",
    approvedAt: new Date(),
  });

  await User.updateMany(
    { _id: { $in: [organizer._id, orgAdmin._id, ...attendees.map((u) => u._id)] } },
    { organization: org._id }
  );
  console.log("✓ Created organization");

  // --- Roles & permissions --------------------------------------------------
  const PERMISSIONS = [
    { code: "audit:view", name: "View audit logs", description: "Browse platform audit trail", scope: "system" },
    { code: "collaboration:invite", name: "Invite collaborators", description: "Add co-organizers and team members to an event", scope: "system" },
    { code: "event:manage", name: "Manage events", description: "Create, update, publish and delete events", scope: "system" },
    { code: "event:register", name: "Register for events", description: "Book a ticket to an event", scope: "system" },
    { code: "feedback:submit", name: "Submit event feedback", description: "Leave a rating and comment after an event", scope: "system" },
    { code: "iam:manage", name: "Manage roles & permissions", description: "Edit role permission sets (IAM matrix)", scope: "system" },
    { code: "ai:manage", name: "Manage AI console", description: "Retrain platform-wide ML models and curate shared chatbot training data (system admin)", scope: "system" },
    { code: "org:approve", name: "Approve organization registrations", description: "Accept or reject new tenant signups (system admin)", scope: "system" },
    { code: "org:manage", name: "Manage organization", description: "Edit organization profile and settings", scope: "system" },
    { code: "security:view", name: "View security settings", description: "Access the admin security / IAM console", scope: "system" },
    { code: "session:manage", name: "Manage user sessions", description: "Revoke sessions, reset token versions", scope: "system" },
    { code: "ticket:verify", name: "Check in attendees", description: "Scan tickets at the door", scope: "system" },
    { code: "ticket:view", name: "View tickets", description: "See own and team ticket registrations", scope: "system" },
    { code: "user:manage", name: "Manage users", description: "Invite, edit and deactivate organization members", scope: "system" },
    { code: "analytics:view", name: "View reports & analytics", description: "Access event and org analytics dashboards", scope: "system" },
  ];

  const ROLES = [
    {
      name: "admin",
      description: "Overall system administrator — controls all tenant companies",
      scope: "system",
      permissions: [
        "org:approve", "org:manage", "user:manage", "security:view", "event:manage",
        "analytics:view", "ticket:verify", "audit:view", "iam:manage", "ai:manage",
        "collaboration:invite", "session:manage",
      ],
    },
    {
      name: "org_admin",
      description: "Tenant admin — scoped to their own organization",
      scope: "organization",
      permissions: [
        "org:manage", "user:manage", "security:view", "event:manage",
        "analytics:view", "ticket:verify", "audit:view", "iam:manage",
        "collaboration:invite", "session:manage",
      ],
    },
    {
      name: "organizer",
      description: "Creates and manages events, checks in attendees",
      scope: "system",
      permissions: ["event:manage", "analytics:view", "ticket:verify", "collaboration:invite", "session:manage"],
    },
    {
      name: "attendee",
      description: "Registers for events and manages their tickets",
      scope: "system",
      permissions: ["event:register", "ticket:view", "feedback:submit"],
    },
  ];

  await Permission.insertMany(PERMISSIONS);
  await Role.insertMany(ROLES);
  console.log(`✓ Created ${PERMISSIONS.length} permissions, ${ROLES.length} roles`);

  // --- Organization members --------------------------------------------------
  await OrganizationMember.insertMany([
    { user: organizer._id, organization: org._id, roleInOrg: "owner", status: "active" },
    { user: orgAdmin._id, organization: org._id, roleInOrg: "owner", status: "active" },
    ...attendees.map((u) => ({
      user: u._id,
      organization: org._id,
      roleInOrg: "member",
      status: "active",
      joinedAt: new Date(now - 40 * day),
    })),
  ]);
  console.log("✓ Created organization members");

  // --- Speakers ------------------------------------------------------------
  // Standalone speaker profiles (referenced by event sessions) plus the
  // embedded event.speakers summaries used by the detail page.
  const speakerDefs = [
    { name: "Anisha Karki", title: "AI Research Lead", company: "Nepal AI Lab", bio: "Builds production LLM systems; previously at a Hackathons for local startups." },
    { name: "Rohan Shrestha", title: "Cloud Architect", company: "CloudNepal", bio: "10+ years designing resilient cloud platforms for Nepali fintechs." },
    { name: "Dr. Maya Tamang", title: "Data Scientist", company: "DataVerse", bio: "PhD in ML, works on recommendation systems for the region." },
    { name: "Kushal Pradhan", title: "Startup Advisor", company: "Kickstart Ventures", bio: "Angel investor focused on early-stage Nepali founders." },
    { name: "Srijan Joshi", title: "Capital Partner", company: "SeedFund Nepal", bio: "Runs a seed fund; backed 30+ local startups." },
    { name: "Lhamo Sherpa", title: "Founder & Musician", company: "Himalayan Beats", bio: "Singer-songwriter blending folk and modern indie styles." },
    { name: "Bipin Rawal", title: "Guitarist", company: "Freq Collective", bio: "Session musician and producer, tours across the valley." },
    { name: "Esther Luitel", title: "Educator", company: "CodeCamp Nepal", bio: "Teaches JavaScript to 5,000+ students online each year." },
    { name: "Gaurav Malla", title: "Investor", company: "Malla Capital", bio: "Focus on SaaS and marketplaces out of Kathmandu." },
    { name: "Sarina Oli", title: "UX Consultant", company: "Studio Nine", bio: "Design systems specialist for product teams." },
    { name: "Trishna Basnet", title: "Jazz Vocalist", company: "Nepal Jazz Society", bio: "Performs weekly jazz standards across valley venues." },
    { name: "Yogesh Panta", title: "Running Coach", company: "Trail Nepal", bio: "Ultra-runner and coach, organizes mountain trail events." },
    { name: "Anu Shrestha", title: "Wellness Facilitator", company: "Sattva Retreats", bio: "Yoga teacher and wellness retreat organizer." },
    { name: "Dinesh Jha", title: "VP Engineering", company: "FinNepal", bio: "Scales payment platforms handling millions of daily transactions." },
  ];
  const speakers = await Speaker.insertMany(
    speakerDefs.map((s) => ({ organization: org._id, name: s.name, title: s.title, company: s.company, bio: s.bio, isExternal: true }))
  );
  const sp = Object.fromEntries(speakerDefs.map((s, i) => [s.name, speakers[i]._id]));
  console.log(`✓ Created ${speakers.length} speakers`);

  // --- Events ---------------------------------------------------------------
  // The nine hand-authored events below are referenced by tickets, sessions,
  // feedback and notifications. The generated block after them adds volume
  // for search / analytics / the attendance model.
  const GEN_CATEGORIES = [
    "Technology", "Business", "Music", "Design", "Health", "Food",
    "Sports", "Education", "Community", "Art",
  ];
  const GEN_TYPES = ["In-person", "Virtual", "Hybrid"];
  const GEN_VENUES = [
    { venue: "Grand Hall, Kathmandu", lat: 27.7125, lng: 85.32, city: "Kathmandu" },
    { venue: "Rooftop Lounge, Lalitpur", lat: 27.6667, lng: 85.3167, city: "Lalitpur" },
    { venue: "Open Air Amphitheatre, Bhaktapur", lat: 27.671, lng: 85.4298, city: "Bhaktapur" },
    { venue: "Innovation Lab", lat: 27.7172, lng: 85.324, city: "Kathmandu" },
    { venue: "Yala House", lat: 27.709, lng: 85.323, city: "Kathmandu" },
    { venue: "City Center Mall", lat: 27.705, lng: 85.321, city: "Kathmandu" },
    { venue: "Green Park Pavilion", lat: 27.71, lng: 85.33, city: "Lalitpur" },
    { venue: "Virtual", lat: 27.7172, lng: 85.324, city: "Online" },
  ];
  const GEN_TITLES = [
    "Deep Dive: React Server Components", "Startup Funding 101", "Indie Music Night",
    "UX Metrics That Matter", "Morning Yoga Flow", "Food Truck Festival",
    "Local Football Cup", "AI Ethics Workshop", "Women in Tech", "Community Cleanup",
    "Photography Walk", "Data Viz with D3", "Live Jazz Quartet", "DevOps Days",
    "Plant-Based Cooking", "Chess Tournament", "Cloud Native Summit",
    "Open Source Sprint", "Design Systems Meetup", "Meditation Retreat",
    "Tech Book Club", "Angel Investing Panel", "Acoustic Sessions", "Accessibility Week",
    "Hackathon Kickoff", "Wellness Fair", "Code Review Workshop", "Film Screening",
    "Blockchain Basics", "Volunteer Fair", "Sustainable Living", "Startup Demo Day",
    "Mobile Dev Night", "Marathon Training", "Product Design Crit", "Pottery Class",
  ];
  const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const randCoord = (base) => base + (Math.random() - 0.5) * 0.018;

  const generateEvents = ({ organizer, org, count }) => {
    const out = [];
    for (let i = 0; i < count; i++) {
      const v = rand(GEN_VENUES);
      const category = rand(GEN_CATEGORIES);
      const roll = Math.random();
      let status;
      if (roll < 0.6) status = "Past";
      else if (roll < 0.9) status = "Upcoming";
      else if (roll < 0.97) status = "Live";
      else status = "Draft";
      const offsetDays = Math.floor((Math.random() - 0.6) * 730);
      const price =
        Math.random() < 0.5
          ? { amount: 0, currency: "NPR" }
          : { amount: Math.floor(Math.random() * 2000) + 100, currency: "NPR" };
      out.push({
        title: `${rand(GEN_TITLES)} #${i + 1}`,
        description: `A ${category.toLowerCase()} event generated for the ${org.name} tenant seed dataset.`,
        date: new Date(now + offsetDays * day),
        venue: v.venue,
        coordinates: { lat: randCoord(v.lat), lng: randCoord(v.lng) },
        type: rand(GEN_TYPES),
        category,
        capacity: [50, 80, 120, 200, 300, 500][Math.floor(Math.random() * 6)],
        price,
        status,
        organizer: organizer._id,
        organization: org._id,
        registered: status === "Past" ? Math.floor(Math.random() * 180) : 0,
      });
    }
    return out;
  };

  const enrichedBase = (extra) => ({
    organizer: organizer._id,
    organization: org._id,
    contactEmail: "hello@eventnexus.dev",
    contactPhone: "+977-1-5551234",
    website: "https://eventnexus.dev",
    requirements: "Bring a laptop and a notebook. Doors open 30 minutes early.",
    refundPolicy: "Free cancellation up to 48 hours before the event. Paid tickets are refunded via the original payment rail.",
    tags: ["Recommended", "Kathmandu"],
    ...extra,
  });

  const authoredEventDefs = [
    {
      // 0 — upcoming, free: everyone attends
      title: "Tech Conference 2026",
      description: "A full day of talks on AI, web, and cloud engineering with five hands-on session tracks.",
      date: new Date(now + 14 * day),
      venue: "Grand Hall, Kathmandu",
      coordinates: { lat: 27.7125, lng: 85.32 },
      type: "In-person",
      category: "Technology",
      capacity: 300,
      price: { amount: 0, currency: "NPR" },
      status: "Upcoming",
      tags: ["Recommended", "Technology", "AI"],
      highlights: [
        "Keynote by AI research leads working in the region",
        "Hands-on workshops for React, cloud, and data tracks",
        "Networking lunch with startups and hiring teams",
      ],
      agenda: [
        { time: "09:00", title: "Registration & breakfast", description: "Badge pickup and mingle with coffee." },
        { time: "10:00", title: "Keynote: The state of AI in 2026", description: "Where applied AI is heading this year." },
        { time: "12:00", title: "Workshop tracks", description: "React, cloud engineering, and data-viz labs." },
        { time: "16:00", title: "Closing panel & happy hour", description: "Organizers, speakers, and demo stations." },
      ],
      speakers: [
        { name: "Anisha Karki", role: "AI Research Lead", bio: "Builds production LLM systems; previously at a Hackathons for local startups." },
        { name: "Rohan Shrestha", role: "Cloud Architect", bio: "10+ years designing resilient cloud platforms for Nepali fintechs." },
        { name: "Dr. Maya Tamang", role: "Data Scientist", bio: "PhD in ML, works on recommendation systems for the region." },
        { name: "Dinesh Jha", role: "VP Engineering", bio: "Scales payment platforms handling millions of daily transactions." },
      ],
    },
    {
      // 1 — upcoming, paid NPR 500
      title: "Startup Networking Night",
      description: "Meet founders, investors, and builders over drinks at a rooftop lounge in Lalitpur.",
      date: new Date(now + 3 * day),
      venue: "Rooftop Lounge, Lalitpur",
      coordinates: { lat: 27.6667, lng: 85.3167 },
      type: "Hybrid",
      category: "Business",
      capacity: 120,
      price: { amount: 500, currency: "NPR" },
      status: "Upcoming",
      tags: ["Startups", "Networking"],
      highlights: [
        "Speed networking with curated 1:1 matches",
        "Fireside chat with regional seed investors",
        "Open-mic demo slots for early-stage founders",
      ],
      agenda: [
        { time: "17:00", title: "Doors open", description: "Welcome drink and name badges." },
        { time: "17:30", title: "Speed networking", description: "8 rounds x 4 minutes of curated intros." },
        { time: "18:30", title: "Fireside chat: raising in 2026", description: "Seed fund partners on term sheets and traction." },
      ],
      speakers: [
        { name: "Kushal Pradhan", role: "Startup Advisor", bio: "Angel investor focused on early-stage Nepali founders." },
        { name: "Srijan Joshi", role: "Capital Partner", bio: "Runs a seed fund; backed 30+ local startups." },
      ],
    },
    {
      // 2 — live now, paid NPR 1500, partially checked in
      title: "Live Music Festival",
      description: "An evening of live performances happening right now at the open-air amphitheatre in Bhaktapur.",
      date: new Date(now - 2 * 60 * 60 * 1000),
      venue: "Open Air Amphitheatre, Bhaktapur",
      coordinates: { lat: 27.671, lng: 85.4298 },
      type: "In-person",
      category: "Music",
      capacity: 500,
      price: { amount: 1500, currency: "NPR" },
      status: "Live",
      tags: ["Music", "Live"],
      highlights: [
        "Headline set from the region's top indie acts",
        "Local food and craft stalls around the stage",
        "Accoustic after-party on the lawn",
      ],
      agenda: [
        { time: "18:00", title: "Opening act", description: "Local emerging acoustic duo." },
        { time: "19:30", title: "Headline performance", description: "Main stage, full production." },
        { time: "21:30", title: "Encore & after-party", description: "DJ set under the stars." },
      ],
      speakers: [
        { name: "Lhamo Sherpa", role: "Founder & Musician", bio: "Singer-songwriter blending folk and modern indie styles." },
        { name: "Bipin Rawal", role: "Guitarist", bio: "Session musician and producer, tours across the valley." },
        { name: "Trishna Basnet", role: "Jazz Vocalist", bio: "Performs weekly jazz standards across valley venues." },
      ],
    },
    {
      // 3 — past, free: ML workshop (feedback anchor)
      title: "Intro to Machine Learning Workshop",
      description: "Hands-on beginner workshop on ML fundamentals with Jupyter labs.",
      date: new Date(now - 20 * day),
      venue: "Innovation Lab",
      type: "Virtual",
      category: "Technology",
      capacity: 80,
      price: { amount: 0, currency: "NPR" },
      status: "Past",
      tags: ["Technology", "Workshop"],
      agenda: [
        { time: "10:00", title: "ML fundamentals", description: "Linear models and evaluation." },
        { time: "14:00", title: "Build a classifier", description: "Guided notebook session." },
      ],
      speakers: [
        { name: "Dr. Maya Tamang", role: "Data Scientist", bio: "PhD in ML, works on recommendation systems for the region." },
      ],
    },
    {
      // 4 — past, free
      title: "Startup Pitch Night",
      description: "Local founders pitch to investors in front of a live panel.",
      date: new Date(now - 35 * day),
      venue: "Yala House",
      type: "In-person",
      category: "Business",
      capacity: 60,
      price: { amount: 0, currency: "NPR" },
      status: "Past",
      speakers: [
        { name: "Srijan Joshi", role: "Capital Partner", bio: "Runs a seed fund; backed 30+ local startups." },
        { name: "Gaurav Malla", role: "Investor", bio: "Focus on SaaS and marketplaces out of Kathmandu." },
      ],
    },
    {
      // 5 — past, paid NPR 800
      title: "Web Dev Bootcamp",
      description: "Two-day intensive on full-stack web development with a capstone project.",
      date: new Date(now - 55 * day),
      venue: "Innovation Lab",
      type: "In-person",
      category: "Technology",
      capacity: 40,
      price: { amount: 800, currency: "NPR" },
      status: "Past",
      speakers: [
        { name: "Esther Luitel", role: "Educator", bio: "Teaches JavaScript to 5,000+ students online each year." },
      ],
    },
    {
      // 6 — past, paid NPR 700
      title: "Jazz Under the Stars",
      description: "Outdoor jazz evening with four live acts.",
      date: new Date(now - 75 * day),
      venue: "Open Air Amphitheatre, Bhaktapur",
      type: "In-person",
      category: "Music",
      capacity: 200,
      price: { amount: 700, currency: "NPR" },
      status: "Past",
      speakers: [
        { name: "Trishna Basnet", role: "Jazz Vocalist", bio: "Performs weekly jazz standards across valley venues." },
      ],
    },
    {
      // 7 — past, free
      title: "Design Sprint Workshop",
      description: "Hands-on five-phase design sprint for product teams.",
      date: new Date(now - 95 * day),
      venue: "Yala House",
      type: "Virtual",
      category: "Design",
      capacity: 50,
      price: { amount: 0, currency: "NPR" },
      status: "Past",
      speakers: [
        { name: "Sarina Oli", role: "UX Consultant", bio: "Design systems specialist for product teams." },
      ],
    },
    {
      // 8 — past, paid NPR 900
      title: "Wellness & Yoga Retreat",
      description: "Weekend retreat of yoga, meditation, and wellness talks.",
      date: new Date(now - 115 * day),
      venue: "Rooftop Lounge, Lalitpur",
      type: "In-person",
      category: "Health",
      capacity: 30,
      price: { amount: 900, currency: "NPR" },
      status: "Past",
      speakers: [
        { name: "Anu Shrestha", role: "Wellness Facilitator", bio: "Yoga teacher and wellness retreat organizer." },
      ],
    },
  ];

  const additionalEvents = generateEvents({ organizer, org, count: 100 });
  // insertMany does NOT run pre('save') hooks, so the hook that mirrors
  // lat/lng into the GeoJSON point (coordinates.geo) never fires here. Every
  // seeded event was therefore invisible to the 2dsphere proximity query,
  // and "new event near you" alerts silently never went out. Build the point
  // explicitly rather than switching to per-document saves.
  const withGeoPoint = (e) =>
    e.coordinates?.lat != null && e.coordinates?.lng != null
      ? {
          ...e,
          coordinates: {
            ...e.coordinates,
            geo: { type: "Point", coordinates: [e.coordinates.lng, e.coordinates.lat] },
          },
        }
      : e;

  const events = await Event.insertMany(
    [...authoredEventDefs.map((def) => enrichedBase(def)), ...additionalEvents].map(withGeoPoint)
  );
  // genEvents[i] === events[9 + i] (first nine slots are the authored ones).
  console.log(`✓ Created ${events.length} events`);

  // --- Event sessions -------------------------------------------------------
  // Track times relative to each event's date. Overlap guard requires
  // distinct tracks when sessions run concurrently.
  const sessionDefs = [
    { eventIdx: 0, track: "Keynote", title: "Opening keynote: The state of AI in 2026", start: "10:00", end: "10:50", location: "Main Hall", spe: ["Anisha Karki"], status: "scheduled" },
    { eventIdx: 0, track: "AI", title: "Building with LLMs in production", start: "11:10", end: "12:00", location: "Main Hall", spe: ["Anisha Karki", "Dr. Maya Tamang"], status: "scheduled" },
    { eventIdx: 0, track: "Cloud", title: "Resilient cloud architecture", start: "12:00", end: "12:50", location: "Lab A", spe: ["Rohan Shrestha"], status: "scheduled" },
    { eventIdx: 0, track: "Payments", title: "Scaling payment platforms", start: "14:00", end: "14:50", location: "Lab B", spe: ["Dinesh Jha"], status: "scheduled" },
    { eventIdx: 0, track: "Panel", title: "Closing panel & demo stations", start: "16:00", end: "17:00", location: "Main Hall", spe: ["Rohan Shrestha", "Anisha Karki"], status: "scheduled" },
    { eventIdx: 1, track: "Networking", title: "Speed networking rounds", start: "17:30", end: "18:15", location: "Rooftop", spe: [], status: "scheduled" },
    { eventIdx: 1, track: "Talk", title: "Fireside chat: raising in 2026", start: "18:30", end: "19:15", location: "Rooftop", spe: ["Kushal Pradhan", "Srijan Joshi"], status: "scheduled" },
    { eventIdx: 2, track: "Stage", title: "Opening act", start: "18:00", end: "18:40", location: "Main Stage", spe: ["Bipin Rawal"], status: "completed" },
    { eventIdx: 2, track: "Stage", title: "Headline performance", start: "19:30", end: "21:00", location: "Main Stage", spe: ["Lhamo Sherpa", "Trishna Basnet"], status: "live" },
    { eventIdx: 2, track: "After-party", title: "Encore DJ set", start: "21:30", end: "23:00", location: "Lawn", spe: [], status: "scheduled" },
    { eventIdx: 3, track: "Core", title: "ML fundamentals", start: "10:00", end: "12:00", location: "Virtual", spe: ["Dr. Maya Tamang"], status: "completed" },
    { eventIdx: 3, track: "Core", title: "Build a classifier lab", start: "14:00", end: "16:00", location: "Virtual", spe: ["Dr. Maya Tamang"], status: "completed" },
    { eventIdx: 4, track: "Main", title: "Pitch night live", start: "18:00", end: "20:00", location: "Yala House", spe: ["Srijan Joshi", "Gaurav Malla"], status: "completed" },
    { eventIdx: 5, track: "Day 1", title: "Full-stack fundamentals", start: "09:00", end: "17:00", location: "Innovation Lab", spe: ["Esther Luitel"], status: "completed" },
    { eventIdx: 5, track: "Day 2", title: "Capstone sprint", start: "09:00", end: "17:00", location: "Innovation Lab", spe: ["Esther Luitel"], status: "completed" },
    { eventIdx: 6, track: "Stage", title: "Jazz quartet set", start: "19:00", end: "21:30", location: "Amphitheatre", spe: ["Trishna Basnet"], status: "completed" },
    { eventIdx: 7, track: "Sprint", title: "Five-phase design sprint", start: "10:00", end: "16:00", location: "Virtual", spe: ["Sarina Oli"], status: "completed" },
    { eventIdx: 8, track: "Retreat", title: "Yoga & meditation circle", start: "07:00", end: "16:00", location: "Rooftop Lounge", spe: ["Anu Shrestha"], status: "completed" },
  ];

  const sessionDocs = [];
  for (const sd of sessionDefs) {
    const ev = events[sd.eventIdx];
    const [sh, sm] = sd.start.split(":").map(Number);
    const [eh, em] = sd.end.split(":").map(Number);
    const startTime = new Date(ev.date);
    startTime.setHours(sh, sm, 0, 0);
    const endTime = new Date(ev.date);
    endTime.setHours(eh, em, 0, 0);
    const doc = await EventSession.create({
      event: ev._id,
      organization: org._id,
      title: sd.title,
      track: sd.track,
      startTime,
      endTime,
      location: sd.location,
      speakers: sd.spe.map((n) => sp[n]).filter(Boolean),
      status: sd.status,
      isPublic: true,
    });
    sessionDocs.push(doc);
  }
  console.log(`✓ Created ${sessionDocs.length} event sessions`);

  // --- Tickets ---------------------------------------------------------------
  // Realistic registration mesh:
  //  - Every attendee joins Tech Conference 2026 (upcoming, free).
  //  - Paid upcoming/live events get partial uptake, all with payment records
  //    (eSewa or Stripe rail), a few pending, a few refunded/cancelled.
  //  - Past events are fully checked in so feedback + analytics have signal.
  //  - A rotating set of generated upcoming events gets everyone involved.
  const rng = seededRand(0xc0ffee);
  const pick = (arr) => arr[Math.floor(rng() * arr.length)];

  // [attendeeIndex, status] for past-event attendance (60% of attendees attend each)
  const attendedPast = (aIdx, seed) => (seededRand(seed * 7919 + aIdx)() < 0.6);

  const makeTicket = async ({ eventDoc, user, status = "valid", payment = null, checkedInBy = null }) => {
    if (!eventDoc) return null;
    const doc = new Ticket({
      event: eventDoc._id,
      attendee: user._id,
      organization: org._id,
      qrToken: "placeholder",
      status,
      payment: payment || { status: "none" },
    });
    doc.qrToken = signTicketToken(doc._id.toString(), eventDoc._id.toString(), user._id.toString());
    if (status === "checked-in") {
      doc.checkedInAt = checkedInBy
        ? new Date(new Date(eventDoc.date).getTime() + 2 * 60 * 60 * 1000)
        : new Date();
      doc.checkedInBy = checkedInBy;
    }
    if (status === "cancelled") doc.cancelledAt = new Date(now - 10 * day);
    await doc.save();
    return doc;
  };

  // Build payment block for a priced event. ~65/35 eSewa/Stripe split; rare
  // pending (eSewa started but not confirmed); a refunded sample.
  const paymentFor = (eventDoc, roll) => {
    if (!eventDoc.price?.amount) return { status: "none" };
    if (roll < 0.04) return { status: "pending", provider: "esewa", amount: eventDoc.price.amount, currency: "NPR", esewaTransactionUuid: crypto.randomUUID() };
    if (roll < 0.65) {
      return { status: "paid", provider: "esewa", amount: eventDoc.price.amount, currency: "NPR", esewaTransactionUuid: crypto.randomUUID(), esewaRefId: `REF-${Math.floor(rng() * 1e8).toString().padStart(8, "0")}` };
    }
    // Stripe rail — charged in converted USD, as the real checkout does.
    return {
      status: "paid",
      provider: "stripe",
      amount: Math.round((eventDoc.price.amount / NPR_TO_USD) * 100) / 100,
      currency: "USD",
      stripePaymentIntentId: `pi_${crypto.randomBytes(12).toString("hex")}`,
      stripeSessionId: `cs_${crypto.randomBytes(12).toString("hex")}`,
    };
  };

  const counts = new Map(); // eventId -> registered count (valid/checked-in only)

  // 1) Authored events 0..2 (upcoming/live): everyone or most everyone.
  for (const [eIdx, frac, checkinFrac] of [[0, 1, 0], [1, 0.7, 0], [2, 0.62, 0.4]]) {
    const ev = events[eIdx];
    for (let a = 0; a < attendees.length; a++) {
      if (rng() > frac) continue;
      const u = attendees[a];
      const roll = rng();
      const status = checkinFrac > 0 && rng() < checkinFrac ? "checked-in" : "valid";
      await makeTicket({ eventDoc: ev, user: u, status, payment: paymentFor(ev, roll), checkedInBy: organizer._id });
      counts.set(ev._id.toString(), (counts.get(ev._id.toString()) || 0) + 1);
    }
  }

  // 2) Past authored events 3..8: subset attends, all checked in, plus a
  //    couple of cancelled/refunded tickets sprinkled on the earlier ones.
  for (const eIdx of [3, 4, 5, 6, 7, 8]) {
    const ev = events[eIdx];
    for (let a = 0; a < attendees.length; a++) {
      if (!attendedPast(a, eIdx)) continue;
      const u = attendees[a];
      const roll = rng();
      await makeTicket({ eventDoc: ev, user: u, status: "checked-in", payment: paymentFor(ev, roll), checkedInBy: organizer._id });
      counts.set(ev._id.toString(), (counts.get(ev._id.toString()) || 0) + 1);
    }
    // One cancelled + refunded ticket per past paid event (realistic churn).
    // The canceller is picked from attendees who did NOT attend, so the
    // cancelled ticket can never collide with an active one on the same
    // (event, attendee) pair.
    if (ev.price?.amount) {
      const nonAttending = attendees.filter((_, a) => !attendedPast(a, eIdx));
      const canceller = nonAttending[Math.floor(rng() * nonAttending.length)];
      await makeTicket({
        eventDoc: ev,
        user: canceller,
        status: "cancelled",
        payment: {
          status: "refunded",
          provider: "esewa",
          amount: ev.price.amount,
          currency: "NPR",
          amountRefunded: ev.price.amount,
          esewaTransactionUuid: crypto.randomUUID(),
          esewaRefId: `REF-${Math.floor(rng() * 1e8).toString().padStart(8, "0")}`,
        },
      });
    }
  }

  // 3) Generated upcoming/live events: every attendee joins ~5 rotating ones.
  const genEvents = events.slice(9);
  const openGens = genEvents.filter((e) => e.status === "Upcoming" || e.status === "Live");
  if (openGens.length < 24) {
    console.error("✗ Not enough open generated events for the ticket mesh — rerun the seed.");
  }
  const pickedGen = new Set();
  for (let a = 0; a < attendees.length; a++) {
    const u = attendees[a];
    // Stride of 5 (± < 20) can never collide into the same event for a user
    // when the pool has ≥ 21 entries, which is guaranteed above.
    for (let k = 0; k < 5; k++) {
      const idx = (a * 7 + k * 5) % openGens.length;
      const ev = openGens[idx];
      if (!ev || ev.registered + (counts.get(ev._id.toString()) || 0) >= ev.capacity) continue;
      const roll = rng();
      await makeTicket({ eventDoc: ev, user: u, status: "valid", payment: paymentFor(ev, roll) });
      counts.set(ev._id.toString(), (counts.get(ev._id.toString()) || 0) + 1);
      pickedGen.add(ev._id.toString());
    }
  }

  // Sync event.registered with the real ticket counts (the ledger and roster
  // are the sources of truth; past generated events keep their aggregate
  // historical numbers, which stand in for pre-platform registrations).
  await Promise.all(
    [...counts].map(([id, n]) => Event.updateOne({ _id: id }, { $set: { registered: n } }))
  );

  const totalTickets = counts.size ? [...counts.values()].reduce((a, b) => a + b, 0) : 0;
  console.log(`✓ Created ${totalTickets} tickets across ${counts.size} events (payments: eSewa/Stripe/pending/refunded)`);

  // --- Feedback -------------------------------------------------------------
  // Everyone checked into a past event leaves feedback; sentiment is
  // classified by the same pipeline used at runtime.
  const pastEventIdxs = [3, 4, 5, 6, 7, 8];
  let feedbackCreated = 0;
  for (const eIdx of pastEventIdxs) {
    const ev = events[eIdx];
    for (let a = 0; a < attendees.length; a++) {
      if (!attendedPast(a, eIdx)) continue;
      const u = attendees[a];
      const rating = pick([5, 5, 5, 4, 4, 4, 4, 3, 3, 2]);
      const comment = pick(COMMENT_POOL[rating]);
      const { sentiment, sentimentScore } = classifySentiment({ rating, comment });
      await Feedback.create({
        event: ev._id,
        attendee: u._id,
        organization: org._id,
        rating,
        comment,
        sentiment,
        sentimentScore,
      });
      feedbackCreated++;
    }
  }
  console.log(`✓ Created ${feedbackCreated} feedback entries (with sentiment)`);

  // --- Notifications ---------------------------------------------------------
  const notifications = [];
  for (const eIdx of [0, 1, 2]) {
    const ev = events[eIdx];
    const nAttendees = counts.get(ev._id.toString()) || 0;
    if (nAttendees === 0) continue;
    for (let a = 0; a < attendees.length; a++) {
      const u = attendees[a];
      // Registration confirmation for the attendee.
      notifications.push({
        recipient: u._id,
        organization: org._id,
        type: "registration",
        title: "Registration confirmed",
        message: `You're registered for "${ev.title}".`,
        event: ev._id,
        link: "/my-tickets",
        read: false,
      });
    }
    // Reminder for upcoming events (the live festival skips the "soon" note).
    if (ev.status !== "Live") {
      notifications.push({
        recipient: organizer._id,
        organization: org._id,
        type: "reminder",
        title: "Event reminder",
        message: `"${ev.title}" is happening soon — ${nAttendees} attendees registered.`,
        event: ev._id,
        read: false,
      });
    }
    // Organizer summary.
    notifications.push({
      recipient: organizer._id,
      organization: org._id,
      type: "system",
      title: "New registrations",
      message: `${nAttendees} people registered for "${ev.title}".`,
      event: ev._id,
      link: "/events",
      read: false,
    });
  }

  // Check-in notifications for the attendees already scanned into the live
  // festival — proves the notification center's check-in flow.
  let checkedInLive = 0;
  for (let a = 0; a < attendees.length && checkedInLive < 6; a++) {
    if (rng() < 0.4) continue;
    const u = attendees[a];
    notifications.push({
      recipient: u._id,
      organization: org._id,
      type: "check-in",
      title: "You're checked in",
      message: `Welcome to "${events[2].title}" — enjoy the show!`,
      event: events[2]._id,
      link: "/my-tickets",
      read: false,
    });
    checkedInLive++;
  }

  await Notification.insertMany(notifications);
  console.log(`✓ Created ${notifications.length} notifications`);

  // --- Summary -------------------------------------------------------------
  console.log("\n─────────────────────────────────────────");
  console.log(" Seed complete. Login credentials:");
  console.log("─────────────────────────────────────────");
  console.log(` System admin  admin@eventnexus.dev      / ${DEMO_PASSWORD}`);
  console.log(` Org admin     orgadmin@eventnexus.dev   / ${DEMO_PASSWORD}`);
  console.log(` Organizer     organizer@eventnexus.dev  / ${DEMO_PASSWORD}`);
  console.log(` Attendee      attendee@eventnexus.dev   / ${DEMO_PASSWORD}`);
  console.log(` Attendee      priya@eventnexus.dev      / ${DEMO_PASSWORD}`);
  console.log(` Attendee      sam@eventnexus.dev        / ${DEMO_PASSWORD}`);
  console.log(` + ${attendees.length - 3} more attendees (firstname@eventnexus.dev) / ${DEMO_PASSWORD}`);
  console.log("─────────────────────────────────────────\n");

  await mongoose.disconnect();
  process.exit(0);
}

seed().catch(async (err) => {
  console.error("✗ Seed failed:", err.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});