const jwt = require("jsonwebtoken");

// Access tokens carry the user's current tokenVersion so protect() can
// reject tokens minted before a privilege change (role/password). Callers
// pass the user's tokenVersion at login/refresh time.
const generateToken = (userId, tokenVersion = 0) => {
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is not configured");
  }
  return jwt.sign({ id: userId, ver: tokenVersion }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "1h",
  });
};

module.exports = generateToken;
