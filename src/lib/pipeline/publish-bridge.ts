/**
 * publish-bridge.ts — closes the loop.
 *
 *   review_queue (approved) -> published_opportunities -> workbook rows -> data.js
 *
 * The exporter (scripts/extract-data.mjs) validates independently and refuses
 * anything missing a source, with a bad date, or carrying a private field. This
 * bridge exists so that what officers approve arrives in exactly the shape that
 * validator expects -- and so a failure is caught here, in a test, rather than
 * at publication time.
 *
 * PRIVACY BOUNDARY: this is the last point where personal data could leak into
 * a public artifact. `assertNoPrivateData` runs on every row and throws.
 */
import type { ExtractedField } from "./evidence";

/** Exact column headers the exporter expects on the Opportunity Board sheet. */
export const WORKBOOK_COLUMNS = [
  "Status", "Urgency", "Employer", "Role or program", "Opportunity type",
  "Scientific focus", "Location", "Work format", "Degree level", "Master's eligibility",
  "Enrollment / return rule", "Work authorization", "Dates", "Deadline or opening",
  "Required materials", "Eligibility flags", "Good fit for students who want...",
  "Recommended next step", "Official source", "Checked", "Audience bucket", "Audience reason",
] as const;

export type WorkbookRow = Record<(typeof WORKBOOK_COLUMNS)[number], string>;

export interface ApprovedRecord {
  employer: string;
  roleTitle: string;
  sourceUrl: string;
  checkedOn: string;               // YYYY-MM-DD
  audienceBucket: "graduate" | "special" | "adjacent" | "excluded";
  audienceReason: string;
  fields: Record<string, ExtractedField>;
  /** Officer-set, not model-derived. */
  status: string;
  urgency: string;
  lanes: string[];
  methods: string[];
  functions: string[];
}

const UNKNOWN = "Unknown";
const value = (fields: Record<string, ExtractedField>, key: string): string => {
  const raw = fields[key]?.value?.trim();
  return raw && raw !== "" ? raw : UNKNOWN;
};

/** Join several extracted fields into one workbook cell without inventing text. */
const joinFields = (fields: Record<string, ExtractedField>, keys: string[]): string => {
  const parts = keys.map((k) => value(fields, k)).filter((v) => v !== UNKNOWN);
  return parts.length ? parts.join("; ") : UNKNOWN;
};

const PRIVATE_PATTERNS: [RegExp, string][] = [
  [/[\w.+-]+@[\w-]+\.[\w.-]+/, "an email address"],
  [/\(?\b\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/, "a phone number"],
  [/\b(my|our) (gpa|resume|transcript|application|visa|citizenship)\b/i, "first-person personal information"],
  [/\bapplied on\b|\binterview(ed)? (scheduled|on)\b|\bfollowed up\b/i, "personal application history"],
  [/\bsubmitted by\b|\bsubmitter\b|\breferred by\b/i, "submitter attribution"],
];

export function assertNoPrivateData(row: WorkbookRow): void {
  for (const [column, cell] of Object.entries(row)) {
    for (const [pattern, label] of PRIVATE_PATTERNS) {
      if (pattern.test(cell)) {
        throw new Error(`PRIVACY: column "${column}" contains ${label}. Publication aborted.`);
      }
    }
  }
}

const ADJACENT_GROUNDS = /spring|fall|winter|co-?op|year-?long|post-?bac|not a graduate internship|career stage|outside (the )?summer|\bterm\b|program type/i;
const EXCLUSION_GROUNDS = /closed|expired|no longer|undergraduate|bachelor|incompatible|unverifiable|not verifiable|withdrawn|out(side)? of scope|outside scope|cancel/i;

export interface BridgeIssue { record: string; field: string; message: string }

/** Same rules the exporter enforces, applied here so failures surface early. */
export function validateRecord(record: ApprovedRecord): BridgeIssue[] {
  const issues: BridgeIssue[] = [];
  const where = `${record.employer} / ${record.roleTitle}`;
  const need = (field: string, text: string) => {
    if (!text || !text.trim()) issues.push({ record: where, field, message: "missing required value" });
  };
  need("Employer", record.employer);
  need("Role or program", record.roleTitle);
  need("Status", record.status);
  need("Audience reason", record.audienceReason);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(record.checkedOn)) {
    issues.push({ record: where, field: "Checked", message: `"${record.checkedOn}" is not YYYY-MM-DD` });
  }
  try {
    const url = new URL(record.sourceUrl);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error();
  } catch {
    issues.push({ record: where, field: "Official source", message: `"${record.sourceUrl}" is not a valid http(s) URL` });
  }
  if (!["graduate", "special", "adjacent", "excluded"].includes(record.audienceBucket)) {
    issues.push({ record: where, field: "Audience bucket", message: `"${record.audienceBucket}" is not in the controlled list` });
  }
  if (record.audienceBucket === "excluded" && (record.audienceReason.length < 40 || !EXCLUSION_GROUNDS.test(record.audienceReason))) {
    issues.push({ record: where, field: "Audience reason", message: "excluded records need a specific exclusion reason of at least 40 characters" });
  }
  if (record.audienceBucket === "adjacent" && !ADJACENT_GROUNDS.test(record.audienceReason)) {
    issues.push({ record: where, field: "Audience reason", message: "adjacent records must explain the term, program-type or career-stage mismatch" });
  }
  return issues;
}

export function toWorkbookRow(record: ApprovedRecord): WorkbookRow {
  const f = record.fields;
  const row: WorkbookRow = {
    "Status": record.status,
    "Urgency": record.urgency || UNKNOWN,
    "Employer": record.employer,
    "Role or program": record.roleTitle,
    "Opportunity type": record.functions.length ? record.functions.join("; ") : UNKNOWN,
    "Scientific focus": record.lanes.length ? record.lanes.join("; ") : UNKNOWN,
    "Location": value(f, "location"),
    "Work format": joinFields(f, ["schedule_format", "hours_per_week"]),
    "Degree level": value(f, "degree_fields"),
    "Master's eligibility": value(f, "masters_eligibility"),
    "Enrollment / return rule": joinFields(f, ["enrollment_rule", "return_rule", "graduation_window"]),
    "Work authorization": value(f, "work_authorization"),
    "Dates": value(f, "dates"),
    "Deadline or opening": value(f, "deadline"),
    // Tier-2 and tier-3 fields that previously had nowhere to go now land here,
    // which is where the J&J-style detail becomes visible to students.
    "Required materials": joinFields(f, ["required_materials", "application_steps", "recommendation_letters"]),
    "Eligibility flags": joinFields(f, ["gpa_requirement", "degree_fields"]),
    "Good fit for students who want...": joinFields(f, ["methods_named", "mentor_or_team", "publication_policy"]),
    "Recommended next step": buildNextStep(record),
    "Official source": record.sourceUrl,
    "Checked": record.checkedOn,
    "Audience bucket": record.audienceBucket,
    "Audience reason": record.audienceReason,
  };
  assertNoPrivateData(row);
  return row;
}

/**
 * The next step is DERIVED from what the evidence says is missing, not written
 * by a model. If eligibility is unknown, the step is to ask. If a deadline is
 * known, the step is to apply by it.
 */
export function buildNextStep(record: ApprovedRecord): string {
  const f = record.fields;
  const unknown = (key: string) => value(f, key) === UNKNOWN;
  if (record.audienceBucket === "excluded") return "Kept as evidence only. Not an application target.";
  if (record.audienceBucket === "special") return "Confirm you can meet the published structural requirement before investing time.";
  const steps: string[] = [];
  if (unknown("masters_eligibility")) steps.push("ask recruiting whether master's students are eligible");
  if (unknown("work_authorization")) steps.push("confirm the sponsorship policy");
  if (unknown("deadline")) steps.push("check the live posting for a deadline");
  if (steps.length === 0) {
    const deadline = value(f, "deadline");
    return record.audienceBucket === "adjacent"
      ? `Strategic alternative. Apply by ${deadline} if you are targeting this term.`
      : `Requirements are stated. Apply by ${deadline}.`;
  }
  return `Before tailoring materials, ${steps.join(", then ")}.`;
}

export interface BridgeResult {
  rows: WorkbookRow[];
  issues: BridgeIssue[];
  counts: Record<string, number>;
}

export function buildWorkbookRows(records: ApprovedRecord[]): BridgeResult {
  const issues = records.flatMap(validateRecord);
  const seen = new Set<string>();
  for (const record of records) {
    const key = `${record.employer}::${record.roleTitle}`.toLowerCase();
    if (seen.has(key)) issues.push({ record: key, field: "Employer + Role", message: "duplicate record" });
    seen.add(key);
  }
  // Never emit rows when validation failed: a half-valid workbook is worse than none.
  if (issues.length) return { rows: [], issues, counts: {} };
  const rows = records.map(toWorkbookRow);
  const counts = records.reduce<Record<string, number>>((acc, r) => {
    acc[r.audienceBucket] = (acc[r.audienceBucket] ?? 0) + 1;
    return acc;
  }, {});
  return { rows, issues: [], counts };
}
