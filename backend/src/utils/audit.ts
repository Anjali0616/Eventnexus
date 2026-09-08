// Audit logging (report §24). Fire-and-forget by design: audit writes must
// never block or fail a request, so every variant swallows its own errors.
// Controllers call audit() at the interesting points (login, payment,
// check-in, ...); the audit trail is read by admins via GET /api/audit.
import AuditLog from "../models/AuditLog";
import type { Request } from "express";

const clientContext = (req: Request | any): { ip: string; userAgent: string } => ({
  ip:
    (req?.ip || req?.headers?.["x-forwarded-for"]?.split(",")[0]?.trim() || "").replace(/^::ffff:/, ""),
  userAgent: req?.headers?.["user-agent"] || "",
});

export interface AuditParams {
  req?: Request | any;
  user?: any;
  organization?: any;
  action: string;
  resourceType?: string;
  resourceId?: string | any;
  result?: string;
  metadata?: Record<string, any>;
}

export const audit = async ({
  req,
  user,
  organization,
  action,
  resourceType,
  resourceId,
  result = "success",
  metadata = {},
}: AuditParams): Promise<void> => {
  try {
    const context = clientContext(req);
    await (AuditLog as any).create({
      user: user?._id ?? req?.user?._id ?? null,
      organization: organization?._id ?? req?.user?.organization ?? null,
      action,
      resourceType,
      resourceId,
      result,
      metadata,
      ip: context.ip,
      userAgent: context.userAgent,
    });
  } catch (error: any) {
    console.error(`[audit] ${action} failed to persist:`, error.message);
  }
};

export default { audit };
