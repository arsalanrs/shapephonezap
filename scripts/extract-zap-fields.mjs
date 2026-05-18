#!/usr/bin/env node
/**
 * Reads "Fields to zap now.docx" (green-highlighted list items) and emits
 * fields-to-zap.json with Shape API keys + labels.
 *
 * Run from project root:
 *   node scripts/extract-zap-fields.mjs
 *
 * Requires: unzip in PATH (reads word/document.xml from the docx zip).
 */

import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DOCX = join(ROOT, "Fields to zap now.docx");
const OUT = join(ROOT, "fields-to-zap.json");

function readDocumentXml() {
  return execFileSync("unzip", ["-p", DOCX, "word/document.xml"], {
    encoding: "utf8",
    maxBuffer: 4 * 1024 * 1024,
  });
}

function extractGreenLabels(xml) {
  const paras = xml.split("</w:p>");
  const labels = [];
  for (const p of paras) {
    if (!p.includes('w:highlight w:val="green"')) continue;
    const texts = [...p.matchAll(/<w:t[^>]*>([^<]*)<\/w:t>/g)].map((m) =>
      m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    );
    const line = texts.join("").replace(/\s+/g, " ").trim();
    if (line) labels.push(line);
  }
  return labels;
}

/**
 * Ordered mapping from docx green labels (see Fields to zap now.docx).
 * Duplicate labels like "City" are disambiguated by list order within the doc.
 */
const ORDERED_KEYS = [
  "firstname",
  "lastname",
  "phone",
  "email",
  "boraddress",
  "borcity",
  "borstate",
  "borzip",
  "prStreetAddress",
  "prAddressLine2",
  "prCity",
  "prState",
  "prZip",
  "prCounty",
  "prCountry",
  "qkapppropertyType",
  "qkappnumberOfunits",
  "qkappestAppraisalVal",
  "propropertyUse",
  "qkapppurpose",
  "LoanAmount",
  "borcreditscore",
  "notes_sidebar",
  "boryearsAtpresent",
  "bormonthsAtCurrent",
  "bormaritalstatusdetails",
  "borcitizenship",
  "leadveteran",
  "bornumOfdepend",
  "borageOfdepend",
  "borempinfoEmpPosition",
  "borempinfoEmpType",
  "cobformDate",
  "cobtoDate",
  "altpayFrequency",
  "boremployer",
  "boryearsonjob",
  "borempaddress",
  "borempPhone",
  "altempcontactWork",
  "boryearsInwork",
  "altemploymentHistory",
];

function main() {
  const xml = readDocumentXml();
  const labels = extractGreenLabels(xml);
  if (labels.length !== ORDERED_KEYS.length) {
    console.error(
      `Label count mismatch: docx has ${labels.length}, ORDERED_KEYS has ${ORDERED_KEYS.length}.`
    );
    console.error("Docx labels:", JSON.stringify(labels, null, 2));
    process.exit(1);
  }
  const fields = labels.map((label, i) => ({
    key: ORDERED_KEYS[i],
    label,
  }));
  const payload = {
    source: "Fields to zap now.docx",
    generatedBy: "scripts/extract-zap-fields.mjs",
    fields,
  };
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + "\n", "utf8");
  console.log(`Wrote ${OUT} (${fields.length} fields).`);
}

main();
