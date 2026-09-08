import { Request, Response } from "express";
import Event from "../models/Event";
import Ticket from "../models/Ticket";

export const getEventNetworking = async (req: Request, res: Response): Promise<void> => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) {
      return void res.status(404).json({ message: "Event not found" });
    }

    const myTicket = await Ticket.findOne({
      event: event._id,
      attendee: req.user._id,
      status: { $ne: "cancelled" },
    });
    if (!myTicket) {
      return void res.status(403).json({ message: "Register for this event to see networking suggestions" });
    }

    const myTickets = await Ticket.find({
      attendee: req.user._id,
      status: { $ne: "cancelled" },
    }).populate("event", "category");
// @ts-ignore
    const myCategories = new Set(myTickets.filter((t) => t.event).map((t) => t.event.category));

    const otherTickets = await Ticket.find({
      event: event._id,
      attendee: { $ne: req.user._id },
      status: { $ne: "cancelled" },
    }).populate("attendee", "name");

    const attendeeIds = otherTickets.map((t) => t.attendee?._id).filter(Boolean);
    const theirTickets = await Ticket.find({
      attendee: { $in: attendeeIds },
      status: { $ne: "cancelled" },
    }).populate("event", "category");

    const categoriesByAttendee: any = {};
    theirTickets.forEach((t) => {
      if (!t.event) return;
      const id = t.attendee.toString();
      if (!categoriesByAttendee[id]) categoriesByAttendee[id] = new Set();
// @ts-ignore
      categoriesByAttendee[id].add(t.event.category);
    });

    const suggestions = otherTickets
      .filter((t) => t.attendee)
      .map((t) => {
        const theirCategories = categoriesByAttendee[t.attendee._id.toString()] || new Set();
        const sharedInterests = [...theirCategories].filter((c) => myCategories.has(c));
        return {
          attendeeId: t.attendee._id,
// @ts-ignore
          name: t.attendee.name,
          sharedInterests,
          matchScore: sharedInterests.length,
        };
      })
      .sort((a, b) => b.matchScore - a.matchScore)
      .slice(0, 20);

    res.json({ suggestions });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

const _controllerExports = { getEventNetworking };
export default _controllerExports;
// CJS interop for require() - keep compatibility
// @ts-ignore
module.exports = _controllerExports;
// @ts-ignore
module.exports.default = _controllerExports;