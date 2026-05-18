/**
 * Signed HttpOnly session cookie for Quest Rock tool (Node: login + API guards + dev-server).
 * Edge middleware duplicates verify logic — keep algorithms in sync.
 */

const crypto = require("crypto");

const SESSION_COOKIE_NAME = "qr_session";
const SESSION_MAX_AGE_SEC = 60 * 60 * 24 * 7; // 7 days

function signSession(secret, email) {
  const payload = JSON.stringify({
    email: String(email).toLowerCase().trim(),
    exp: Date.now() + SESSION_MAX_AGE_SEC * 1000,
  });
  const payloadB64 = Buffer.from(payload, "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");
  return `${payloadB64}.${sig}`;
}

function verifySession(secret, token) {
  if (!secret || !token || typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");
  const a = Buffer.from(sig, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let data;
  try {
    data = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!data || typeof data.exp !== "number" || data.exp < Date.now()) return null;
  if (!data.email || typeof data.email !== "string") return null;
  return data;
}

function parseCookies(cookieHeader) {
  const out = {};
  if (!cookieHeader || typeof cookieHeader !== "string") return out;
  for (const part of cookieHeader.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    try {
      out[k] = decodeURIComponent(v);
    } catch {
      out[k] = v;
    }
  }
  return out;
}

function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(String(a), "utf8");
  const bufB = Buffer.from(String(b), "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function getSessionFromReq(req) {
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret) return null;
  const raw = req.headers?.cookie || "";
  const cookies = parseCookies(raw);
  return verifySession(secret, cookies[SESSION_COOKIE_NAME]);
}

function requireSessionOr401(req, res) {
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret) return { email: null, anonymous: true };
  const session = getSessionFromReq(req);
  if (!session) {
    res.status(401).json({ error: "Unauthorized — sign in at /login.html" });
    return null;
  }
  return session;
}

module.exports = {
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SEC,
  signSession,
  verifySession,
  parseCookies,
  timingSafeStringEqual,
  getSessionFromReq,
  requireSessionOr401,
};
