// Recursively strips MongoDB query operators ("$where", "$gt", ...) and
// dotted keys from untrusted input so attacker-supplied bodies/query
// strings/params can never inject operators into mongoose queries (NoSQL
// injection guard). Express's query parser turns `?role[$ne]=admin` into
// `req.query.role = { $ne: "admin" }` — any controller that does
// `filter[key] = req.query[key]` (see utils/query.js's buildFilters) would
// otherwise pass that operator straight into a Mongo query unfiltered.
import { Request, Response, NextFunction, RequestHandler } from "express";

export const sanitize = (value: any, depth = 0): any => {
  if (value == null) return value;
  if (depth > 6) return Array.isArray(value) ? [] : typeof value === "object" ? {} : value;
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, any> = {};
    for (const [key, val] of Object.entries(value)) {
      if (key === "__proto__" || key === "constructor" || key === "prototype") continue;
      if (key.startsWith("$") || key.includes(".")) continue;
      out[key] = sanitize(val, depth + 1);
    }
    return out;
  }
  return value;
};

// Applied globally (server.js) so every request is sanitized regardless of
// whether the route happens to run express-validator's `validate` — list
// endpoints like GET /events/my, GET /users, GET /tickets take req.query
// straight into buildFilters()/buildAdvancedFilters() with no validators at
// all, and previously had zero sanitization on that path.
export const sanitizeRequest: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
  if ((req as any).body && typeof (req as any).body === "object") (req as any).body = sanitize((req as any).body);
  if ((req as any).query && typeof (req as any).query === "object") (req as any).query = sanitize((req as any).query);
  if ((req as any).params && typeof (req as any).params === "object") (req as any).params = sanitize((req as any).params);
  next();
};
