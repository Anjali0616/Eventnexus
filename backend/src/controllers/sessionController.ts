import { Request, Response } from "express";
import EventSession from "../models/EventSession";
import Speaker from "../models/Speaker";
import Event from "../models/Event";
import { canManageEvent } from "./eventController";
import { buildSearch, buildFilters } from "../utils/query";

const checkTimeConflict = async (eventId, track, startTime, endTime, excludeId = null) => {
  const query = {
    event: eventId,
    track,
    status: { $ne: "cancelled" },
    $or: [
      { startTime: { $lt: endTime }, endTime: { $gt: startTime } },
    ],
  };
// @ts-ignore
  if (excludeId) query._id = { $ne: excludeId };
  const conflict = await EventSession.findOne(query).lean();
  return conflict;
};

export const createSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const event = await Event.findById(req.params.eventId);
    if (!event) {
      return void res.status(404).json({ message: "Event not found" });
    }
    if (!canManageEvent(event, req.user)) {
      return void res.status(403).json({ message: "Not authorized" });
    }

    const { title, description, track, startTime, endTime, location, speakers, capacity, isPublic } = req.body;

    // Validate times
    const start = new Date(startTime);
    const end = new Date(endTime);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return void res.status(400).json({ message: "Invalid startTime or endTime" });
    }
    if (start >= end) {
      return void res.status(400).json({ message: "endTime must be after startTime" });
    }
    if (start < event.date) {
      return void res.status(400).json({ message: "Session cannot start before event date" });
    }

    // Check track conflict
    const conflict = await checkTimeConflict(event._id, track, start, end);
    if (conflict) {
      return void res.status(400).json({ message: `Session overlaps with "${conflict.title}" in track "${track}"` });
    }

    // Validate speakers exist and belong to same organization
    if (speakers && speakers.length > 0) {
      const validSpeakers = await Speaker.find({ _id: { $in: speakers }, organization: event.organization }).lean();
      if (validSpeakers.length !== speakers.length) {
        return void res.status(400).json({ message: "One or more speakers not found or not in this organization" });
      }
    }

    const session = await EventSession.create({
      event: event._id,
      organization: event.organization,
      title,
      description: description || "",
      track: track || "",
      startTime: start,
      endTime: end,
      location: location || "",
      speakers: speakers || [],
      capacity: capacity || 0,
      isPublic: isPublic !== false,
      status: "scheduled",
    });

    await session.populate("speakers", "name title company photoUrl");
    res.status(201).json({ session });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

export const getEventSessions = async (req: Request, res: Response): Promise<void> => {
  try {
    const event = await Event.findById(req.params.eventId);
    if (!event) {
      return void res.status(404).json({ message: "Event not found" });
    }

    // Public access for event attendees/organizers
    const isManager = canManageEvent(event, req.user);
    const filter: any = { event: event._id };
    if (!isManager) filter.isPublic = true;

    // Advanced search + filters: ?search (title/description/location),
    // ?track, ?status (scheduled/cancelled/…).
    Object.assign(
      filter,
      buildSearch(req.query.search, ["title", "description", "location"]),
      buildFilters(req.query, ["track", "status"])
    );

    const sessions = await EventSession.find(filter)
      .populate("speakers", "name title company photoUrl")
      .sort({ startTime: 1, track: 1 })
      .lean();

    // Group by track for UI
    const byTrack = sessions.reduce((acc, s) => {
      const track = s.track || "General";
      if (!acc[track]) acc[track] = [];
      acc[track].push(s);
      return acc;
    }, {});

    res.json({ sessions, byTrack, canManage: isManager });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

export const getSessionById = async (req: Request, res: Response): Promise<void> => {
  try {
    const session = await EventSession.findById(req.params.id).populate("speakers", "name title company photoUrl bio socialLinks").lean();
    if (!session) {
      return void res.status(404).json({ message: "Session not found" });
    }
    const event = await Event.findById(session.event).lean();
    const canManage = event ? canManageEvent(event, req.user) : false;
    if (!session.isPublic && !canManage) {
      return void res.status(403).json({ message: "Not authorized" });
    }
    res.json({ session, canManage });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

export const updateSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const session = await EventSession.findById(req.params.id);
    if (!session) {
      return void res.status(404).json({ message: "Session not found" });
    }
    const event = await Event.findById(session.event);
    if (!canManageEvent(event, req.user)) {
      return void res.status(403).json({ message: "Not authorized" });
    }

    const { title, description, track, startTime, endTime, location, speakers, capacity, isPublic, status } = req.body;

    // Validate times if changed
    if (startTime || endTime) {
      const start = startTime ? new Date(startTime) : session.startTime;
      const end = endTime ? new Date(endTime) : session.endTime;
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return void res.status(400).json({ message: "Invalid startTime or endTime" });
      }
      if (start >= end) {
        return void res.status(400).json({ message: "endTime must be after startTime" });
      }
      // Check track conflict
      const checkTrack = track || session.track;
      const conflict = await checkTimeConflict(event._id, checkTrack, start, end, session._id);
      if (conflict) {
        return void res.status(400).json({ message: `Session overlaps with "${conflict.title}" in track "${checkTrack}"` });
      }
      session.startTime = start;
      session.endTime = end;
    }

    // Validate speakers
    if (speakers) {
      const validSpeakers = await Speaker.find({ _id: { $in: speakers }, organization: event.organization }).lean();
      if (validSpeakers.length !== speakers.length) {
        return void res.status(400).json({ message: "One or more speakers not found or not in this organization" });
      }
      session.speakers = speakers;
    }

    // Update fields
    if (title !== undefined) session.title = title;
    if (description !== undefined) session.description = description || "";
    if (track !== undefined) session.track = track || "";
    if (location !== undefined) session.location = location || "";
    if (capacity !== undefined) session.capacity = capacity || 0;
    if (isPublic !== undefined) session.isPublic = isPublic;
    if (status !== undefined) session.status = status;

    await session.save();
    await session.populate("speakers", "name title company photoUrl");
    res.json({ session });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

export const deleteSession = async (req: Request, res: Response): Promise<void> => {
  try {
    const session = await EventSession.findById(req.params.id);
    if (!session) {
      return void res.status(404).json({ message: "Session not found" });
    }
    const event = await Event.findById(session.event);
    if (!canManageEvent(event, req.user)) {
      return void res.status(403).json({ message: "Not authorized" });
    }
    await session.deleteOne();
    res.json({ message: "Session deleted" });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

const _controllerExports = { createSession, getEventSessions, getSessionById, updateSession, deleteSession };
export default _controllerExports;
// CJS interop for require() - keep compatibility
// @ts-ignore
module.exports = _controllerExports;
// @ts-ignore
module.exports.default = _controllerExports;