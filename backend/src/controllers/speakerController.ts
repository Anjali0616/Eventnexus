import { Request, Response } from "express";
import Speaker from "../models/Speaker";
import { canManageEvent } from "./eventController";
import Event from "../models/Event";

import { parsePagination, buildSearch, parseSort, paginate } from "../utils/query";

export const createSpeaker = async (req: Request, res: Response): Promise<void> => {
  try {
    const { name, email, title, company, bio, photoUrl, socialLinks, isExternal } = req.body;
    if (!name || !name.trim()) {
      return void res.status(400).json({ message: "Speaker name is required" });
    }

    // Determine organization from user (org admin) or event
    let organization = req.user.organization;
    if (!organization && req.body.eventId) {
      const event = await Event.findById(req.body.eventId);
      if (event) organization = event.organization;
    }
    if (!organization) {
      return void res.status(400).json({ message: "Organization context required" });
    }

    const speaker = await Speaker.create({
      organization,
      name: name.trim(),
      email: email?.trim().toLowerCase() || "",
      title: title?.trim() || "",
      company: company?.trim() || "",
      bio: bio?.trim() || "",
      photoUrl: photoUrl || "",
      socialLinks: socialLinks || {},
      isExternal: isExternal !== false,
    });

    res.status(201).json({ speaker });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

export const getOrganizationSpeakers = async (req: Request, res: Response): Promise<void> => {
  try {
    const organization = req.user.organization;
    if (!organization) {
      // Attendee without org — return empty list rather than 403 so the
      // Event Details page (useOrganizationSpeakers) does not break.
      // Organizer / org_admin without org is a misconfiguration and must
      // still be rejected with 403 to preserve tenant isolation.
      if (req.user.role === "attendee") {
        return void res.json({ speakers: [], pagination: { page: 1, limit: 20, total: 0, pages: 0 } });
      }
      return void res.status(403).json({ message: "User has no organization assigned" });
    }
    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 20 });

    const filter: any = {
      organization,
      ...buildSearch(req.query.search, ["name", "title", "company", "email"]),
    };
    // isExternal is a boolean field — convert the query string explicitly.
    if (req.query.isExternal === "true") filter.isExternal = true;
    else if (req.query.isExternal === "false") filter.isExternal = false;

    const sort = parseSort(req.query.sort, ["name", "createdAt"], { name: 1 });

    const { data, pagination } = await paginate(Speaker, {
      filter,
      page,
      limit,
      skip,
      sort,
    });
    res.json({ speakers: data, pagination });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

export const getSpeakerById = async (req: Request, res: Response): Promise<void> => {
  try {
    const speaker = await Speaker.findById(req.params.id).lean();
    if (!speaker) {
      return void res.status(404).json({ message: "Speaker not found" });
    }
    // Attendee without org is allowed to view public speaker data; do not 403.
    // Organizer/org_admin without org is still rejected (misconfiguration).
    if (req.user.organization) {
      if (speaker.organization.toString() !== req.user.organization.toString()) {
        return void res.status(403).json({ message: "Not authorized" });
      }
    } else if (req.user.role !== "attendee") {
      return void res.status(403).json({ message: "User has no organization assigned" });
    }
    res.json({ speaker });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

export const updateSpeaker = async (req: Request, res: Response): Promise<void> => {
  try {
    const speaker = await Speaker.findById(req.params.id);
    if (!speaker) {
      return void res.status(404).json({ message: "Speaker not found" });
    }
    if (speaker.organization.toString() !== req.user.organization?.toString()) {
      return void res.status(403).json({ message: "Not authorized" });
    }

    const { name, email, title, company, bio, photoUrl, socialLinks, isExternal } = req.body;
    if (name !== undefined) speaker.name = name.trim();
    if (email !== undefined) speaker.email = email?.trim().toLowerCase() || "";
    if (title !== undefined) speaker.title = title?.trim() || "";
    if (company !== undefined) speaker.company = company?.trim() || "";
    if (bio !== undefined) speaker.bio = bio?.trim() || "";
    if (photoUrl !== undefined) speaker.photoUrl = photoUrl || "";
    if (socialLinks !== undefined) speaker.socialLinks = socialLinks || {};
    if (isExternal !== undefined) speaker.isExternal = isExternal;

    await speaker.save();
    res.json({ speaker });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

export const deleteSpeaker = async (req: Request, res: Response): Promise<void> => {
  try {
    const speaker = await Speaker.findById(req.params.id);
    if (!speaker) {
      return void res.status(404).json({ message: "Speaker not found" });
    }
    if (speaker.organization.toString() !== req.user.organization?.toString()) {
      return void res.status(403).json({ message: "Not authorized" });
    }
    await speaker.deleteOne();
    res.json({ message: "Speaker deleted" });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

const _controllerExports = { createSpeaker, getOrganizationSpeakers, getSpeakerById, updateSpeaker, deleteSpeaker };
export default _controllerExports;
// CJS interop for require() - keep compatibility
// @ts-ignore
module.exports = _controllerExports;
// @ts-ignore
module.exports.default = _controllerExports;