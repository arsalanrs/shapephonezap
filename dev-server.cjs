#!/usr/bin/env node
/**
 * Local dev: static files + /api/* (same handlers as Vercel).
 * Loads .env from this directory. No deployment required.
 *
 *   npm install && npm run dev
 *
 * When AUTH_SESSION_SECRET is set, /index.html, /app.js, /styles.css, /fields-to-zap.json,
 * and protected APIs require a valid session cookie (see /login.html).
 */

require("dotenv").config({ path: require("path").join(__dirname, ".env") });

const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");

const { getSessionFromReq } = require("./lib/session.cjs");

const PORT = Number(process.env.PORT) || 3000;
const ROOT = __dirname;

const shapeLead = require("./api/shape-lead.js");
const extract = require("./api/extract.js");
const shapeUpdate = require("./api/shape-update.js");
const login = require("./api/login.js");
const logout = require("./api/logout.js");

/** Vercel-style res.status(n).json(obj) on plain Node ServerResponse */
function enhanceRes(res) {
  res.status = (code) => {
    res.statusCode = code;
    return {
      json: (body) => {
        if (!res.headersSent) {
          res.setHeader("Content-Type", "application/json; charset=utf-8");
        }
        res.end(JSON.stringify(body));
      },
    };
  };
  return res;
}

function parseReqUrl(req) {
  const host = req.headers.host || "localhost";
  const u = new URL(req.url || "/", `http://${host}`);
  const query = {};
  u.searchParams.forEach((v, k) => {
    query[k] = v;
  });
  return { pathname: u.pathname, query };
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const m = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".ico": "image/x-icon",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".woff2": "font/woff2",
  };
  return m[ext] || "application/octet-stream";
}

function sendStatic(res, filePath) {
  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not found");
      return;
    }
    res.writeHead(200, { "Content-Type": mimeFor(filePath) });
    fs.createReadStream(filePath).pipe(res);
  });
}

function authRequired() {
  return Boolean(process.env.AUTH_SESSION_SECRET);
}

function hasValidSession(req) {
  if (!authRequired()) return true;
  return !!getSessionFromReq(req);
}

function sendJson(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(obj));
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

const server = http.createServer(async (req, res) => {
  try {
    const { pathname, query } = parseReqUrl(req);

    if (pathname === "/api/shape-lead") {
      if (!hasValidSession(req)) {
        sendJson(res, 401, { error: "Unauthorized — sign in at /login.html" });
        return;
      }
      const mockReq = { method: req.method || "GET", query, headers: req.headers };
      await shapeLead(mockReq, enhanceRes(res));
      return;
    }

    if (pathname === "/api/extract" && req.method === "POST") {
      if (!hasValidSession(req)) {
        sendJson(res, 401, { error: "Unauthorized — sign in at /login.html" });
        return;
      }
      const body = await readJsonBody(req);
      const mockReq = { method: "POST", body, headers: req.headers };
      await extract(mockReq, enhanceRes(res));
      return;
    }

    if (pathname === "/api/shape-update" && req.method === "POST") {
      if (!hasValidSession(req)) {
        sendJson(res, 401, { error: "Unauthorized — sign in at /login.html" });
        return;
      }
      const body = await readJsonBody(req);
      const mockReq = { method: "POST", body, headers: req.headers };
      await shapeUpdate(mockReq, enhanceRes(res));
      return;
    }

    if (pathname === "/api/login" && req.method === "POST") {
      const body = await readJsonBody(req);
      const mockReq = { method: "POST", body, headers: req.headers };
      await login(mockReq, enhanceRes(res));
      return;
    }

    if (pathname === "/api/logout") {
      const mockReq = { method: req.method || "GET", headers: req.headers };
      await logout(mockReq, enhanceRes(res));
      return;
    }

    let rel = pathname === "/" ? "index.html" : pathname.slice(1);
    const filePath = path.resolve(ROOT, rel);
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }

    const staticProtected =
      rel === "index.html" || rel === "app.js" || rel === "styles.css" || rel === "fields-to-zap.json";
    if (staticProtected && !hasValidSession(req)) {
      redirect(res, "/login.html");
      return;
    }

    sendStatic(res, filePath);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) res.writeHead(500);
    res.end("Internal error");
  }
});

server.listen(PORT, () => {
  console.log(`Quest Rock local dev → http://localhost:${PORT}`);
  console.log(
    authRequired()
      ? "  Auth on — visit /login.html first (AUTH_* in .env)."
      : "  Auth off — set AUTH_SESSION_SECRET (+ email/password) to require login."
  );
  console.log("  Static + /api/shape-lead, /api/extract, /api/shape-update, /api/login, /api/logout");
});
