import { Request, Response } from "express";
import mongoose from "mongoose";
import Notification from "../models/Notification";
import { emitToUser } from "../utils/socket";

import { parsePagination, buildSearch, buildFilters, parseSort, paginate } from "../utils/query";

// True only for a valid 24-hex Mongo ObjectId string or ObjectId instance.
const isValidObjectId = (id) => {
  if (!id) return false;
  const s = String(id);
  if (s === "undefined" || s === "null" || s === "") return false;
  return /^[0-9a-fA-F]{24}$/.test(s) && mongoose.Types.ObjectId.isValid(s);
};

const sanitizeEvent = (event) => {
  if (!event) return undefined;
  // event may be ObjectId, string, or populated doc
  const raw = event?._id ? String(event._id) : String(event);
  if (!isValidObjectId(raw)) return undefined;
  return event?._id ? event._id : event;
};

const sanitizeLink = (link, event) => {
  // event is already sanitized (ObjectId or undefined)
  const eventId = event ? String(event?._id ? event._id : event) : null;
  const validEventId = eventId && isValidObjectId(eventId) ? eventId : null;

  if (!link || typeof link !== "string") {
    // No link supplied: if we have a valid event, point to its detail page
    // Canonical is /event/[id] (singular) — not /events/[id].
    if (validEventId) return `/event/${validEventId}`;
    return undefined;
  }
  let l = link.trim();
  if (!l || l.includes("undefined") || l.includes("null")) {
    if (validEventId) return `/event/${validEventId}`;
    return undefined;
  }
  // Normalize plural /events/<id> to singular /event/<id> for consistency.
  if (l.startsWith("/events/")) l = l.replace(/^\/events\//, "/event/");
  // If link is an event detail link, validate the id portion — /event/undefined previously passed regex.
  if (l.startsWith("/event/")) {
    const idPart = l.split("/")[2]?.split("?")[0]?.split("#")[0] || "";
    if (!idPart || !isValidObjectId(idPart)) {
      // Event link with bad id: either drop it or fallback to valid event id if available
      if (validEventId) return `/event/${validEventId}`;
      return undefined;
    }
    // Rebuild to ensure canonical form
    const suffix = l.slice(`/event/${idPart}`.length);
    return `/event/${idPart}${suffix}`;
  }
  // Non-event links (/my-tickets, /organizer/tickets, /admin/collaboration) — keep as-is if safe
  if (l === "/event" || l === "/event/") return validEventId ? `/event/${validEventId}` : undefined;
  return l;
};

const sanitizeData = (data, event) => {
  if (!data || typeof data !== "object") return data;
  const out = { ...data };
  const eventId = event ? String(event?._id ? event._id : event) : null;
  const validEventId = eventId && isValidObjectId(eventId) ? eventId : null;
  if ("eventId" in out) {
    const raw = out.eventId ? String(out.eventId) : "";
    if (!isValidObjectId(raw)) {
      if (validEventId) out.eventId = validEventId;
      else delete out.eventId;
    } else {
      out.eventId = raw;
    }
  } else if (validEventId) {
    // Ensure data carries eventId when event exists but data didn't
    // (not strictly required, but keeps detail view metadata consistent)
  }
  return out;
};

// Sanitize notifications on read so legacy rows with /events/undefined or /event/undefined are fixed for the client.
const sanitizeNotificationForRead = (doc) => {
  if (!doc) return doc;
  const obj = typeof doc.toObject === "function" ? doc.toObject() : { ...doc };
  // obj.event may be populated doc or ObjectId or null
  let eventVal = obj.event;
  // If populated and doc is null, eventVal will be null (missing ref) — keep original id from _doc if available
  if (!eventVal && doc.event && isValidObjectId(doc.event)) eventVal = doc.event;
  const cleanEvent = eventVal && isValidObjectId(eventVal?._id ? eventVal._id : eventVal) ? eventVal : null;
  // Fix legacy link that contains undefined or plural form
  let link = obj.link;
  if (link && typeof link === "string") {
    if (link.includes("undefined") || link.includes("null")) link = null;
    else if (link.startsWith("/events/")) link = link.replace(/^\/events\//, "/event/");
    if (link && link.startsWith("/event/")) {
      const idPart = link.split("/")[2]?.split("?")[0] || "";
      if (!idPart || !isValidObjectId(idPart)) link = cleanEvent ? `/event/${String(cleanEvent?._id ? cleanEvent._id : cleanEvent)}` : null;
    }
    if (link === "/event" || link === "/event/") link = null;
  } else if (!link && cleanEvent) {
    // Optional: legacy notification with event but no link — client will use event card instead
  }
  obj.link = link || null;
  obj.event = cleanEvent;
  return obj;
};

// Push the current unread count to the recipient's live sockets so the
// badge updates instantly, without the client having to refetch.
const emitUnreadCount = async (recipient) => {
  const count = await Notification.countDocuments({
    recipient,
    read: false,
  });
  emitToUser(recipient, "unread:count", { count });
  return count;
};

// The single chokepoint every notification in the app flows through —
// creating a notification also pushes it over the Socket.IO channel, so
// whatever activity created it is seen by the recipient in real time.
export const createNotification = async ({
  recipient,
  organization,
  type,
  title,
  message,
  event,
  link,
  data,
}) => {
  // Sanitize: ensure we never persist event=undefined or link=/event/undefined
  // and that /events/<id> is normalized to canonical /event/<id>.
  const cleanEvent = sanitizeEvent(event);
  const cleanLink = sanitizeLink(link, cleanEvent);
  const cleanData = sanitizeData(data, cleanEvent);
  // If caller passed an invalid event (e.g. undefined) but we still have a link
  // that is an event link, keep event as undefined and drop bad link already handled above.
  const notification = await Notification.create({
    recipient,
    organization,
    type,
    title,
    message,
    event: cleanEvent,
    link: cleanLink,
    data: cleanData,
  });

  const unread = await emitUnreadCount(recipient);
  emitToUser(recipient, "notification:created", {
    notification,
    unread,
  });

  return notification;
};

export const getMyNotifications = async (req: Request, res: Response): Promise<void> => {
  try {
    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 20 });
    const filter: any = {
      recipient: req.user._id,
      ...buildSearch(req.query.search, ["title", "message"]),
      ...buildFilters(req.query, ["type"]),
    };
    // read is a boolean field — buildFilters would pass "true"/"false" strings.
    if (req.query.read === "true") filter.read = true;
    else if (req.query.read === "false") filter.read = false;

    const sort = parseSort(req.query.sort, ["createdAt", "read"], { createdAt: -1 });

    const { data, pagination } = await paginate(Notification, {
      filter,
      page,
      limit,
      skip,
      sort,
      populate: { path: "event", select: "title date" },
    });
    const sanitized = data.map(sanitizeNotificationForRead);
    res.json({ notifications: sanitized, pagination });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

export const getNotification = async (req: Request, res: Response): Promise<void> => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      recipient: req.user._id,
    }).populate("event", "title date");
    if (!notification) {
      return void res.status(404).json({ message: "Notification not found" });
    }
    const sanitized = sanitizeNotificationForRead(notification);
    res.json({ notification: sanitized });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

export const getUnreadCount = async (req: Request, res: Response): Promise<void> => {
  try {
    const count = await Notification.countDocuments({
      recipient: req.user._id,
      read: false,
    });
    res.json({ count });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

export const markAsRead = async (req: Request, res: Response): Promise<void> => {
  try {
    const notification = await Notification.findOne({
      _id: req.params.id,
      recipient: req.user._id,
    });
    if (!notification) {
      return void res.status(404).json({ message: "Notification not found" });
    }
    notification.read = true;
    await notification.save();

    // Keep other open tabs of the same user in sync (badge + list state).
    const unread = await emitUnreadCount(req.user._id);
    emitToUser(req.user._id, "notification:read", { id: notification._id, unread });

    res.json({ notification });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

export const markAllAsRead = async (req: Request, res: Response): Promise<void> => {
  try {
    await Notification.updateMany(
      { recipient: req.user._id, read: false },
      { read: true }
    );
    emitToUser(req.user._id, "notifications:read-all", { unread: 0 });

    res.json({ message: "All notifications marked as read" });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

const _controllerExports = { createNotification, getMyNotifications, getNotification, getUnreadCount, markAsRead, markAllAsRead };
export default _controllerExports;
// CJS interop for require() - keep compatibility
// @ts-ignore
module.exports = _controllerExports;
// @ts-ignore
module.exports.default = _controllerExports;