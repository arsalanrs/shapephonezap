/**
 * Quest Rock — Shape transcript review (UI + wiring).
 *
 * Shape (server): GET /api/shape-lead → POST secure-api…/search/lead
 *                  POST /api/shape-update → POST …/update/lead/info
 * OpenAI (server): POST /api/extract — set OPENAI_API_KEY (optional OPENAI_MODEL, default gpt-4o-mini).
 */

const $ = (id) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing #${id}`);
  return el;
};

let zapFieldEntries = [];
let parsedLead = null;
let usingMockLead = false;
let transcriptFiles = [];
let combinedTranscriptText = "";
let reviewRows = [];
let lastPayload = null;

function setStatus(text, kind = "idle") {
  const b = $("status-badge");
  b.textContent = text;
  b.className = "status-badge status-" + kind;
}

function show(el, text) {
  el.hidden = false;
  el.textContent = text;
}
function hide(el) {
  el.hidden = true;
  el.textContent = "";
}

function isEmptyValue(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === "string") return v.trim() === "";
  if (typeof v === "number") return Number.isNaN(v);
  if (Array.isArray(v)) return v.length === 0;
  if (typeof v === "object") return Object.keys(v).length === 0;
  return false;
}

function formatCellValue(v) {
  if (v === undefined) return "";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function valuesEqual(a, b) {
  return formatCellValue(a) === formatCellValue(b);
}

/** Field keys allowed for extraction (from fields-to-zap.json only). */
function getZapFieldKeys() {
  return zapFieldEntries.map((e) => e.key).filter(Boolean);
}

function syncLeadIdFromLead() {
  if (!parsedLead) return;
  const id = parsedLead.leadid ?? parsedLead.leadId ?? parsedLead.LeadId ?? parsedLead.id ?? "";
  if (id) $("lead-id").value = String(id);
}

function buildLocalMockLead(leadId) {
  const keys = getZapFieldKeys();
  const lead = { leadid: String(leadId) };
  const useKeys = keys.length ? keys : ["firstname", "lastname", "email", "phone", "LoanAmount"];
  for (const k of useKeys) {
    if (k === "lastname") lead[k] = "DemoBorrower";
    else if (k === "email") lead[k] = "sam.demo@questrock.test";
    else if (k === "prCountry") lead[k] = "United States";
    else lead[k] = null;
  }
  return lead;
}

async function fetchLeadFromShape(leadId) {
  const id = String(leadId).trim();
  if (!id) throw new Error("Enter a Lead ID.");

  usingMockLead = false;
  try {
    const res = await fetch(`/api/shape-lead?leadId=${encodeURIComponent(id)}`);
    const ct = res.headers.get("content-type") || "";
    const text = await res.text();
    if (!ct.includes("application/json")) {
      throw new Error(
        "No JSON from /api/shape-lead — use `npm run dev` (includes API), not `npm run dev:static`, then reload."
      );
    }
    const data = JSON.parse(text);
    if (!res.ok) {
      if (res.status === 501) throw new Error(data.error || "Shape not configured.");
      const msg =
        typeof data.error === "string"
          ? data.error
          : data.error?.message || data.message || `Shape error (${res.status})`;
      throw new Error(msg);
    }
    if (res.headers.get("x-shape-lead-source") === "mock") usingMockLead = true;
    return data;
  } catch (e) {
    if (e instanceof TypeError) {
      /* no server */
    } else {
      throw e;
    }
  }
  usingMockLead = true;
  return buildLocalMockLead(id);
}

function renderLeadFields() {
  const tbody = $("fields-tbody");
  const section = $("section-fields");
  const emptyP = $("fields-empty");
  tbody.replaceChildren();

  if (!parsedLead || typeof parsedLead !== "object") {
    section.hidden = true;
    $("section-transcripts").hidden = true;
    return;
  }

  section.hidden = false;
  $("section-transcripts").hidden = false;

  const keys = Object.keys(parsedLead).sort((a, b) => a.localeCompare(b));
  let emptyC = 0;
  let filledC = 0;

  for (const key of keys) {
    const val = parsedLead[key];
    const empty = isEmptyValue(val);
    if (empty) emptyC += 1;
    else filledC += 1;

    const tr = document.createElement("tr");
    tr.classList.add(empty ? "row-empty" : "row-filled");

    const tdN = document.createElement("td");
    const spanN = document.createElement("span");
    spanN.className = "field-name";
    spanN.textContent = key;
    tdN.appendChild(spanN);
    tr.appendChild(tdN);

    const tdV = document.createElement("td");
    const fv = formatCellValue(val);
    const spanV = document.createElement("span");
    spanV.className = empty ? "field-value field-value--empty" : "field-value";
    spanV.textContent = empty ? "—" : fv.length > 240 ? `${fv.slice(0, 240)}…` : fv;
    if (!empty && fv.length > 240) spanV.title = fv;
    tdV.appendChild(spanV);
    tr.appendChild(tdV);

    const tdS = document.createElement("td");
    const pill = document.createElement("span");
    pill.className = "status-pill " + (empty ? "status-pill--empty" : "status-pill--filled");
    pill.textContent = empty ? "Empty" : "Filled";
    tdS.appendChild(pill);
    tr.appendChild(tdS);

    tbody.appendChild(tr);
  }

  emptyP.hidden = keys.length > 0;
  $("fields-summary").textContent = `${filledC} filled · ${emptyC} empty · ${keys.length} keys`;
}

async function loadZapFields() {
  try {
    const res = await fetch(new URL("fields-to-zap.json", import.meta.url), { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    if (!data.fields || !Array.isArray(data.fields)) throw new Error("bad json");
    zapFieldEntries = data.fields;
  } catch {
    zapFieldEntries = [];
  }
}

async function onLoadLead() {
  hide($("load-error"));
  hide($("mock-banner"));
  setStatus("Loading…", "loading");
  $("load-btn").disabled = true;

  try {
    const id = $("lead-id").value.trim();
    parsedLead = await fetchLeadFromShape(id);
    if (!parsedLead || typeof parsedLead !== "object" || Array.isArray(parsedLead)) {
      throw new Error("Invalid lead payload.");
    }
    syncLeadIdFromLead();
    renderLeadFields();
    $("mock-banner").hidden = !usingMockLead;
    setStatus(usingMockLead ? "Lead loaded (demo)" : "Lead loaded", "loaded");
    updateSubmitEnabled();
  } catch (e) {
    parsedLead = null;
    renderLeadFields();
    show($("load-error"), e.message || String(e));
    setStatus("Load failed", "error");
  } finally {
    $("load-btn").disabled = false;
  }
}

function updateSubmitEnabled() {
  const hasLead = !!parsedLead;
  $("submit-btn").disabled = !hasLead;
}

function renderFileChips() {
  const host = $("file-list");
  host.replaceChildren();
  transcriptFiles.forEach((file) => {
    const row = document.createElement("div");
    row.className = "file-chip";

    const name = document.createElement("span");
    name.className = "file-chip-name";
    name.textContent = file.name;
    name.title = file.name;
    row.appendChild(name);

    const rm = document.createElement("button");
    rm.type = "button";
    rm.className = "file-chip-remove";
    rm.setAttribute("aria-label", `Remove ${file.name}`);
    rm.textContent = "×";
    rm.addEventListener("click", () => {
      transcriptFiles = transcriptFiles.filter((f) => f !== file);
      renderFileChips();
    });
    row.appendChild(rm);

    host.appendChild(row);
  });
}

function addFiles(list) {
  const seen = new Set(transcriptFiles.map((f) => `${f.name}:${f.size}`));
  for (const f of list) {
    const k = `${f.name}:${f.size}`;
    if (!seen.has(k)) {
      seen.add(k);
      transcriptFiles.push(f);
    }
  }
  renderFileChips();
}

async function buildTranscriptBundle() {
  const parts = [];
  const pasted = $("transcript-text").value.trim();
  if (pasted) parts.push(`--- Pasted transcript ---\n\n${pasted}`);

  for (let i = 0; i < transcriptFiles.length; i++) {
    const f = transcriptFiles[i];
    const text = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ""));
      r.onerror = () => reject(r.error);
      r.readAsText(f);
    });
    parts.push(`--- File: ${f.name} ---\n\n${text}`);
  }
  combinedTranscriptText = parts.join("\n\n");
}

function extractWithOpenAIMock(body) {
  const { leadJson, transcriptsText, allowedFieldNames, forceFieldNames } = body;
  const force = new Set(forceFieldNames || []);
  const snippet = String(transcriptsText).slice(0, 100).replace(/\s+/g, " ");
  const sorted = [...new Set((allowedFieldNames || []).map((f) => String(f).trim()).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b)
  );
  const suggestions = [];
  for (const field of sorted) {
    const cur = leadJson[field];
    const empty = isEmptyValue(cur);
    let suggestedValue = "";
    let confidence = 0;
    if (empty) {
      suggestedValue = `(offline mock) ${field}${snippet ? ` — “${snippet}…”` : ""}`;
      confidence = 0.62;
    } else if (force.has(field)) {
      suggestedValue = `(offline mock overwrite) ${field}`;
      confidence = 0.55;
    }
    suggestions.push({ field, suggestedValue, confidence });
  }
  return { suggestions };
}

async function callExtract(body) {
  try {
    const res = await fetch("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const ct = res.headers.get("content-type") || "";
    const text = await res.text();
    if (ct.includes("application/json")) {
      const data = JSON.parse(text);
      if (!res.ok) {
        if (res.status === 501) {
          throw new Error(data.error || "OpenAI extraction not implemented on server.");
        }
        return extractWithOpenAIMock(body);
      }
      return data;
    }
  } catch (e) {
    const msg = e && e.message ? String(e.message) : String(e);
    if (msg.includes("not implemented")) throw e;
    if (e instanceof TypeError) return extractWithOpenAIMock(body);
    return extractWithOpenAIMock(body);
  }
  return extractWithOpenAIMock(body);
}

function renderReview() {
  const tbody = $("review-tbody");
  const sec = $("section-review");
  const empty = $("review-empty");
  tbody.replaceChildren();

  if (!reviewRows.length) {
    sec.hidden = true;
    $("payload-block").hidden = true;
    empty.hidden = false;
    $("approve-all-btn").disabled = true;
    $("clear-review-btn").disabled = true;
    $("build-payload-btn").disabled = true;
    $("copy-payload-btn").disabled = true;
    $("push-btn").disabled = true;
    return;
  }

  sec.hidden = false;
  $("payload-block").hidden = false;
  empty.hidden = true;
  $("approve-all-btn").disabled = false;
  $("clear-review-btn").disabled = false;
  $("build-payload-btn").disabled = false;
  $("copy-payload-btn").disabled = false;
  $("push-btn").disabled = false;

  const withAi = reviewRows.filter((r) => String(r.suggestedValue ?? "").trim() !== "").length;
  $("review-meta").textContent = `${reviewRows.length} allowlisted fields · ${withAi} with transcript-backed suggestions`;

  for (const row of reviewRows) {
    const tr = document.createElement("tr");

    const td1 = document.createElement("td");
    const s1 = document.createElement("span");
    s1.className = "field-name";
    s1.textContent = row.field;
    td1.appendChild(s1);
    tr.appendChild(td1);

    const td2 = document.createElement("td");
    td2.className = "field-value";
    td2.textContent = formatCellValue(row.currentValue) || "—";
    tr.appendChild(td2);

    const td3 = document.createElement("td");
    td3.className = "field-value";
    const sug = String(row.suggestedValue ?? "").trim();
    td3.textContent = sug || "—";
    if (!sug) td3.classList.add("field-value--empty");
    tr.appendChild(td3);

    const td4 = document.createElement("td");
    td4.textContent =
      typeof row.confidence === "number" && !Number.isNaN(row.confidence)
        ? row.confidence.toFixed(2)
        : "—";
    tr.appendChild(td4);

    const td5 = document.createElement("td");
    const inp = document.createElement("input");
    inp.type = "text";
    inp.className = "text-input cell-input";
    inp.value = row.approvedValue;
    inp.addEventListener("input", () => {
      row.approvedValue = inp.value;
    });
    td5.appendChild(inp);
    tr.appendChild(td5);

    tbody.appendChild(tr);
  }
}

function approveAll() {
  for (const r of reviewRows) r.approvedValue = r.suggestedValue;
  renderReview();
}

function buildPayload() {
  hide($("push-error"));
  hide($("push-success"));
  const leadId = $("lead-id").value.trim();
  if (!leadId) {
    show($("push-error"), "Lead ID missing.");
    return null;
  }
  if (!parsedLead) return null;

  const payload = { leadId };
  for (const row of reviewRows) {
    const cur = parsedLead[row.field];
    const approved = row.approvedValue.trim();
    if (approved === "") continue;
    if (valuesEqual(cur, approved)) continue;
    payload[row.field] = approved;
  }

  const keys = Object.keys(payload).filter((k) => k !== "leadId");
  if (!keys.length) {
    $("payload-output").textContent = "";
    lastPayload = null;
    $("copy-payload-btn").disabled = false;
    show($("push-error"), "No updates — approve values that differ from Shape.");
    return null;
  }

  lastPayload = payload;
  $("payload-output").textContent = JSON.stringify(payload, null, 2);
  $("copy-payload-btn").disabled = false;
  return payload;
}

async function onSubmitExtract() {
  hide($("submit-error"));
  if (!parsedLead) {
    show($("submit-error"), "Load a lead first.");
    return;
  }
  try {
    await buildTranscriptBundle();
  } catch {
    show($("submit-error"), "Could not read a transcript file.");
    return;
  }
  if (!combinedTranscriptText.trim()) {
    show($("submit-error"), "Add pasted transcript text and/or upload files.");
    return;
  }

  if (!getZapFieldKeys().length) {
    await loadZapFields();
  }
  const allowed = getZapFieldKeys();
  if (!allowed.length) {
    show($("submit-error"), "Missing fields-to-zap.json — add that file next to index.html and reload.");
    return;
  }

  setStatus("Extracting…", "loading");
  $("submit-btn").disabled = true;

  try {
    const { suggestions } = await callExtract({
      leadJson: parsedLead,
      transcriptsText: combinedTranscriptText,
      allowedFieldNames: allowed,
      forceFieldNames: [],
    });
    reviewRows = (suggestions || []).map((s) => ({
      field: s.field,
      currentValue: parsedLead[s.field],
      suggestedValue: String(s.suggestedValue ?? ""),
      confidence: s.confidence,
      approvedValue: "",
    }));
    renderReview();
    setStatus("Review ready", "loaded");
  } catch (e) {
    show($("submit-error"), e.message || String(e));
    setStatus("Extract failed", "error");
  } finally {
    $("submit-btn").disabled = false;
    updateSubmitEnabled();
  }
}

async function onPushShape() {
  hide($("push-error"));
  hide($("push-success"));
  const payload = buildPayload();
  if (!payload || Object.keys(payload).length <= 1) return;

  setStatus("Updating Shape…", "loading");
  $("push-btn").disabled = true;

  try {
    const res = await fetch("/api/shape-update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const ct = res.headers.get("content-type") || "";
    const text = await res.text();
    if (!ct.includes("application/json")) throw new Error(text || "Bad response");
    const data = JSON.parse(text);
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    show($("push-success"), "Update request completed. Verify in Shape CRM.");
    setStatus("Shape updated", "loaded");
  } catch (e) {
    if (e instanceof TypeError) {
      show($("push-error"), "No /api/shape-update — run `npm run dev` or deploy.");
    } else {
      show($("push-error"), e.message || String(e));
    }
    setStatus("Update failed", "error");
  } finally {
    $("push-btn").disabled = false;
  }
}

function wire() {
  $("load-btn").addEventListener("click", () => void onLoadLead());
  $("lead-id").addEventListener("keydown", (e) => {
    if (e.key === "Enter") void onLoadLead();
  });

  $("transcript-text").addEventListener("input", () => hide($("submit-error")));

  const uz = $("upload-zone");
  const fi = $("transcript-file");
  uz.addEventListener("dragover", (e) => {
    e.preventDefault();
    uz.classList.add("drag-over");
  });
  uz.addEventListener("dragleave", () => uz.classList.remove("drag-over"));
  uz.addEventListener("drop", (e) => {
    e.preventDefault();
    uz.classList.remove("drag-over");
    addFiles(Array.from(e.dataTransfer.files || []));
  });
  fi.addEventListener("change", () => {
    addFiles(Array.from(fi.files || []));
    fi.value = "";
  });

  $("submit-btn").addEventListener("click", () => void onSubmitExtract());
  $("approve-all-btn").addEventListener("click", approveAll);
  $("clear-review-btn").addEventListener("click", () => {
    reviewRows = [];
    renderReview();
    $("payload-output").textContent = "";
    lastPayload = null;
  });
  $("build-payload-btn").addEventListener("click", () => buildPayload());
  $("copy-payload-btn").addEventListener("click", async () => {
    hide($("push-success"));
    const payload = buildPayload();
    if (!payload) return;
    const t = $("payload-output").textContent;
    if (!t) return;
    try {
      await navigator.clipboard.writeText(t);
      show($("push-success"), "JSON copied.");
    } catch {
      show($("push-error"), "Copy failed.");
    }
  });
  $("push-btn").addEventListener("click", () => void onPushShape());
}

wire();
void loadZapFields();
renderLeadFields();
setStatus("Ready", "idle");
