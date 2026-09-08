import User from "../models/User";

// Boot-time data/code integrity check for the admin role split.
//
// The tenant-admin role is "org_admin"; the platform admin is "admin" and
// must never carry an organization. Those are enforced in code (every
// permission check compares against those exact values), but code alone
// can't notice when the DATABASE still holds the pre-split shape — which is
// precisely how tenant admins silently lost access to their own events
// after the split: the role checks were correct, the rows weren't, and
// nothing anywhere said so. The failure surfaced only as a confusing
// "you're not authorized" in the UI.
//
// Best-effort and non-fatal: it only reports. A boot check that could take
// the server down over a data shape is worse than the drift it detects.
export const checkRoleIntegrity = async (): Promise<void> => {
  try {
    const [legacyTenantAdmins, orphanOrgAdmins] = await Promise.all([
      // Pre-split tenant admins: role "admin" WITH an organization.
      (User as any).countDocuments({ role: "admin", organization: { $exists: true, $ne: null } }),
      // org_admin with no tenant to administer — every org-scoped query
      // filters on req.user.organization, so these accounts see nothing.
      (User as any).countDocuments({
        role: "org_admin",
        $or: [{ organization: { $exists: false } }, { organization: null }],
      }),
    ]);

    if (legacyTenantAdmins > 0) {
      console.warn(
        `[roles] ${legacyTenantAdmins} account(s) still use the pre-split shape ` +
          `(role "admin" with an organization). They will NOT be treated as tenant ` +
          `admins and will lose access to their organization's events. ` +
          `Run: npm run migrate:org-admin`
      );
    }
    if (orphanOrgAdmins > 0) {
      console.warn(
        `[roles] ${orphanOrgAdmins} account(s) are role "org_admin" with no organization — ` +
          `every tenant-scoped query will return empty for them.`
      );
    }
  } catch (error: any) {
    console.error("[roles] integrity check skipped:", error.message);
  }
};

export default { checkRoleIntegrity };
