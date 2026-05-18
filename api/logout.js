/**
 * POST or GET /api/logout — clears session cookie.
 */

const { SESSION_COOKIE_NAME } = require("../lib/session.cjs");

function loginPageUrl(req) {
  const h = req.headers?.["x-forwarded-host"] || req.headers?.host;
  let proto = (req.headers?.["x-forwarded-proto"] || "").split(",")[0].trim();
  if (!proto) proto = process.env.VERCEL ? "https" : "http";
  if (h) return `${proto}://${h}/login.html`;
  return "/login.html";
}

module.exports = async (req, res) => {
  const secure = process.env.VERCEL || process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
  );
  if (req.method === "GET") {
    res.statusCode = 302;
    res.setHeader("Location", loginPageUrl(req));
    return res.end();
  }
  return res.status(200).json({ ok: true });
};
