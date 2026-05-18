#!/usr/bin/env node
/**
 * Vercel build: populate `public/` with static assets.
 * Root `api/` stays outside `public/` so serverless routes still deploy.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "public");

const FILES = ["index.html", "login.html", "app.js", "styles.css", "fields-to-zap.json"];

fs.mkdirSync(OUT, { recursive: true });
for (const name of FILES) {
  const src = path.join(ROOT, name);
  const dest = path.join(OUT, name);
  if (!fs.existsSync(src)) {
    console.error(`vercel-build: missing source file: ${name}`);
    process.exit(1);
  }
  fs.copyFileSync(src, dest);
  console.log(`  copied ${name} → public/`);
}
console.log("vercel-build: public/ ready.");
