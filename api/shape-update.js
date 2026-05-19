/**
 * POST /api/shape-update
 *
 * Proxies Shape **Update Lead Record**:
 * `POST {SHAPE_BASE_URL}/update/lead/info/{SHAPE_CRM_ID}` (same CRM id as lead search; see SetShape Open API).
 *
 * Client JSON: `{ "leadId": "<id>", ...fieldUpdates }` or `leadid` / `lead_id` (stripped before forwarding).
 * Shape body uses **`lead_id`** plus field updates.
 *
 * Headers to Shape: `Authorization: <API key>` (raw key from Settings → API Integrations; branch keys when using branching).
 *
 * Mock: when `SHAPE_API_KEY` / `SHAPE_ACCESS_TOKEN` is unset, returns `{ ok: true, mock: true }`.
 */

const DEFAULT_BASE = "https://secure-api.setshape.com/api";

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { requireSessionOr401 } = require("../lib/session.cjs");
  if (!requireSessionOr401(req, res)) return;

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body || "{}");
    } catch {
      return res.status(400).json({ error: "Invalid JSON body" });
    }
  }

  const leadId = body?.leadId ?? body?.leadid ?? body?.lead_id;
  if (leadId === undefined || leadId === null || String(leadId).trim() === "") {
    return res.status(400).json({ error: "leadId required in JSON body" });
  }

  const { leadId: _l1, leadid: _l2, lead_id: _l3, ...fields } = body;
  const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
  if (!keys.length) {
    return res.status(400).json({ error: "No fields to update" });
  }

  const apiKey = process.env.SHAPE_API_KEY || process.env.SHAPE_ACCESS_TOKEN;
  const baseUrl = (process.env.SHAPE_BASE_URL || DEFAULT_BASE).replace(/\/+$/, "");

  if (!apiKey) {
    res.setHeader("X-Shape-Update-Source", "mock");
    return res.status(200).json({
      ok: true,
      mock: true,
      leadId: String(leadId),
      updatedFieldCount: keys.length,
    });
  }

  const crmId = process.env.SHAPE_CRM_ID || process.env.SHAPE_ACCOUNT_ID || process.env.CRM_ID || "";
  if (!String(crmId).trim()) {
    return res.status(500).json({
      error:
        "Missing SHAPE_CRM_ID (or SHAPE_ACCOUNT_ID). Shape requires POST /update/lead/info/{crmid} — use the same CRM id as for /search/lead/{crmid}.",
    });
  }

  const lead_id = /^\d+$/.test(String(leadId)) ? Number(leadId) : leadId;
  const shapeBody = { lead_id, ...fields };

  try {
    const crmPath = encodeURIComponent(String(crmId).trim());
    const shapeRes = await fetch(`${baseUrl}/update/lead/info/${crmPath}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: apiKey,
      },
      body: JSON.stringify(shapeBody),
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
        error: "Shape update/lead/info/{crmid} failed",
        status: shapeRes.status,
        detail: json,
      });
    }

    res.setHeader("X-Shape-Update-Source", "live");
    return res.status(200).json(json);
  } catch (err) {
    return res.status(502).json({
      error: "Shape request failed",
      message: err && err.message ? String(err.message) : String(err),
    });
  }
};
