import { Request, Response } from "express";
import Event from "../models/Event";
import Ticket from "../models/Ticket";
import Feedback from "../models/Feedback";
import { classifySentiment } from "../utils/sentiment";
import { canManageEvent } from "./eventController";

export const submitFeedback = async (req: Request, res: Response): Promise<void> => {
  try {
    const { rating, comment } = req.body;
    const event = await Event.findById(req.params.id);
    if (!event) {
      return void res.status(404).json({ message: "Event not found" });
    }

    const ticket = await Ticket.findOne({
      event: event._id,
      attendee: req.user._id,
      status: { $ne: "cancelled" },
    });
    if (!ticket) {
      return void res.status(403).json({ message: "You must have registered for this event to leave feedback" });
    }
    if (new Date(event.date) > new Date()) {
      return void res.status(400).json({ message: "Feedback opens once the event has taken place" });
    }

    const { sentiment, sentimentScore } = classifySentiment({ rating, comment });

    const feedback = await Feedback.findOneAndUpdate(
      { event: event._id, attendee: req.user._id },
      {
        event: event._id,
        attendee: req.user._id,
        organization: event.organization,
        rating,
        comment: comment || "",
        sentiment,
        sentimentScore,
      },
      { upsert: true, new: true, runValidators: true }
    );

    res.status(201).json({ feedback });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

export const getMyFeedback = async (req: Request, res: Response): Promise<void> => {
  try {
    const feedback = await Feedback.findOne({
      event: req.params.id,
      attendee: req.user._id,
    });
    res.json({ feedback: feedback || null });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

// Organizer/admin: full feedback list plus an aggregated sentiment breakdown
// for the event's post-event insights panel.
export const getEventFeedback = async (req: Request, res: Response): Promise<void> => {
  try {
    const event = await Event.findById(req.params.id);
    if (!event) {
      return void res.status(404).json({ message: "Event not found" });
    }
    if (!canManageEvent(event, req.user)) {
      return void res.status(403).json({ message: "Not authorized" });
    }

    const [feedback, summary] = await Promise.all([
      Feedback.find({ event: event._id })
        .populate("attendee", "name")
        .sort({ createdAt: -1 }),
      Feedback.aggregate([
        { $match: { event: event._id } },
        {
          $group: {
            _id: null,
            count: { $sum: 1 },
            avgRating: { $avg: "$rating" },
            avgSentiment: { $avg: "$sentimentScore" },
            positive: { $sum: { $cond: [{ $eq: ["$sentiment", "positive"] }, 1, 0] } },
            neutral: { $sum: { $cond: [{ $eq: ["$sentiment", "neutral"] }, 1, 0] } },
            negative: { $sum: { $cond: [{ $eq: ["$sentiment", "negative"] }, 1, 0] } },
          },
        },
      ]),
    ]);

    const stats = summary[0] || {
      count: 0,
      avgRating: 0,
      avgSentiment: 0,
      positive: 0,
      neutral: 0,
      negative: 0,
    };

    res.json({
      feedback,
      summary: {
        count: stats.count,
        avgRating: Math.round((stats.avgRating || 0) * 10) / 10,
        avgSentiment: Math.round((stats.avgSentiment || 0) * 100) / 100,
        breakdown: { positive: stats.positive, neutral: stats.neutral, negative: stats.negative },
      },
    });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

const _controllerExports = { submitFeedback, getMyFeedback, getEventFeedback };
export default _controllerExports;
// CJS interop for require() - keep compatibility
// @ts-ignore
module.exports = _controllerExports;
// @ts-ignore
module.exports.default = _controllerExports;