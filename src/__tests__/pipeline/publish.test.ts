import { buildWorkbookRows, toWorkbookRow, validateRecord, buildNextStep, assertNoPrivateData, WORKBOOK_COLUMNS, type ApprovedRecord } from "../../lib/pipeline/publish-bridge";
import { buildDigest, sourceAlerts } from "../../lib/pipeline/digest";
import { decide, listInbox, getForReview, reconcileEdits, type Ctx, type InboxDeps } from "../../lib/pipeline/inbox";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, d = "") => { c ? pass++ : fail++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${c ? "" : `  -> ${d}`}`); };

const RAW = "Applicants must be currently enrolled in a Master's or PhD program. A minimum cumulative GPA of 3.0 is required. We do not provide visa sponsorship for internships. Hourly rate: $32.00 - $41.00 per hour. Application requires a resume and an unofficial transcript.";
const F = (value: string, quote: string | null = null) => ({ value, quote });
const base = (over: Partial<ApprovedRecord> = {}): ApprovedRecord => ({
  employer: "CAS", roleTitle: "2027 Bioinformatics Scientist Summer Intern",
  sourceUrl: "https://boards.greenhouse.io/example/jobs/6543210", checkedOn: "2026-09-08",
  audienceBucket: "graduate", audienceReason: "Master's students explicitly accepted; GPA and sponsorship rules are personal gates that some CSULB students meet.",
  status: "Open - current 2027 role", urgency: "Apply now",
  lanes: ["Bioinformatics and computational biology"], methods: ["python", "sql"], functions: ["Summer internship"],
  fields: {
    masters_eligibility: F("Master's or PhD accepted", "currently enrolled in a Master's or PhD program"),
    gpa_requirement: F("3.0 cumulative required", "minimum cumulative GPA of 3.0 is required"),
    work_authorization: F("No visa sponsorship", "We do not provide visa sponsorship for internships"),
    deadline: F("Unknown", null), location: F("Columbus, OH", null),
    required_materials: F("Resume and unofficial transcript", "requires a resume and an unofficial transcript"),
    application_steps: F("Unknown", null), methods_named: F("Python, SQL", null),
    dates: F("May to August 2027", null), schedule_format: F("On-site", null), hours_per_week: F("Unknown", null),
    degree_fields: F("Bioinformatics or related quantitative field", null),
    enrollment_rule: F("Unknown", null), return_rule: F("Unknown", null), graduation_window: F("Unknown", null),
  },
  ...over,
});

console.log("=== Workbook shape matches the exporter ===\n");
{
  const row = toWorkbookRow(base());
  ok("all 22 exporter columns present", WORKBOOK_COLUMNS.every((c) => c in row), WORKBOOK_COLUMNS.filter((c) => !(c in row)).join(","));
  ok("no extra columns (exporter rejects unknown headers)", Object.keys(row).length === WORKBOOK_COLUMNS.length, String(Object.keys(row).length));
  ok("checked date is YYYY-MM-DD", /^\d{4}-\d{2}-\d{2}$/.test(row.Checked));
  ok("bucket + reason carried through", row["Audience bucket"] === "graduate" && row["Audience reason"].length > 40);
  ok("blank optionals become Unknown, never empty", Object.values(row).every((v) => v.trim() !== ""));
  ok("tier-2 detail reaches the workbook", row["Eligibility flags"].includes("3.0"), row["Eligibility flags"]);
  ok("required materials merged", row["Required materials"].includes("unofficial transcript"), row["Required materials"]);
}

console.log("\n=== Next step is derived from missing evidence, not written by a model ===\n");
{
  ok("unknown deadline -> tells the student to check", /check the live posting for a deadline/.test(buildNextStep(base())));
  const complete = base({ fields: { ...base().fields, deadline: F("Nov 30, 2026", "final Nov 30, 2026") } });
  ok("known deadline -> apply by it", /Apply by Nov 30, 2026/.test(buildNextStep(complete)), buildNextStep(complete));
  const special = base({ audienceBucket: "special", audienceReason: "Requires Indiana education affiliation, which most CSULB graduate students cannot meet." });
  ok("special -> confirm the structural requirement", /structural requirement/.test(buildNextStep(special)));
  const excluded = base({ audienceBucket: "excluded", audienceReason: "Undergraduate-only program; the posting states applicants must be enrolled in a bachelor's degree." });
  ok("excluded -> not an application target", /Not an application target/.test(buildNextStep(excluded)));
  const noElig = base({ fields: { ...base().fields, masters_eligibility: F("Unknown", null) } });
  ok("unknown eligibility -> ask recruiting first", /ask recruiting whether master's students are eligible/.test(buildNextStep(noElig)), buildNextStep(noElig));
}

console.log("\n=== Validation mirrors the exporter, so failures surface early ===\n");
{
  ok("clean record has no issues", validateRecord(base()).length === 0, JSON.stringify(validateRecord(base())));
  ok("bad URL caught", validateRecord(base({ sourceUrl: "notaurl" })).some((i) => i.field === "Official source"));
  ok("bad date caught", validateRecord(base({ checkedOn: "Sept 8 2026" })).some((i) => i.field === "Checked"));
  ok("invalid bucket caught", validateRecord(base({ audienceBucket: "maybe" as never })).some((i) => i.field === "Audience bucket"));
  ok("vague excluded reason caught", validateRecord(base({ audienceBucket: "excluded", audienceReason: "Not relevant." })).some((i) => /specific exclusion reason/.test(i.message)));
  ok("adjacent without a term explanation caught", validateRecord(base({ audienceBucket: "adjacent", audienceReason: "This one is a bit different from the others we list." })).some((i) => /term, program-type/.test(i.message)));
  const adjacentOk = base({ audienceBucket: "adjacent", audienceReason: "Six-month Spring 2027 co-op, outside the Summer 2027 target term." });
  ok("adjacent WITH an explanation passes", validateRecord(adjacentOk).length === 0, JSON.stringify(validateRecord(adjacentOk)));
}

console.log("\n=== Privacy boundary ===\n");
{
  let threw = false;
  try { assertNoPrivateData({ ...toWorkbookRow(base()), "Recommended next step": "Email jane.doe@student.csulb.edu for details" } as never); } catch { threw = true; }
  ok("email in a cell aborts publication", threw);
  threw = false;
  try { assertNoPrivateData({ ...toWorkbookRow(base()), "Eligibility flags": "Submitted by A. Student" } as never); } catch { threw = true; }
  ok("submitter attribution aborts publication", threw);
  ok("employer GPA rule is allowed (it describes the role)", toWorkbookRow(base())["Eligibility flags"].includes("3.0"));
}

console.log("\n=== Batch behaviour ===\n");
{
  const good = buildWorkbookRows([base(), base({ employer: "NIH", roleTitle: "SIP" })]);
  ok("two valid records -> two rows", good.rows.length === 2 && good.issues.length === 0, JSON.stringify(good.issues));
  ok("counts by bucket", good.counts.graduate === 2, JSON.stringify(good.counts));
  const dup = buildWorkbookRows([base(), base()]);
  ok("duplicate detected", dup.issues.some((i) => /duplicate/.test(i.message)));
  ok("NO rows emitted when anything fails", dup.rows.length === 0);
  const partial = buildWorkbookRows([base(), base({ employer: "X", roleTitle: "Y", sourceUrl: "ftp://x" })]);
  ok("one bad record blocks the whole batch", partial.rows.length === 0 && partial.issues.length > 0);
}

console.log("\n=== Weekly digest ===\n");
{
  const digest = buildDigest({
    generatedOn: "2026-09-14",
    pendingReviews: [
      { employer: "NIH", title: "SIP", url: "https://x", priority: 40, suggestedBucket: "graduate", deadline: "Feb 15", evidenceOk: true, injectionFlagged: false, origin: "ingested" },
      { employer: "Shady Co", title: "Intern", url: "https://y", priority: 10, suggestedBucket: "graduate", deadline: null, evidenceOk: false, injectionFlagged: true, origin: "ingested" },
      { employer: "Student pick", title: "Lab intern", url: "https://z", priority: 60, suggestedBucket: "graduate", deadline: null, evidenceOk: true, injectionFlagged: false, origin: "submission" },
    ],
    staleRecords: [{ employer: "CAS", title: "Bioinformatics", checkedOn: "2026-08-20", daysSinceCheck: 25, url: "https://c" }],
    sourceHealth: [
      { employer: "Genentech", kind: "greenhouse", consecutiveErrors: 3, recentCandidates: 4, hadCandidatesBefore: true, bindingFailureRate: 0.05, lastError: "HTTP 503" },
      { employer: "Jefferson", kind: "page", consecutiveErrors: 0, recentCandidates: 0, hadCandidatesBefore: true, bindingFailureRate: null, lastError: null },
      { employer: "Duke", kind: "page", consecutiveErrors: 0, recentCandidates: 2, hadCandidatesBefore: true, bindingFailureRate: 0.4, lastError: null },
    ],
    publishedCounts: { graduate: 10, special: 1, adjacent: 3 },
    openWindows: [{ employer: "NIH", window: "mid-Nov to mid-Feb", closes: "2027-02-15" }],
  });
  ok("subject summarizes the work", /3 to review/.test(digest.subject) && /source alert/.test(digest.subject), digest.subject);
  ok("flagged items get their own section", /NEEDS CAREFUL READING/.test(digest.text));
  ok("injection reason stated plainly", /injection pattern in posting/.test(digest.text));
  ok("submissions surfaced separately", /STUDENT AND OFFICER SUBMISSIONS/.test(digest.text));
  ok("stale records included", /STALE PUBLISHED RECORDS/.test(digest.text) && /25 days ago/.test(digest.text));
  ok("silent-source drift alerted", digest.alerts.some((a) => /returned nothing for 30 days/.test(a)), digest.alerts.join(" | "));
  ok("binding-rate spike alerted", digest.alerts.some((a) => /40% of extractions/.test(a)));
  ok("consecutive failures alerted", digest.alerts.some((a) => /2 consecutive failure|3 consecutive failure/.test(a)), digest.alerts.join(" | "));
  ok("email states nothing was published", /Nothing in this email has been published/.test(digest.text));
  ok("action count adds up", digest.actionCount === 3 + 1 + digest.alerts.length, String(digest.actionCount));

  const quiet = buildDigest({ generatedOn: "2026-09-21", pendingReviews: [], staleRecords: [], sourceHealth: [], publishedCounts: { graduate: 10 }, openWindows: [] });
  ok("all-clear week says so", /all clear/.test(quiet.subject) && /Nothing needs a decision/.test(quiet.text));
  ok("circuit breaker message is distinct", sourceAlerts([{ employer: "X", kind: "lever", consecutiveErrors: 5, recentCandidates: 0, hadCandidatesBefore: false, bindingFailureRate: null, lastError: "404" }]).some((a) => /circuit breaker/.test(a)));
}

console.log("\n=== Officer inbox authorization and rules ===\n");
{
  const item = {
    id: "q1", state: "pending",
    candidate: { employer: "CAS", title: "Intern", url: "https://x", suggestedBucket: "graduate" },
    rawText: RAW,
    fields: { masters_eligibility: F("Master's accepted", "currently enrolled in a Master's or PhD program") },
    bindings: {},
  };
  const calls: any[] = [];
  const deps: InboxDeps = {
    async listQueue() { return [{ id: "q1" }]; },
    async getItem(id) { return id === "q1" ? { ...item } : null; },
    async saveDecision(input) { calls.push(input); },
    async publish(id, officerId) { calls.push({ published: id, officerId }); return { publishedId: "pub-1" }; },
  };
  const officer: Ctx = { officerId: "off-1", isActiveOfficer: true };
  const stranger: Ctx = { officerId: null, isActiveOfficer: false };

  ok("anonymous cannot list", (await listInbox(stranger, {}, deps)).status === 403);
  ok("anonymous cannot read an item", (await getForReview(stranger, "q1", deps)).status === 403);
  ok("anonymous cannot decide", (await decide(stranger, "q1", { state: "approved", bucket: "graduate", reason: "x".repeat(30) }, deps)).status === 403);
  ok("officer can list", (await listInbox(officer, {}, deps)).status === 200);

  ok("approve without a bucket is rejected", (await decide(officer, "q1", { state: "approved", reason: "x".repeat(30) }, deps)).status === 400);
  ok("approve with an invalid bucket is rejected", (await decide(officer, "q1", { state: "approved", bucket: "maybe", reason: "x".repeat(30) }, deps)).status === 400);
  ok("approve without a reason is rejected", (await decide(officer, "q1", { state: "approved", bucket: "graduate" }, deps)).status === 400);
  ok("excluded needs a longer reason", (await decide(officer, "q1", { state: "approved", bucket: "excluded", reason: "Closed already now" }, deps)).status === 400);
  ok("reject without a note is refused", (await decide(officer, "q1", { state: "rejected" }, deps)).status === 400);

  const approved = await decide(officer, "q1", { state: "approved", bucket: "graduate", reason: "Master's students explicitly accepted in the posting." }, deps);
  ok("valid approval publishes", approved.status === 200 && (approved.body as any).publishedId === "pub-1");
  ok("decision attributed to the officer", calls[0].officerId === "off-1" && calls[0].state === "approved");
  ok("publication attributed too", calls[1].officerId === "off-1");

  const detail = await getForReview(officer, "q1", deps);
  ok("review view returns highlight offsets", Array.isArray((detail.body as any).highlights) && (detail.body as any).highlights[0].start >= 0);
  ok("missing item 404s", (await getForReview(officer, "nope", deps)).status === 404);
}

console.log("\n=== Officer edits cannot inherit a stale citation ===\n");
{
  const edited = {
    masters_eligibility: F("Master's accepted", "currently enrolled in a Master's or PhD program"), // still true
    gpa_requirement: F("3.5 required", "minimum cumulative GPA of 3.0 is required"),               // officer typo: quote no longer supports it
    deadline: F("Nov 30", "the deadline is November 30"),                                          // quote not in source at all
  };
  const { fields, unquoted } = reconcileEdits(edited, RAW);
  ok("valid quote kept", fields.masters_eligibility.quote !== null);
  ok("quote dropped when it no longer supports the edited value", fields.deadline.quote === null && unquoted.includes("deadline"));
  ok("officer value preserved even when uncited", fields.deadline.value === "Nov 30");
  // The GPA case: value changed but the quote still binds literally. Binding
  // cannot catch this -- it is exactly why the eval golden set exists too.
  ok("literal-but-misleading quote survives binding (known limit, documented)", fields.gpa_requirement.quote !== null);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
