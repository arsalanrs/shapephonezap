/**
 * Vercel Edge Middleware — protects the app and sensitive APIs when AUTH_SESSION_SECRET is set.
 * Must stay in sync with lib/session.cjs (HMAC-SHA256 over base64url payload).
 */

const COOKIE = "qr_session";

function getCookie(request, name) {
  const raw = request.headers.get("cookie");
  if (!raw) return "";
  for (const part of raw.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    if (k === name) return part.slice(idx + 1).trim();
  }
  return "";
}

function bytesToBase64Url(bytes) {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function verifyEdge(secret, token) {
  if (!secret || !token) return false;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;
  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);

  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, enc.encode(payloadB64));
  const expected = bytesToBase64Url(new Uint8Array(sigBuf));
  if (expected.length !== sigB64.length) return false;
  let ok = true;
  for (let i = 0; i < expected.length; i++) {
    if (expected[i] !== sigB64[i]) ok = false;
  }
  if (!ok) return false;

  let payload;
  try {
    const pad = payloadB64.length % 4 === 0 ? "" : "=".repeat(4 - (payloadB64.length % 4));
    const b64 = payloadB64.replace(/-/g, "+").replace(/_/g, "/") + pad;
    const json = atob(b64);
    payload = JSON.parse(json);
  } catch {
    return false;
  }
  if (!payload || typeof payload.exp !== "number" || payload.exp < Date.now()) return false;
  return Boolean(payload.email);
}

export const config = {
  matcher: [
    "/",
    "/index.html",
    "/login.html",
    "/login",
    "/app.js",
    "/fields-to-zap.json",
    "/api/shape-lead",
    "/api/extract",
    "/api/shape-update",
    "/api/login",
    "/api/logout",
  ],
};

export default async function middleware(request) {
  const url = new URL(request.url);
  const p = url.pathname;
  /** Always allow auth endpoints + login page (avoid matcher gaps / redirect loops). */
  if (p === "/login.html" || p === "/login" || p === "/api/login" || p === "/api/logout") {
    return fetch(request);
  }

  if (!process.env.AUTH_SESSION_SECRET) {
    return fetch(request);
  }

  const token = getCookie(request, COOKIE);
  const valid = token && (await verifyEdge(process.env.AUTH_SESSION_SECRET, token));
  if (valid) {
    return fetch(request);
  }

  if (url.pathname.startsWith("/api/")) {
    return new Response(JSON.stringify({ error: "Unauthorized — sign in at /login.html" }), {
      status: 401,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  return Response.redirect(new URL("/login.html", request.url), 302);
}
