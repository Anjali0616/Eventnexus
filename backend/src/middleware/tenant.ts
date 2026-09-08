// Ensures every tenant-scoped query is filtered to the requesting user's organization,
// so cross-org data access is a structural impossibility rather than a per-controller convention.
import { Request } from "express";

export const scopeToOrg = (filter: any, req: Request): any => {
  if (!(req as any).user.organization) {
    // Attendee has no organization by design — return the filter unchanged
    // so attendee-facing reads return empty/public data instead of 403.
    // Organizer / org_admin without org is still a hard 403.
    if ((req as any).user?.role === "attendee") return filter;
    const err: any = new Error("User has no organization assigned");
    err.statusCode = 403;
    throw err;
  }
  return { ...filter, organization: (req as any).user.organization };
};

export const requireSameOrg = (resourceOrgId: any, req: Request): boolean => {
  return (
    (req as any).user.organization &&
    resourceOrgId &&
    resourceOrgId.toString() === (req as any).user.organization.toString()
  );
};
