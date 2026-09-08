import jwt from "jsonwebtoken";

// Access tokens carry the user's current tokenVersion so protect() can
// reject tokens minted before a privilege change (role/password). Callers
// pass the user's tokenVersion at login/refresh time.
export const generateToken = (userId: string | any, tokenVersion: number = 0): string => {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured");
  }
  return jwt.sign({ id: userId, ver: tokenVersion }, process.env.JWT_SECRET as string, {
    expiresIn: (process.env.JWT_EXPIRES_IN as string) || "1h",
  } as any);
};

export default generateToken;

// CommonJS interop: controllers still use `require("../utils/generateToken")` expecting a function
declare const module: any;
if (typeof module !== "undefined" && (module as any).exports) {
  (module as any).exports = generateToken;
  (module as any).exports.default = generateToken;
  (module as any).exports.generateToken = generateToken;
}
