/**
 * GET /api/shape-lead?leadId=...
 * Proxies Shape CRM: POST https://secure-api.setshape.com/api/search/lead/{CRM_ID}
 * CRM id: SHAPE_CRM_ID (Settings → API Integrations). Body includes e.g. { lead_id }.
 * If SHAPE_API_KEY is unset, returns mock data for UI testing.
 */

const { readFileSync } = require("fs");
const { join } = require("path");

const DEFAULT_BASE = "https://secure-api.setshape.com/api";

function loadZapKeys() {
  try {
    const raw = readFileSync(join(process.cwd(), "fields-to-zap.json"), "utf8");
    const data = JSON.parse(raw);
    if (!data.fields) return [];
    return data.fields.map((f) => f.key);
  } catch {
    return [];
  }
}

function buildMockLead(leadId, keys) {
  const lead = { leadid: String(leadId) };
  for (const k of keys) {
    if (k === "lastname") lead[k] = "DemoBorrower";
    else if (k === "email") lead[k] = "sam.demo@questrock.test";
    else if (k === "prCountry") lead[k] = "United States";
    else lead[k] = null;
  }
  return lead;
}

/** Normalize Shape search/lead JSON to a flat field object for the UI. */
function unwrapLead(json) {
  if (!json || typeof json !== "object") return {};
  if (Array.isArray(json) && json[0] && typeof json[0] === "object") return json[0];
  if (json.data && typeof json.data === "object" && !Array.isArray(json.data)) return json.data;
  if (Array.isArray(json.data) && json.data[0]) return json.data[0];
  if (json.lead && typeof json.lead === "object") return json.lead;
  if (json.result && typeof json.result === "object" && !Array.isArray(json.result)) return json.result;
  return json;
}

/** Shape returns `id`; our UI also expects `leadid`. */
function normalizeLeadShape(flat) {
  if (!flat || typeof flat !== "object") return flat;
  if (flat.leadid == null && flat.id != null) flat.leadid = String(flat.id);
  return flat;
}

module.exports = async (req, res) => {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { requireSessionOr401 } = require("../lib/session.cjs");
  if (!requireSessionOr401(req, res)) return;

  const leadIdRaw = req.query.leadId || req.query.leadid;
  if (!leadIdRaw || String(leadIdRaw).trim() === "") {
    return res.status(400).json({ error: "Missing leadId query parameter" });
  }

  const apiKey = process.env.SHAPE_API_KEY || process.env.SHAPE_ACCESS_TOKEN;
  const baseUrl = (process.env.SHAPE_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");
  /** Required: POST /search/lead/{crmid} per https://setshape.com/api-search-leads */
  const crmId =
    process.env.SHAPE_CRM_ID || process.env.SHAPE_ACCOUNT_ID || process.env.CRM_ID || "";

  if (!apiKey) {
    const keys = loadZapKeys();
    const body = buildMockLead(leadIdRaw, keys.length ? keys : ["firstname", "lastname", "email"]);
    res.setHeader("X-Shape-Lead-Source", "mock");
    return res.status(200).json(body);
  }

  const lead_id = /^\d+$/.test(String(leadIdRaw)) ? Number(leadIdRaw) : leadIdRaw;

  if (!String(crmId).trim()) {
    return res.status(500).json({
      error:
        "Missing SHAPE_CRM_ID (or SHAPE_ACCOUNT_ID). Shape requires POST /search/lead/{crmid} — set your CRM id (e.g. 20931) in Vercel env or .env.",
    });
  }

  try {
    const crmPath = encodeURIComponent(String(crmId).trim());
    const shapeRes = await fetch(`${baseUrl}/search/lead/${crmPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: apiKey,
      },
      body: JSON.stringify({ lead_id }),
    });

    const text = await shapeRes.text();
    let json;
    try {
      json = text ? JSON.parse(text) : {};
    } catch {
      return res.status(502).json({ error: "Shape returned non-JSON", detail: text.slice(0, 500) });
    }

    if (!shapeRes.ok) {
      return res.status(shapeRes.status).json({
        error: "Shape search/lead failed",
        status: shapeRes.status,
        detail: json,
      });
    }

    const flat = normalizeLeadShape(unwrapLead(json));
    res.setHeader("X-Shape-Lead-Source", "live");
    return res.status(200).json(flat);
  } catch (err) {
    return res.status(502).json({
      error: "Shape request failed",
      message: err && err.message ? String(err.message) : String(err),
    });
  }
};
