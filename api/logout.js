/**
 * POST or GET /api/logout — clears session cookie.
 */

const { SESSION_COOKIE_NAME } = require("../lib/session.cjs");

module.exports = async (req, res) => {
  const secure = process.env.VERCEL || process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`
  );
  if (req.method === "GET") {
    res.statusCode = 302;
    res.setHeader("Location", "/login.html");
    return res.end();
  }
  return res.status(200).json({ ok: true });
};
