/**
 * digest.ts — intelligence-layer content for the Monday officer email.
 *
 * Audit finding: "Public submissions are stored safely, but officers cannot
 * currently review them in the app. They also do not appear in the weekly email."
 * This is the second half of that fix.
 *
 * Pure function: data in, text out. No mailer, no database. The existing
 * scripts/review-digest.mjs remains the only production query, Gmail transport,
 * and workflow entrypoint. Integrate this richer content there rather than
 * creating a second mailer or schedule.
 */

export interface DigestInput {
  generatedOn: string;                      // YYYY-MM-DD
  pendingReviews: {
    employer: string; title: string; url: string; priority: number;
    suggestedBucket: string; deadline: string | null;
    evidenceOk: boolean; injectionFlagged: boolean; origin: "ingested" | "submission";
  }[];
  staleRecords: { employer: string; title: string; checkedOn: string; daysSinceCheck: number; url: string }[];
  sourceHealth: {
    employer: string; kind: string; consecutiveErrors: number;
    recentCandidates: number; hadCandidatesBefore: boolean;
    bindingFailureRate: number | null; lastError: string | null;
  }[];
  publishedCounts: Record<string, number>;
  openWindows: { employer: string; window: string; closes: string | null }[];
}

export interface DigestOutput {
  subject: string;
  text: string;
  actionCount: number;
  alerts: string[];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Health rules. A parser returning nothing after previously returning some is
 *  drift, and it is the failure that quietly rots a pipeline. */
export function sourceAlerts(sources: DigestInput["sourceHealth"]): string[] {
  const alerts: string[] = [];
  for (const s of sources) {
    if (s.consecutiveErrors >= 5) alerts.push(`${s.employer} (${s.kind}): circuit breaker tripped after ${s.consecutiveErrors} failures — an officer must reset it. Last error: ${s.lastError ?? "unknown"}`);
    else if (s.consecutiveErrors >= 2) alerts.push(`${s.employer} (${s.kind}): ${plural(s.consecutiveErrors, "consecutive failure")}. Last error: ${s.lastError ?? "unknown"}`);
    if (s.recentCandidates === 0 && s.hadCandidatesBefore) alerts.push(`${s.employer} (${s.kind}): returned nothing for 30 days after previously returning postings — likely a changed page or endpoint, not an empty board.`);
    if (s.bindingFailureRate !== null && s.bindingFailureRate > 0.2) alerts.push(`${s.employer}: ${(s.bindingFailureRate * 100).toFixed(0)}% of extractions failed evidence binding — check whether the page layout changed.`);
  }
  return alerts;
}

export function buildDigest(input: DigestInput): DigestOutput {
  const alerts = sourceAlerts(input.sourceHealth);
  const queue = [...input.pendingReviews].sort((a, b) => a.priority - b.priority);
  const flagged = queue.filter((q) => !q.evidenceOk || q.injectionFlagged);
  const submissions = queue.filter((q) => q.origin === "submission");
  const actionCount = queue.length + input.staleRecords.length + alerts.length;

  const lines: string[] = [];
  lines.push(`CSULB Biotechnology Club — internship hub, week of ${input.generatedOn}`);
  lines.push("");
  lines.push(actionCount === 0
    ? "Nothing needs a decision this week. Sources are healthy and no record is stale."
    : `${plural(actionCount, "item")} need a decision.`);
  lines.push("");

  if (alerts.length) {
    lines.push("SOURCE ALERTS — fix these first, because they mean the data is wrong, not just missing");
    for (const alert of alerts) lines.push(`  ! ${alert}`);
    lines.push("");
  }

  if (flagged.length) {
    lines.push(`NEEDS CAREFUL READING (${flagged.length})`);
    lines.push("  Evidence did not verify, or the posting contained text aimed at the extractor.");
    lines.push("  Read the official source before accepting any field.");
    for (const item of flagged) {
      const why = [!item.evidenceOk ? "unverified quotes" : null, item.injectionFlagged ? "injection pattern in posting" : null].filter(Boolean).join(", ");
      lines.push(`  - ${item.employer} — ${item.title}  [${why}]`);
      lines.push(`    ${item.url}`);
    }
    lines.push("");
  }

  if (submissions.length) {
    lines.push(`STUDENT AND OFFICER SUBMISSIONS (${submissions.length})`);
    lines.push("  Someone took the time to send these in. Decide before the ingested queue.");
    for (const item of submissions) lines.push(`  - ${item.employer} — ${item.title}\n    ${item.url}`);
    lines.push("");
  }

  const routine = queue.filter((q) => !flagged.includes(q) && q.origin !== "submission");
  if (routine.length) {
    lines.push(`REVIEW QUEUE (${routine.length}, most urgent first)`);
    for (const item of routine.slice(0, 15)) {
      const deadline = item.deadline && item.deadline !== "Unknown" ? ` — deadline ${item.deadline}` : "";
      lines.push(`  - [${item.suggestedBucket}] ${item.employer} — ${item.title}${deadline}`);
      lines.push(`    ${item.url}`);
    }
    if (routine.length > 15) lines.push(`  ... and ${routine.length - 15} more in the inbox.`);
    lines.push("");
  }

  if (input.staleRecords.length) {
    lines.push(`STALE PUBLISHED RECORDS (${input.staleRecords.length})`);
    lines.push("  Published more than 14 days ago and not rechecked. The site already tells students these are aging.");
    for (const item of input.staleRecords.slice(0, 10)) {
      lines.push(`  - ${item.employer} — ${item.title} (checked ${item.checkedOn}, ${item.daysSinceCheck} days ago)`);
    }
    if (input.staleRecords.length > 10) lines.push(`  ... and ${input.staleRecords.length - 10} more.`);
    lines.push("");
  }

  if (input.openWindows.length) {
    lines.push("RECRUITING WINDOWS OPEN NOW");
    for (const w of input.openWindows) lines.push(`  - ${w.employer}: ${w.window}${w.closes ? ` (expected close ${w.closes})` : ""}`);
    lines.push("");
  }

  const published = Object.entries(input.publishedCounts).map(([bucket, n]) => `${bucket} ${n}`).join(", ");
  lines.push(`CURRENTLY PUBLISHED: ${published || "nothing yet"}`);
  lines.push("");
  lines.push("Nothing in this email has been published. Every record above is waiting on a human.");

  const subjectBits = [
    queue.length ? `${queue.length} to review` : null,
    input.staleRecords.length ? `${input.staleRecords.length} stale` : null,
    alerts.length ? `${alerts.length} source alert${alerts.length === 1 ? "" : "s"}` : null,
  ].filter(Boolean);

  return {
    subject: subjectBits.length ? `Internship hub: ${subjectBits.join(", ")}` : "Internship hub: all clear",
    text: lines.join("\n"),
    actionCount,
    alerts,
  };
}
