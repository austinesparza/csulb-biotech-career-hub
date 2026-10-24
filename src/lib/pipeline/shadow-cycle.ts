import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadTaxonomy } from "./classify";
import { bindExtraction, scanForInjection } from "./evidence";
import { EXTRACTION_FIELDS, SYSTEM_PROMPT, buildJsonSchema, type ExtractionField } from "./extraction-schema";
import { extractPosting } from "./extraction-runner";
import { validateExtractionShape } from "./extraction-validation";
import { redactContacts } from "./contact-redaction";
import { PROMPT_VERSION, SCHEMA_VERSION, type ExtractionModel } from "./worker";
import type { ExtractionInboxRow, PersistExtractionInput } from "./store-supabase";

export const VALIDATION_VERSION = "evidence-v2";
const MAX_TEXT_BYTES = 200_000;
export const MAX_BUNDLE_BYTES = 25_000_000;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const textHash = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

function versions() {
  const taxonomy = loadTaxonomy();
  return { schema: SCHEMA_VERSION, prompt: PROMPT_VERSION, validation: VALIDATION_VERSION,
    contractHash: hash({ fields: EXTRACTION_FIELDS, system: SYSTEM_PROMPT, schema: buildJsonSchema() }),
    taxonomyVersion: taxonomy.version, taxonomyHash: hash(taxonomy) };
}

export interface ShadowPosting {
  row: ExtractionInboxRow;
  originalTextHash: string;
  payloadHash: string;
  /** Optional officer labels. Never inferred from a model response. */
  expected?: Partial<Record<ExtractionField, string>>;
}

export interface ShadowBundle {
  format: 1;
  createdAt: string;
  versions: ReturnType<typeof versions>;
  postings: ShadowPosting[];
  id: string;
}

function bundleId(bundle: Omit<ShadowBundle, "id">): string {
  return hash({ format: bundle.format, versions: bundle.versions, postings: bundle.postings });
}

/** Read-only broker output: public posting evidence, no review notes or client configuration. */
export function createShadowBundle(rows: ExtractionInboxRow[]): ShadowBundle {
  const postings = rows.map(row => {
    if (!row.raw_text?.trim()) throw new Error(`posting ${row.source_posting_version_id} has no raw text`);
    if (Buffer.byteLength(row.raw_text, "utf8") > MAX_TEXT_BYTES) throw new Error("posting exceeds text limit; never truncate evidence");
    const rawText = redactContacts(row.raw_text);
    return { row: {
      source_posting_version_id: row.source_posting_version_id,
      source_posting_id: row.source_posting_id,
      opportunity_id: null,
      employer: row.employer,
      title: row.title,
      canonical_url: row.canonical_url,
      relevance_score: null,
      raw_text: rawText,
      created_at: row.created_at,
    }, originalTextHash: textHash(row.raw_text), payloadHash: textHash(rawText) };
  });
  return sealShadowBundle({ format: 1, createdAt: new Date().toISOString(), versions: versions(), postings });
}

/** Re-seal after adding independently reviewed labels to a benchmark copy. */
export function sealShadowBundle(bundle: Omit<ShadowBundle, "id">): ShadowBundle {
  const sealed = { ...bundle, id: bundleId(bundle) };
  validateShadowBundle(sealed);
  return sealed;
}

export function validateShadowBundle(input: unknown): asserts input is ShadowBundle {
  if (!input || typeof input !== "object") throw new Error("invalid shadow bundle");
  const bundle = input as ShadowBundle;
  if (bundle.format !== 1 || !Array.isArray(bundle.postings) || bundle.postings.length > 100
    || typeof bundle.createdAt !== "string" || typeof bundle.id !== "string"
    || hash(bundle.versions) !== hash(versions())) throw new Error("unsupported or stale shadow bundle contract");
  const seen = new Set<string>();
  const rowKeys = ["source_posting_version_id", "source_posting_id", "opportunity_id", "employer", "title", "canonical_url", "relevance_score", "raw_text", "created_at"];
  for (const posting of bundle.postings) {
    const row = posting?.row;
    if (!row || Object.keys(row).length !== rowKeys.length || Object.keys(row).some(key => !rowKeys.includes(key))
      || row.opportunity_id !== null || row.relevance_score !== null
      || rowKeys.filter(key => !["opportunity_id", "relevance_score"].includes(key))
        .some(key => typeof row[key as keyof ExtractionInboxRow] !== "string" || !String(row[key as keyof ExtractionInboxRow]).trim())) {
      throw new Error("invalid or unsanitized posting in shadow bundle");
    }
    const url = new URL(row.canonical_url);
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("posting requires an HTTPS source URL without credentials");
    if (Buffer.byteLength(row.raw_text!, "utf8") > MAX_TEXT_BYTES) throw new Error("posting exceeds text limit; split the batch, never truncate evidence");
    if (posting.payloadHash !== textHash(row.raw_text!) || !/^[a-f0-9]{64}$/.test(posting.originalTextHash)) throw new Error("posting evidence hash mismatch");
    if (seen.has(row.source_posting_version_id)) throw new Error("duplicate posting version in bundle");
    seen.add(row.source_posting_version_id);
    if (posting.expected !== undefined && (!posting.expected || typeof posting.expected !== "object" || Array.isArray(posting.expected)
      || Object.entries(posting.expected).some(([key, value]) => !Object.hasOwn(EXTRACTION_FIELDS, key) || typeof value !== "string" || !value.trim()))) {
      throw new Error("invalid officer labels");
    }
  }
  if (Buffer.byteLength(JSON.stringify(bundle)) > MAX_BUNDLE_BYTES) throw new Error("shadow bundle exceeds size limit");
  if (bundle.id !== bundleId(bundle)) throw new Error("shadow bundle manifest hash mismatch");
}

export interface ShadowRecord {
  key: string;
  sourcePostingVersionId: string;
  status: "review" | "quarantined" | "error";
  integrityOk?: boolean;
  extraction?: PersistExtractionInput;
  error?: string;
  elapsedMs: number;
}

export interface ShadowReport {
  bundleId: string;
  model: string;
  modelRevision: string;
  versions: ShadowBundle["versions"];
  resumed: number;
  records: ShadowRecord[];
  labels: { compared: number; matched: number; mismatches: Array<{ posting: string; field: string; expected: string; actual: string }> };
}

export async function atomicJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  await writeFile(temp, JSON.stringify(value, null, 2) + "\n", { mode: 0o600, flag: "wx" });
  await rename(temp, file);
}

function validCheckpoint(record: ShadowRecord, posting: ShadowPosting, key: string, model: string): boolean {
  if (record.key !== key || record.sourcePostingVersionId !== posting.row.source_posting_version_id
    || !["review", "quarantined"].includes(record.status) || typeof record.integrityOk !== "boolean"
    || !Number.isFinite(record.elapsedMs) || record.elapsedMs < 0 || !record.extraction) return false;
  const extraction = record.extraction;
  if (extraction.model !== model || extraction.sourcePostingVersionId !== record.sourcePostingVersionId
    || extraction.promptVersion !== PROMPT_VERSION || extraction.schemaVersion !== SCHEMA_VERSION
    || extraction.taxonomyVersion !== loadTaxonomy().version) return false;
  validateExtractionShape(extraction.fields, Object.keys(EXTRACTION_FIELDS));
  const binding = bindExtraction(extraction.fields, posting.row.raw_text!);
  const injection = scanForInjection(posting.row.raw_text!);
  const evidenceOk = binding.ok && record.integrityOk && !injection.flagged;
  return extraction.evidenceOk === evidenceOk && record.status === (evidenceOk ? "review" : "quarantined")
    && hash(extraction.bindings) === hash(binding.fields) && hash(extraction.injectionFlags) === hash(injection.hits);
}

/** Sequential, bounded, resumable execution. No database adapter or publication calls. */
export async function runShadowCycle(bundle: ShadowBundle, options: {
  model: ExtractionModel;
  modelRevision: string;
  outputDir: string;
  onProgress?: (record: ShadowRecord, completed: number) => void;
}): Promise<ShadowReport> {
  validateShadowBundle(bundle);
  if (!options.modelRevision.trim()) throw new Error("model revision/digest is required for reproducible checkpoints");
  const report: ShadowReport = { bundleId: bundle.id, model: options.model.name, modelRevision: options.modelRevision,
    versions: bundle.versions, resumed: 0, records: [], labels: { compared: 0, matched: 0, mismatches: [] } };
  const taxonomy = loadTaxonomy();
  for (const posting of bundle.postings) {
    // Officer labels affect evaluation, never the model's input or inference cache.
    const key = hash({ row: posting.row, originalTextHash: posting.originalTextHash, payloadHash: posting.payloadHash,
      versions: bundle.versions, model: options.model.name, revision: options.modelRevision });
    const checkpoint = path.join(options.outputDir, "checkpoints", `${key}.json`);
    const started = Date.now();
    let record: ShadowRecord;
    try {
      let cached: ShadowRecord | undefined;
      try {
        const envelope = JSON.parse(await readFile(checkpoint, "utf8")) as { record: ShadowRecord; checksum: string };
        if (hash(envelope.record) !== envelope.checksum || !validCheckpoint(envelope.record, posting, key, options.model.name)) {
          throw new Error("invalid checkpoint");
        }
        cached = envelope.record;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("checkpoint failed validation; remove it before rerunning", { cause: error });
      }
      if (cached) {
        record = cached;
        report.resumed += 1;
      } else {
        const result = await extractPosting(posting.row, { model: options.model, taxonomy });
        record = { key, sourcePostingVersionId: posting.row.source_posting_version_id,
          status: result.extraction.evidenceOk ? "review" : "quarantined", integrityOk: result.integrityOk,
          extraction: result.extraction, elapsedMs: Date.now() - started };
        await atomicJson(checkpoint, { record, checksum: hash(record) });
      }
    } catch (error) {
      record = { key, sourcePostingVersionId: posting.row.source_posting_version_id, status: "error",
        error: error instanceof Error ? error.message : String(error), elapsedMs: Date.now() - started };
    }
    report.records.push(record);
    for (const [field, expected] of Object.entries(posting.expected ?? {})) {
      const actual = record.extraction?.fields[field]?.value ?? "<extraction failed>";
      report.labels.compared += 1;
      if (actual.trim().toLowerCase() === expected!.trim().toLowerCase()) report.labels.matched += 1;
      else report.labels.mismatches.push({ posting: record.sourcePostingVersionId, field, expected: expected!, actual });
    }
    // Persist progress after each posting, including errors. Errors retry on the next manual run.
    await atomicJson(path.join(options.outputDir, "report.json"), report);
    options.onProgress?.(record, report.records.length);
  }
  await atomicJson(path.join(options.outputDir, "report.json"), report);
  await writeFile(path.join(options.outputDir, "review.md"), renderShadowReport(bundle, report), { mode: 0o600 });
  return report;
}

const markdown = (text: string) => text.replace(/[<>|`]/g, " ").replace(/[\r\n]+/g, " ");
export function renderShadowReport(bundle: ShadowBundle, report: ShadowReport): string {
  const count = (status: ShadowRecord["status"]) => report.records.filter(record => record.status === status).length;
  const lines = ["# Local extraction review", "", `Model: ${markdown(report.model)}; revision: ${markdown(report.modelRevision)}`,
    `Bundle: ${report.bundleId}`, "", `${count("review")} awaiting officer review; ${count("quarantined")} quarantined; ${count("error")} errors; ${report.resumed} resumed.`,
    "Passing guards does not prove factual accuracy or authorize publication.", "",
    report.labels.compared ? `Officer label matches: ${report.labels.matched}/${report.labels.compared} (normalized exact-value comparison).`
      : "No officer labels supplied. This is a guard report, not an accuracy benchmark.", ""];
  for (const record of report.records) {
    const posting = bundle.postings.find(item => item.row.source_posting_version_id === record.sourcePostingVersionId)!;
    lines.push(`## ${markdown(posting.row.employer)}: ${markdown(posting.row.title)}`, "", `Source: ${posting.row.canonical_url}`,
      `Posting version: ${record.sourcePostingVersionId}; payload hash: ${posting.payloadHash}`, `Status: ${record.status}`, "");
    if (record.error) lines.push(markdown(record.error), "");
    const extraction = record.extraction;
    if (!extraction) continue;
    lines.push(`Integrity: ${record.integrityOk ? "passed" : "failed"}; evidence guards: ${extraction.evidenceOk ? "passed" : "failed"}`,
      `Injection flags: ${extraction.injectionFlags.map(markdown).join(", ") || "none"}`,
      ...extraction.bindingFailures.map(failure => `- ${markdown(failure)}`), "", "| Field | Value | Supporting quote |", "| --- | --- | --- |");
    const unknown: string[] = [];
    for (const [name, field] of Object.entries(extraction.fields)) {
      if (field.value === "Unknown") unknown.push(name);
      else lines.push(`| ${name} | ${markdown(field.value)} | ${markdown(field.quote ?? "Missing")} |`);
    }
    lines.push("", `Unknown fields (${unknown.length}/${Object.keys(EXTRACTION_FIELDS).length}): ${unknown.join(", ")}`, "");
  }
  if (report.labels.mismatches.length) {
    lines.push("## Label mismatches", "", "| Posting | Field | Expected | Actual |", "| --- | --- | --- | --- |");
    for (const item of report.labels.mismatches) lines.push(`| ${markdown(item.posting)} | ${item.field} | ${markdown(item.expected)} | ${markdown(item.actual)} |`);
  }
  return lines.join("\n") + "\n";
}
