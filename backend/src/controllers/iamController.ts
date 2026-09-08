import { Request, Response } from "express";
import Role from "../models/Role";
import Permission from "../models/Permission";
import { audit } from "../utils/audit";
import { invalidateRoleCache, getRolePermissions } from "../middleware/auth";

export const listRoles = async (req: Request, res: Response): Promise<void> => {
  try {
    const roles = await Role.find({})
      .sort({ scope: 1, name: 1 })
      .lean();
    res.json({
      roles: roles.map((r) => ({
        _id: r._id,
        name: r.name,
        description: r.description,
        scope: r.scope,
        permissions: r.permissions,
        // Legacy matrix fallback for roles not yet seeded — keeps the API
        // truthful even on a fresh database.
        effectivePermissions: getRolePermissions(r.name),
      })),
    });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

export const listPermissions = async (req: Request, res: Response): Promise<void> => {
  try {
    const permissions = await Permission.find({}).sort({ code: 1 }).lean();
    res.json({ permissions });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

// Update a system role's permission list (admin). Caches are invalidated so
// the next requirePermission call sees the change immediately.
export const updateRolePermissions = async (req: Request, res: Response): Promise<void> => {
  try {
    const { permissions } = req.body;
    if (!Array.isArray(permissions) || !permissions.every((p) => typeof p === "string")) {
      return void res.status(400).json({ message: "permissions must be an array of codes" });
    }
    const role = await Role.findById(req.params.id);
    if (!role) {
      return void res.status(404).json({ message: "Role not found" });
    }
    // System and organization roles are stored as global documents (no tenant id).
    // Until per-tenant role isolation is implemented, only the system admin
    // (admin without organization) may mutate any role — otherwise an org_admin
    // of tenant A could widen permissions for tenant B via the shared Role doc
    // (cross-tenant privilege escalation). System-scope check is explicit defense.
    if (req.user.organization || req.user.role !== "admin") {
      return void res.status(403).json({ message: "Only the system admin can edit roles" });
    }

    role.permissions = [...new Set(permissions)];
    await role.save();
    invalidateRoleCache();

    audit({
      req,
      action: "role_updated",
      resourceType: "Role",
      resourceId: role._id,
      metadata: { role: role.name, permissions: role.permissions },
    });

    res.json({ role });
  } catch (error) {
    console.error("[error]", error);
    res.status(500).json({ success: false, message: "Something went wrong. Please try again.", code: "INTERNAL_ERROR" });
}
};

const _controllerExports = { listRoles, listPermissions, updateRolePermissions };
export default _controllerExports;
// CJS interop for require() - keep compatibility
// @ts-ignore
module.exports = _controllerExports;
// @ts-ignore
module.exports.default = _controllerExports;