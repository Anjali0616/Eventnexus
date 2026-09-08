// Recursively strips MongoDB query operators ("$where", "$gt", ...) and
// dotted keys from untrusted input so attacker-supplied bodies/query
// strings/params can never inject operators into mongoose queries (NoSQL
// injection guard). Express's query parser turns `?role[$ne]=admin` into
// `req.query.role = { $ne: "admin" }` — any controller that does
// `filter[key] = req.query[key]` (see utils/query.js's buildFilters) would
// otherwise pass that operator straight into a Mongo query unfiltered.
const sanitize = (value, depth = 0) => {
  if (value == null) return value;
  if (depth > 6) return Array.isArray(value) ? [] : typeof value === "object" ? {} : value;
  if (Array.isArray(value)) return value.map((v) => sanitize(v, depth + 1));
  if (typeof value === "object") {
    const out = {};
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
const sanitizeRequest = (req, res, next) => {
  if (req.body && typeof req.body === "object") req.body = sanitize(req.body);
  if (req.query && typeof req.query === "object") req.query = sanitize(req.query);
  if (req.params && typeof req.params === "object") req.params = sanitize(req.params);
  next();
};

module.exports = { sanitize, sanitizeRequest };
