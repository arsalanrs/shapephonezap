/**
 * POST /api/extract
 * Body JSON: { leadJson, transcriptsText, allowedFieldNames, forceFieldNames? }
 * Uses OPENAI_API_KEY (server only). Optional OPENAI_MODEL (default gpt-4o-mini).
 * Returns: { suggestions: [{ field, suggestedValue, confidence? }] }
 */

function isEmptyValue(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (typeof v === "number") return Number.isNaN(v);
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
}

const MAX_LEAD_CHARS = 72_000;
const MAX_TRANSCRIPT_CHARS = 96_000;

const EXTRACT_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    name: "lead_transcript_extractions",
    strict: true,
    schema: {
      type: "object",
      properties: {
        suggestions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              field: { type: "string" },
              suggestedValue: { type: "string" },
              confidence: { type: "number" },
            },
            required: ["field", "suggestedValue", "confidence"],
            additionalProperties: false,
          },
        },
      },
      required: ["suggestions"],
      additionalProperties: false,
    },
  },
};

function truncate(s, max) {
  const str = String(s);
  if (str.length <= max) return str;
  return `${str.slice(0, max)}\n\n…[truncated — original length ${str.length}]`;
}

/** US state / territory common spellings → USPS abbreviation (Shape often expects 2 letters). */
const US_STATE_NAME_TO_ABBR = {
  alabama: "AL",
  alaska: "AK",
  arizona: "AZ",
  arkansas: "AR",
  california: "CA",
  colorado: "CO",
  connecticut: "CT",
  delaware: "DE",
  "district of columbia": "DC",
  florida: "FL",
  georgia: "GA",
  hawaii: "HI",
  idaho: "ID",
  illinois: "IL",
  indiana: "IN",
  iowa: "IA",
  kansas: "KS",
  kentucky: "KY",
  louisiana: "LA",
  maine: "ME",
  maryland: "MD",
  massachusetts: "MA",
  michigan: "MI",
  minnesota: "MN",
  mississippi: "MS",
  missouri: "MO",
  montana: "MT",
  nebraska: "NE",
  nevada: "NV",
  "new hampshire": "NH",
  "new jersey": "NJ",
  "new mexico": "NM",
  "new york": "NY",
  "north carolina": "NC",
  "north dakota": "ND",
  ohio: "OH",
  oklahoma: "OK",
  oregon: "OR",
  pennsylvania: "PA",
  "rhode island": "RI",
  "south carolina": "SC",
  "south dakota": "SD",
  tennessee: "TN",
  texas: "TX",
  utah: "UT",
  vermont: "VT",
  virginia: "VA",
  washington: "WA",
  "west virginia": "WV",
  wisconsin: "WI",
  wyoming: "WY",
};

const MONEY_LIKE_FIELDS = new Set(["LoanAmount", "qkappestAppraisalVal"]);

/** E.164-style US mobile when digits parse as 10 or 11 (leading 1). */
function normalizeUsPhoneToE164(raw) {
  const s = String(raw).trim();
  if (!s) return s;
  let d = s.replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length === 10) return `+1${d}`;
  return s;
}

function normalizeUsStateAbbrev(raw) {
  const t = String(raw).trim();
  if (!t) return t;
  if (/^[A-Za-z]{2}$/.test(t)) return t.toUpperCase();
  const key = t.toLowerCase().replace(/\./g, "").replace(/\s+/g, " ").trim();
  return US_STATE_NAME_TO_ABBR[key] || t;
}

/** Strip $ and commas when the value is clearly a plain numeric amount. */
function normalizePlainAmount(raw) {
  const t = String(raw).trim();
  if (!t) return t;
  const stripped = t.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d+)?$/.test(stripped)) return raw;
  return stripped;
}

function postNormalizeSuggestedValue(field, value) {
  let out = String(value ?? "").trim();
  if (!out) return out;
  const f = String(field);

  if (/phone/i.test(f)) {
    const e164 = normalizeUsPhoneToE164(out);
    if (/^\+1\d{10}$/.test(e164)) return e164;
  }

  if (f === "borstate" || f === "prState") {
    return normalizeUsStateAbbrev(out);
  }

  if (MONEY_LIKE_FIELDS.has(f)) {
    return normalizePlainAmount(out);
  }

  return out;
}

/**
 * Merge model output with the full allowlist: one row per allowed Shape key (sorted).
 * Missing / empty model rows become blank suggestions (confidence 0) so the review UI lists every field.
 */
function normalizeSuggestions(raw, leadJson, allowedSet, forceSet) {
  const byField = new Map();
  const list = Array.isArray(raw) ? raw : [];

  for (const row of list) {
    if (!row || typeof row.field !== "string") continue;
    const field = row.field.trim();
    if (!field || !allowedSet.has(field)) continue;

    let suggestedValue = row.suggestedValue;
    if (suggestedValue === null || suggestedValue === undefined) suggestedValue = "";
    else if (typeof suggestedValue === "number" || typeof suggestedValue === "boolean") suggestedValue = String(suggestedValue);
    else suggestedValue = String(suggestedValue);

    let confidence = Number(row.confidence);
    if (!Number.isFinite(confidence)) confidence = 0.75;
    confidence = Math.min(1, Math.max(0, confidence));

    const cur = leadJson[field];

    suggestedValue = postNormalizeSuggestedValue(field, suggestedValue);
    if (forceSet.has(field) && suggestedValue.trim() === "") {
      suggestedValue = cur === null || cur === undefined ? "" : String(cur);
      suggestedValue = postNormalizeSuggestedValue(field, suggestedValue);
    }

    byField.set(field, { field, suggestedValue, confidence });
  }

  const ordered = [...allowedSet].sort((a, b) => a.localeCompare(b));
  const out = [];
  for (const field of ordered) {
    let row = byField.get(field);
    if (!row) {
      row = { field, suggestedValue: "", confidence: 0 };
    }
    if (forceSet.has(field) && String(row.suggestedValue).trim() === "") {
      const cur = leadJson[field];
      const fill = cur === null || cur === undefined ? "" : String(cur);
      row = {
        field,
        suggestedValue: postNormalizeSuggestedValue(field, fill),
        confidence: Math.max(row.confidence, 0.35),
      };
    }
    out.push(row);
  }
  return out;
}

async function extractWithOpenAI({ leadJson, transcriptsText, allowedFieldNames, forceFieldNames }) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";

  const allowedSet = new Set(
    (Array.isArray(allowedFieldNames) ? allowedFieldNames : []).map((f) => String(f).trim()).filter(Boolean)
  );
  const forceSet = new Set(
    (Array.isArray(forceFieldNames) ? forceFieldNames : []).map((f) => String(f).trim()).filter(Boolean)
  );

  if (!allowedSet.size) {
    return { suggestions: [] };
  }

  const allowedCount = allowedSet.size;
  const allowedList = [...allowedSet].sort().join(", ");
  const forceList = forceSet.size ? [...forceSet].sort().join(", ") : "(none — use normal overwrite rules)";

  const system = `You are a senior mortgage sales coach, compliance-minded reviewer, and structured data extraction assistant for Quest Rock Home Loans.

You receive:
1) The current Shape CRM lead as JSON (some fields may already be filled).
2) One or more call transcripts (combined in order — treat them as one timeline; merge facts without contradiction; prefer the clearest or most recent statement when they conflict).

Your job is to propose updates the loan officer can apply in Shape. You respond ONLY via the provided JSON schema (a "suggestions" array). No markdown, no commentary outside the JSON.

Extraction & compliance rules:
- Map facts from the transcript(s) only to keys listed in the user message. Never invent field names; spelling/casing must match Shape exactly.
- You must return EXACTLY one suggestion object per allowed field key (${allowedCount} rows total). Same order as the sorted list in the user message is preferred.
- For each key: set "suggestedValue" from the transcript when you have supported evidence. If the transcript does not mention that field, set suggestedValue to an empty string "" and confidence to 0.
- Prefer filling fields that are empty or null in the lead JSON. Do NOT overwrite existing non-empty CRM values in suggestedValue unless the transcript clearly corrects or updates them (e.g., borrower corrects phone number, new purchase price). If the CRM already has a correct value and the transcript adds nothing new, use "" and confidence 0.
- Do not fabricate NPI (SSN, full account numbers, DOB) or addresses/emails/phones not stated in the transcript.
- Focus on mortgage-relevant content: DSCR and investment strategy when discussed, purchase price, units, loan amount/purpose, credit, subject property, borrower demographics, employment, timeline, rates/costs if explicitly stated.
- Normalize in your suggested strings:
  • US phone numbers → +1XXXXXXXXXX (10-digit NANP; strip formatting).
  • US states for state fields → 2-letter USPS abbreviations when the transcript gives a state.
  • Dollar amounts / loan sizes → plain digits only (no $ or commas) when the target field is clearly numeric in CRM (e.g. loan amount, appraisal value).
  • Dates/times: plain text is fine if an exact ISO date is not clear.

Each suggestion row must include:
- "field": allowed Shape key
- "suggestedValue": string (use "" when nothing to extract)
- "confidence": number from 0 to 1 reflecting transcript support; use 0 when suggestedValue is ""

FORCE keys (if any are listed in the user message): each must appear with transcript-backed value when possible; if impossible, use current CRM string as suggestedValue and confidence at least 0.35.`;

  const user = `There are ${allowedCount} allowed Shape CRM keys. Return exactly ${allowedCount} suggestion objects — one per key below (same spelling).

Allowed keys (sorted):
${allowedList}

FORCE keys (must each appear once in suggestions, even if unchanged):
${forceList}

Current lead JSON from Shape:
${truncate(JSON.stringify(leadJson), MAX_LEAD_CHARS)}

Transcript(s) — combined text from paste and/or uploads:
${truncate(String(transcriptsText), MAX_TRANSCRIPT_CHARS)}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      temperature: 0.15,
      max_completion_tokens: 12_000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      response_format: EXTRACT_RESPONSE_FORMAT,
    }),
  });

  const rawText = await res.text();
  let data;
  try {
    data = JSON.parse(rawText);
  } catch {
    const err = new Error(`OpenAI returned non-JSON (HTTP ${res.status})`);
    err.status = 502;
    throw err;
  }

  if (!res.ok) {
    const msg = data?.error?.message || data?.error || rawText.slice(0, 400) || `HTTP ${res.status}`;
    const err = new Error(`OpenAI: ${msg}`);
    err.status = res.status === 401 || res.status === 403 ? 401 : 502;
    throw err;
  }

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== "string" || !content.trim()) {
    const err = new Error("OpenAI returned an empty completion.");
    err.status = 502;
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    const err = new Error("OpenAI returned invalid JSON in message content.");
    err.status = 502;
    throw err;
  }

  const suggestions = normalizeSuggestions(parsed.suggestions, leadJson, allowedSet, forceSet);
  return { suggestions };
}

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

  const { leadJson, transcriptsText, allowedFieldNames = [], forceFieldNames = [] } = body || {};
  if (!leadJson || typeof leadJson !== "object") {
    return res.status(400).json({ error: "leadJson object required" });
  }
  if (!transcriptsText || String(transcriptsText).trim() === "") {
    return res.status(400).json({ error: "transcriptsText required" });
  }

  const hasOpenAI = Boolean(process.env.OPENAI_API_KEY);
  if (hasOpenAI) {
    try {
      const { suggestions } = await extractWithOpenAI({
        leadJson,
        transcriptsText,
        allowedFieldNames,
        forceFieldNames,
      });
      res.setHeader("X-Extract-Source", "openai");
      return res.status(200).json({ suggestions });
    } catch (e) {
      const status = e.status && Number.isInteger(e.status) ? e.status : 502;
      return res.status(status).json({ error: e.message || "OpenAI extraction failed" });
    }
  }

  const force = new Set(Array.isArray(forceFieldNames) ? forceFieldNames : []);
  const tx = String(transcriptsText);
  const snippet = tx.slice(0, 100).replace(/\s+/g, " ");

  const sorted = [...new Set((Array.isArray(allowedFieldNames) ? allowedFieldNames : []).map((f) => String(f).trim()).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b)
  );
  const suggestions = [];
  for (const field of sorted) {
    const cur = leadJson[field];
    const empty = isEmptyValue(cur);
    let suggestedValue = "";
    let confidence = 0;
    if (empty) {
      suggestedValue = `(demo) ${field}${snippet ? ` — “${snippet}…”` : ""}`;
      confidence = 0.62;
    } else if (force.has(field)) {
      suggestedValue = `(demo overwrite) ${field}`;
      confidence = 0.55;
    }
    suggestions.push({ field, suggestedValue, confidence });
  }

  res.setHeader("X-Extract-Source", "mock");
  return res.status(200).json({ suggestions });
};
