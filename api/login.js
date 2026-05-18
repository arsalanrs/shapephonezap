/**
 * POST /api/login  JSON body: { email, password }
 * Sets HttpOnly cookie when credentials match AUTH_EMAIL + AUTH_PASSWORD.
 */

const {
  signSession,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SEC,
  timingSafeStringEqual,
} = require("../lib/session.cjs");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const secret = process.env.AUTH_SESSION_SECRET;
  const expectedEmail = (process.env.AUTH_EMAIL || "").toLowerCase().trim();
  const expectedPassword = process.env.AUTH_PASSWORD || "";

  if (!secret || !expectedEmail || !expectedPassword) {
    return res.status(503).json({
      error:
        "Login is not configured. Set AUTH_EMAIL, AUTH_PASSWORD, and AUTH_SESSION_SECRET (see .env.example).",
    });
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body || "{}");
    } catch {
      return res.status(400).json({ error: "Invalid JSON body" });
    }
  }

  const email = String(body?.email || "")
    .toLowerCase()
    .trim();
  const password = String(body?.password || "");

  if (!timingSafeStringEqual(email, expectedEmail) || !timingSafeStringEqual(password, expectedPassword)) {
    return res.status(401).json({ error: "Invalid email or password." });
  }

  const token = signSession(secret, email);
  const secure = process.env.VERCEL || process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SEC}${secure}`
  );
  return res.status(200).json({ ok: true });
};
