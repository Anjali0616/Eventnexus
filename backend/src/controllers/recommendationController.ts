import { Request, Response } from "express";
import { scoreEvents } from "../utils/recommendationEngine";
import { parsePagination } from "../utils/query";

export const getRecommendations = async (req: Request, res: Response): Promise<void> => {
  try {
    const { page, limit, skip } = parsePagination(req.query, {
      defaultLimit: 12,
      maxLimit: 50,
    });
    const { category, search } = req.query as any;

    // Score a ranked pool of up to 50 (LLM reasons are generated once for
    // the whole pool), then filter by category/search and paginate locally —
    // the ranking must stay intact even when a filter is applied.
    const { hasLocation, recommendations } = await scoreEvents({
      attendee: req.user._id,
      organization: req.user.organization,
      location: req.user.location,
      userInterests: req.user.interests || [],
      limit: 50,
      withReasons: true,
    });

    let list = recommendations;
    if (category && category !== "all") {
      list = list.filter((r) => r.event.category === category);
    }
    if (search) {
      const q = String(search).toLowerCase();
      list = list.filter(
        (r) =>
          (r.event.title || "").toLowerCase().includes(q) ||
          (r.event.venue || "").toLowerCase().includes(q) ||
          (r.event.description || "").toLowerCase().includes(q)
      );
    }

    const total = list.length;
    const paged = list.slice(skip, skip + limit);

    res.json({
      hasLocation,
      recommendations: paged.map(({ event, score, distanceKm, predicted, reason }) => ({
        event: {
          ...(event.toObject ? event.toObject() : event),
          predictedAttendance: predicted,
        },
        score,
        distanceKm,
        reason,
      })),
      pagination: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
        hasMore: skip + paged.length < total,
      },
    });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

const _controllerExports = { getRecommendations };
export default _controllerExports;
// CJS interop for require() - keep compatibility
// @ts-ignore
module.exports = _controllerExports;
// @ts-ignore
module.exports.default = _controllerExports;