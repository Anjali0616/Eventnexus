import { Request, Response } from "express";
import CollaborationSuggestion from "../models/CollaborationSuggestion";
import Event from "../models/Event";
import User from "../models/User";
import { scanForSuggestions } from "../utils/collaborationEngine";
import { parsePagination, parseSort, paginate } from "../utils/query";
import { audit } from "../utils/audit";
import { createNotification } from "./notificationController";

const notifyOrgAdmins = async ({ organization, excludeUser, ...payload }) => {
  try {
    const admins = await User.find({
      organization,
      role: "org_admin",
      active: { $ne: false },
      ...(excludeUser ? { _id: { $ne: excludeUser } } : {}),
    })
      .select("_id")
      .lean();
    await Promise.all(
      admins.map((a) =>
// @ts-ignore
        createNotification({
          recipient: a._id,
          organization,
          type: "collaboration",
          link: "/admin/collaboration",
          ...payload,
        })
      )
    );
  } catch (error) {
    console.error("[collaboration] notify failed:", error.message);
  }
};

const POPULATE = [
  { path: "eventA", select: "title date venue category type status capacity organization" },
  { path: "eventB", select: "title date venue category type status capacity organization" },
  { path: "orgA", select: "name city country status" },
  { path: "orgB", select: "name city country status" },
];

// Which side of a suggestion the acting user's organization is, and its
// status field — or null when the caller is neither party (must never act).
const sideFor = (suggestion, user) => {
  if (String(suggestion.orgA) === String(user.organization)) return { side: "A", field: "statusA" };
  if (String(suggestion.orgB) === String(user.organization)) return { side: "B", field: "statusB" };
  return null;
};

// Only organization admins act on behalf of their org; organizers may view
// suggestions involving their org's events but must not decide for it.
const requireOrgAdmin = (user, suggestion) => {
  if (user.role !== "org_admin" || !user.organization) return false;
  return sideFor(suggestion, user) !== null;
};

// Suggestion is closed once a side declined (rejected) or both accepted
// (co-hosted) — nothing more can happen on it.
const isResolved = (suggestion) => suggestion.statusA === "declined" || suggestion.statusB === "declined";
const bothAccepted = (suggestion) =>
  suggestion.statusA === "accepted" && suggestion.statusB === "accepted";

// List suggestions involving the caller's organization, newest first, with
// both events, both orgs, and each side's decision status.
export const listSuggestions = async (req: Request, res: Response): Promise<void> => {
  try {
    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 10 });
    const filter: any = {
      $or: [{ orgA: req.user.organization }, { orgB: req.user.organization }],
    };
    // Newest first. The frontend groups: open (needs a decision) on top,
    // resolved below.
    const sort = parseSort(req.query.sort, ["score", "createdAt"], { createdAt: -1 });

    // Confirmed matches (both accepted) sink to the bottom of the list — the
    // actionable "needs my decision" suggestions stay on top.
    const { data, pagination } = await paginate(CollaborationSuggestion, {
      filter,
      page,
      limit,
      skip,
      sort,
      populate: POPULATE,
    });

    res.json({ suggestions: data, pagination });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

// Manually re-run the match scan for the caller's organization (also runs
// automatically when a new event is created — see eventController).
export const generateSuggestions = async (req: Request, res: Response): Promise<void> => {
  try {
    const { created, skipped } = await scanForSuggestions(req.user.organization);

    // Tell the counterparty orgs a match now exists. The scanning org sees
    // the results in the response; the other side had no signal at all, so
    // a match could sit unseen indefinitely while both events went ahead
    // separately. One notification per partner org, not per suggestion, so
    // a scan that surfaces eight matches with one partner isn't eight alerts.
    const partnerOrgs = new Map();
    for (const s of created) {
      const partner = String(s.orgA?._id ?? s.orgA) === String(req.user.organization)
        ? s.orgB
        : s.orgA;
      const id = String(partner?._id ?? partner);
      partnerOrgs.set(id, (partnerOrgs.get(id) || 0) + 1);
    }
    await Promise.all(
      [...partnerOrgs.entries()].map(([organization, count]) =>
// @ts-ignore
        notifyOrgAdmins({
          organization,
          title: `${count} new collaboration ${count === 1 ? "match" : "matches"}`,
          message: `The AI matcher paired ${count === 1 ? "one of your events" : "some of your events"} with another organization's. Review to consider co-hosting.`,
        })
      )
    );

    audit({
      req,
      user: req.user,
      organization: req.user.organization
        ? { _id: req.user.organization }
        : undefined,
      action: "collab_suggestions_generated",
      resourceType: "Organization",
      resourceId: req.user.organization,
      metadata: { created: created.length, skipped, partnersNotified: partnerOrgs.size },
    });
    res.json({ created, skipped, message: `Found ${created.length} new collaboration matches.` });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

// Accept the suggestion for the caller's organization side. When BOTH sides
// accept, the suggestion resolves: the two events become mutual co-hosts
// (each org is added to the other event's coHostOrganizations), unlocking
// the full collaboration surface — event workspace, attendees, check-in,
// analytics, feedback — for both organizations' admins.
export const acceptSuggestion = async (req: Request, res: Response): Promise<void> => {
  try {
    const suggestion = await CollaborationSuggestion.findById(req.params.id);
    if (!suggestion) {
      return void res.status(404).json({ message: "Suggestion not found" });
    }
    if (!requireOrgAdmin(req.user, suggestion)) {
      return void res.status(403).json({ message: "Only an admin of the involved organizations can respond" });
    }
    if (isResolved(suggestion)) {
      return void res.status(400).json({ message: "This collaboration suggestion is already closed" });
    }

    const mySide = sideFor(suggestion, req.user);
    const myStatus = suggestion[mySide.field];
    if (myStatus === "accepted") {
      return void res.status(400).json({ message: "You have already accepted this suggestion" });
    }
    if (myStatus === "declined") {
      return void res.status(400).json({ message: "You declined this suggestion and cannot reverse it" });
    }

    // Claim this side atomically, conditional on it still being undecided.
    // The previous read-modify-write could interleave: two concurrent
    // requests (a double-click, or both admins of the same org acting at
    // once) each read "suggested", each wrote "accepted", and each then ran
    // the both-accepted branch — pushing the co-host twice and resolving
    // twice. Making the write itself the guard means exactly one request
    // can transition a given side.
    const claimed = await CollaborationSuggestion.findOneAndUpdate(
      { _id: suggestion._id, [mySide.field]: "suggested" },
      { $set: { [mySide.field]: "accepted" } },
      { new: true }
    );
    if (!claimed) {
      return void res.status(409).json({ message: "This suggestion was just updated — reload to see its current state" });
    }

    // Both sides in → establish the mutual co-host link on both events.
    if (bothAccepted(claimed)) {
      const [eventA, eventB] = await Promise.all([
        Event.findById(claimed.eventA).select("_id"),
        Event.findById(claimed.eventB).select("_id"),
      ]);
      if (!eventA || !eventB) {
        return void res.status(404).json({ message: "One of the events no longer exists" });
      }
      // $addToSet is atomic and idempotent — a retry or a concurrent writer
      // can never produce a duplicate co-host entry.
      await Promise.all([
        Event.updateOne({ _id: claimed.eventA }, { $addToSet: { coHostOrganizations: claimed.orgB } }),
        Event.updateOne({ _id: claimed.eventB }, { $addToSet: { coHostOrganizations: claimed.orgA } }),
      ]);
      // Guarded on resolvedOutcome being unset so only the first writer
      // stamps the resolution.
      await CollaborationSuggestion.updateOne(
        { _id: claimed._id, resolvedOutcome: { $exists: false } },
        { $set: { resolvedAt: new Date(), resolvedOutcome: "co-hosted" } }
      );
    }

    const theirOrg = mySide.side === "A" ? claimed.orgB : claimed.orgA;
    if (bothAccepted(claimed)) {
      // Confirmed partnership — tell BOTH sides, including the acting org's
      // other admins, since the co-host link is now live for everyone.
      await Promise.all([
// @ts-ignore
        notifyOrgAdmins({
          organization: theirOrg,
          title: "Co-hosting confirmed",
          message: "Both organizations accepted — you can now manage both events together.",
        }),
        notifyOrgAdmins({
          organization: req.user.organization,
          excludeUser: req.user._id,
          title: "Co-hosting confirmed",
          message: "Both organizations accepted — you can now manage both events together.",
        }),
      ]);
    } else {
      // One side in, waiting on the other — this is the notification whose
      // absence made the handshake un-completable in practice.
// @ts-ignore
      await notifyOrgAdmins({
        organization: theirOrg,
        title: "A partner accepted a collaboration match",
        message: "Another organization accepted an AI collaboration match with one of your events. Review it to start co-hosting.",
      });
    }

    audit({
      req,
      user: req.user,
      organization: { _id: req.user.organization },
      action: "collab_suggestion_accepted",
      resourceType: "CollaborationSuggestion",
      resourceId: claimed._id,
      metadata: { side: mySide.side, outcome: bothAccepted(claimed) ? "co-hosted" : "pending" },
    });

    const populated = await CollaborationSuggestion.findById(suggestion._id).populate(POPULATE);
    res.json({ suggestion: populated });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

// Decline the suggestion for the caller's side. Closes it for good — a
// declined pair is never re-suggested (the engine skips existing pairs).
export const declineSuggestion = async (req: Request, res: Response): Promise<void> => {
  try {
    const suggestion = await CollaborationSuggestion.findById(req.params.id);
    if (!suggestion) {
      return void res.status(404).json({ message: "Suggestion not found" });
    }
    if (!requireOrgAdmin(req.user, suggestion)) {
      return void res.status(403).json({ message: "Only an admin of the involved organizations can respond" });
    }
    if (isResolved(suggestion)) {
      return void res.status(400).json({ message: "This collaboration suggestion is already closed" });
    }

    const mySide = sideFor(suggestion, req.user);
    if (suggestion[mySide.field] === "declined") {
      return void res.status(400).json({ message: "You already declined this suggestion" });
    }
    if (suggestion[mySide.field] === "accepted") {
      return void res.status(400).json({ message: "You already accepted this suggestion — use the co-host list to remove it if needed" });
    }

    // Same atomic claim as accept: the transition is the guard, so a
    // double-click can't resolve the suggestion twice.
    const claimed = await CollaborationSuggestion.findOneAndUpdate(
      { _id: suggestion._id, [mySide.field]: "suggested" },
      {
        $set: {
          [mySide.field]: "declined",
          resolvedAt: new Date(),
          resolvedOutcome: "rejected",
        },
      },
      { new: true }
    );
    if (!claimed) {
      return void res.status(409).json({ message: "This suggestion was just updated — reload to see its current state" });
    }

    // Only worth telling the other side if they were actually waiting on us
    // (they'd already accepted). Announcing a decline to an org that never
    // engaged is noise, not information.
    const theirField = mySide.side === "A" ? "statusB" : "statusA";
    if (claimed[theirField] === "accepted") {
// @ts-ignore
      await notifyOrgAdmins({
        organization: mySide.side === "A" ? claimed.orgB : claimed.orgA,
        title: "Collaboration match declined",
        message: "The other organization declined the collaboration you accepted. No co-hosting link was created.",
      });
    }

    audit({
      req,
      user: req.user,
      organization: { _id: req.user.organization },
      action: "collab_suggestion_declined",
      resourceType: "CollaborationSuggestion",
      resourceId: claimed._id,
      metadata: { side: mySide.side },
    });

    const populated = await CollaborationSuggestion.findById(suggestion._id).populate(POPULATE);
    res.json({ suggestion: populated });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

const _controllerExports = { listSuggestions, generateSuggestions, acceptSuggestion, declineSuggestion };
export default _controllerExports;
// CJS interop for require() - keep compatibility
// @ts-ignore
module.exports = _controllerExports;
// @ts-ignore
module.exports.default = _controllerExports;