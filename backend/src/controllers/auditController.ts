import { Request, Response } from "express";
import AuditLog from "../models/AuditLog";
import { parsePagination, parseSort } from "../utils/query";

export const listAuditLogs = async (req: Request, res: Response): Promise<void> => {
  try {
    const { action, resourceType, userId, from, to, sort } = req.query as any;
    const filter: any = {};
    if (action) filter.action = action;
    if (resourceType) filter.resourceType = resourceType;
    if (userId) filter.user = userId;
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(to);
    }
    // Admins are tenant-scoped too: only their own organization's trail.
    if (req.user.organization) {
      filter.organization = req.user.organization;
    }

    const { page, limit, skip } = parsePagination(req.query, { defaultLimit: 50, maxLimit: 200 });
    const total = await AuditLog.countDocuments(filter);
    const logs = await AuditLog.find(filter)
      .populate("user", "name email")
      .sort(parseSort(sort, ["createdAt", "action"], { createdAt: -1 }))
      .skip(skip)
      .limit(limit)
      .lean();

    res.json({
      logs,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

const _controllerExports = { listAuditLogs };
export default _controllerExports;
// CJS interop for require() - keep compatibility
// @ts-ignore
module.exports = _controllerExports;
// @ts-ignore
module.exports.default = _controllerExports;