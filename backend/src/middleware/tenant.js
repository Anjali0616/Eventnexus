// Ensures every tenant-scoped query is filtered to the requesting user's organization,
// so cross-org data access is a structural impossibility rather than a per-controller convention.
const scopeToOrg = (filter, req) => {
  if (!req.user.organization) {
    // Attendee has no organization by design — return the filter unchanged
    // so attendee-facing reads return empty/public data instead of 403.
    // Organizer / org_admin without org is still a hard 403.
    if (req.user?.role === "attendee") return filter;
    const err = new Error("User has no organization assigned");
    err.statusCode = 403;
    throw err;
  }
  return { ...filter, organization: req.user.organization };
};

const requireSameOrg = (resourceOrgId, req) => {
  return (
    req.user.organization &&
    resourceOrgId &&
    resourceOrgId.toString() === req.user.organization.toString()
  );
};

module.exports = { scopeToOrg, requireSameOrg };
