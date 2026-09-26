/**
 * posting-verification.ts — deciding what a verified page means for review.
 *
 * Input: the lead (what search or a student saw), the resolved identity, the
 * page assessment (or the reason no fetch was allowed), and existing records
 * from every table that can already hold the same role. Output: one outcome
 * with its reasons. Pure, so the whole decision is replayable in tests and
 * against the fixed evaluation set.
 *
 * Only `review_candidate` asks an officer for attention. Every other outcome
 * is retained in the private archive for recall analysis. Nothing here can
 * approve, publish or assert that a job is open.
 */
import { normalizeJobTitle } from "../ingestion/normalize";
import { attributeEmployer, resolvePostingIdentity, type EmployerAttribution, type PostingIdentity } from "./posting-identity";
import { compareTitles, sameRequisition, unknownGates, type PageAssessment, type PostingGates, type TitleComparison } from "./posting-evidence";

export type VerificationOutcome =
  | "review_candidate"
  | "duplicate_existing"
  | "repeat_candidate"
  | "closed"
  | "gate_excluded"
  | "rejected_attribution"
  | "rejected_title_mismatch"
  | "rejected_not_requisition"
  | "unresolved_governance"
  | "unresolved_page"
  | "unresolved_attribution"
  | "unresolved_conflict";

export type DuplicateTable = "opportunities" | "source_postings" | "discovery_leads" | "user_submissions" | "posting_verifications";

export interface ExistingRecord {
  table: DuplicateTable;
  id: string;
  url: string | null;
  title: string | null;
  employer: string | null;
  location?: string | null;
  /** Requisition stored separately from the URL (source_postings.external_posting_id). */
  requisitionId?: string | null;
  status?: string | null;
  createdAt?: string | null;
}

export interface DuplicateMatch {
  table: DuplicateTable;
  id: string;
  basis: "same_url" | "same_requisition" | "related_title_different_requisition";
  status: string | null;
}

export interface DuplicateDecision {
  decision: "distinct" | "existing_opportunity" | "existing_source_posting" | "repeat_candidate";
  matches: DuplicateMatch[];
  /** Same title family, different requisition: never merged, surfaced to the officer. */
  related: DuplicateMatch[];
}

export interface VerificationLead {
  employer: string | null;
  title: string | null;
  location?: string | null;
  /** Season/year stated in the lead, e.g. "summer 2027". */
  cycle?: string | null;
  url: string;
}

export interface IdentityComparison {
  employer: EmployerAttribution;
  title: TitleComparison;
  requisition: "match" | "conflict" | "not_on_page" | "unknown";
  location: "match" | "different" | "unknown";
  cycle: "match" | "different" | "unknown";
}

export interface VerificationDecision {
  outcome: VerificationOutcome;
  reasons: string[];
  identity: PostingIdentity;
  comparison: IdentityComparison;
  duplicates: DuplicateDecision;
  gates: PostingGates;
  /** Lower is sooner, matching review_tasks.priority. */
  reviewPriority: number;
}

function titleKey(value: string | null | undefined): string {
  return (normalizeJobTitle(value ?? "") ?? "").replace(/\b(20\d{2}|summer|spring|fall|winter|intern(ship)?|co-?op)\b/g, " ").replace(/\s+/g, " ").trim();
}

/** Compare against every table that can already represent this requisition. */
export function decideDuplicate(identity: PostingIdentity, title: string | null, existing: ExistingRecord[]): DuplicateDecision {
  const matches: DuplicateMatch[] = [];
  const related: DuplicateMatch[] = [];
  const candidateTitle = titleKey(title);
  for (const record of existing) {
    const other = resolvePostingIdentity(record.url);
    const sameUrl = !!identity.url && !!other.url && identity.url.toLowerCase() === other.url.toLowerCase();
    const sameReq = !!identity.identityKey && (
      other.identityKey === identity.identityKey
      || (!!record.requisitionId && other.tenantKey === identity.tenantKey && sameRequisition(record.requisitionId, identity.requisitionId))
    );
    if (sameUrl || sameReq) {
      matches.push({ table: record.table, id: record.id, basis: sameUrl ? "same_url" : "same_requisition", status: record.status ?? null });
      continue;
    }
    const sameTenant = !!identity.tenantKey && other.tenantKey === identity.tenantKey;
    if (sameTenant && candidateTitle && titleKey(record.title) === candidateTitle) {
      related.push({ table: record.table, id: record.id, basis: "related_title_different_requisition", status: record.status ?? null });
    }
  }
  const decision = matches.some((match) => match.table === "opportunities")
    ? "existing_opportunity"
    : matches.some((match) => match.table === "source_postings")
      ? "existing_source_posting"
      : matches.some((match) => match.table === "posting_verifications" && match.status === "review_candidate")
        ? "repeat_candidate"
        : "distinct";
  return { decision, matches, related };
}

function cycleOf(value: string | null | undefined): { season: string | null; year: number | null } {
  const match = (value ?? "").match(/\b(spring|summer|fall|autumn|winter)\b[^0-9]{0,12}(20\d{2})?|\b(20\d{2})\b[^a-z]{0,3}(spring|summer|fall|autumn|winter)?/i);
  if (!match) return { season: null, year: null };
  const season = (match[1] ?? match[4] ?? null)?.toLowerCase() ?? null;
  const year = Number(match[2] ?? match[3]) || null;
  return { season: season === "autumn" ? "fall" : season, year };
}

function compareCycle(lead: string | null | undefined, gates: PostingGates): IdentityComparison["cycle"] {
  const left = cycleOf(lead);
  if (!left.season && !left.year) return "unknown";
  if (!gates.term.season && !gates.term.year) return "unknown";
  if (left.season && gates.term.season && left.season !== (gates.term.season === "autumn" ? "fall" : gates.term.season)) return "different";
  if (left.year && gates.term.year && left.year !== gates.term.year) return "different";
  return "match";
}

function compareLocation(lead: string | null | undefined, text: string | null): IdentityComparison["location"] {
  const place = (lead ?? "").split(/[,/;(]| - /)[0]?.trim().toLowerCase();
  if (!place || place.length < 3 || !text) return "unknown";
  return text.toLowerCase().includes(place) ? "match" : "different";
}

function priorityFor(gates: PostingGates, retrievedAt: string): number {
  let priority = 60;
  if (gates.deadline.date) {
    const days = (Date.parse(gates.deadline.date) - Date.parse(retrievedAt)) / 86_400_000;
    priority = days <= 14 ? 5 : days <= 45 ? 25 : 45;
  }
  if (gates.degreeLevel.value === "graduate_accepted") priority -= 5;
  return Math.max(1, priority);
}

/**
 * The single outcome rule. `assessment` is null when governance prevented a
 * fetch; the reason is then carried in `governanceReason`.
 */
export function decideVerification(input: {
  lead: VerificationLead;
  assessment: PageAssessment | null;
  governanceReason?: string | null;
  existing: ExistingRecord[];
  retrievedAt: string;
}): VerificationDecision {
  const identity = resolvePostingIdentity(input.lead.url);
  const assessment = input.assessment;
  const gates = assessment?.gates ?? unknownGates();
  const employer = attributeEmployer({ leadEmployer: input.lead.employer, identity, pageText: assessment?.text ?? null });
  const title = assessment ? compareTitles(input.lead.title, assessment.pageTitle) : "unknown";
  const onPage = assessment?.requisitionIdsOnPage ?? [];
  const requisition: IdentityComparison["requisition"] = !assessment ? "unknown"
    : assessment.state === "requisition_conflict" ? "conflict"
      : !identity.requisitionId ? "unknown"
        : onPage.length === 0 ? "not_on_page"
          : onPage.some((id) => sameRequisition(id, identity.requisitionId)) ? "match" : "conflict";
  const comparison: IdentityComparison = {
    employer,
    title,
    requisition,
    location: compareLocation(input.lead.location, assessment?.text ?? null),
    cycle: compareCycle(input.lead.cycle ?? input.lead.title, gates),
  };
  const duplicates = decideDuplicate(identity, assessment?.pageTitle ?? input.lead.title, input.existing);
  const reasons: string[] = [];
  const decision = (outcome: VerificationOutcome): VerificationDecision => ({
    outcome, reasons, identity, comparison, duplicates, gates, reviewPriority: priorityFor(gates, input.retrievedAt),
  });

  if (!identity.detailPage || identity.system === "linkedin" || identity.system === "aggregator") {
    reasons.push(identity.notes[0] ?? "URL does not identify an individual employer requisition");
    return decision("rejected_not_requisition");
  }
  if (employer.status === "mismatch") {
    reasons.push(employer.reason);
    return decision("rejected_attribution");
  }
  if (duplicates.decision === "existing_opportunity" || duplicates.decision === "existing_source_posting") {
    reasons.push(`Same requisition already exists in ${duplicates.matches.map((match) => match.table).join(", ")}`);
    return decision("duplicate_existing");
  }
  if (!assessment) {
    reasons.push(input.governanceReason ?? "No governed source authorizes fetching this tenant");
    return decision("unresolved_governance");
  }
  reasons.push(assessment.reason);
  if (assessment.state === "closed" || assessment.state === "removed" || assessment.state === "expired") return decision("closed");
  if (assessment.state === "requisition_conflict") return decision("unresolved_conflict");
  if (assessment.state !== "apply_visible") return decision("unresolved_page");
  if (title === "different") {
    reasons.push(`Page title "${assessment.pageTitle}" is a different role from "${input.lead.title}"`);
    return decision("rejected_title_mismatch");
  }
  if (employer.status === "needs_page_evidence" || employer.status === "unknown") {
    reasons.push(employer.reason);
    return decision("unresolved_attribution");
  }
  if (requisition === "conflict") return decision("unresolved_conflict");
  if (duplicates.decision === "repeat_candidate") {
    reasons.push("An open verification already sent this requisition to review");
    return decision("repeat_candidate");
  }
  const exclusion = gates.degreeLevel.value === "undergraduate_only" || gates.degreeLevel.value === "phd_only"
    ? `Employer text restricts degree level: ${gates.degreeLevel.quote}`
    : gates.institutionRestriction.value === "named_institution_only"
      ? `Employer text restricts applicants to one institution: ${gates.institutionRestriction.quote}`
      : identity.tenant?.institutionRestriction ?? null;
  if (exclusion) {
    reasons.push(exclusion);
    return decision("gate_excluded");
  }
  if (duplicates.related.length > 0) {
    reasons.push(`Related requisitions with the same title family exist (${duplicates.related.map((item) => `${item.table}:${item.id}`).join(", ")}); kept separate`);
  }
  return decision("review_candidate");
}
