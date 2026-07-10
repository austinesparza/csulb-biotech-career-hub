// Deliverable F — TypeScript types mirroring supabase/migrations/0001_init.sql.
// Keep enums in sync with SQL: each enum is defined once here and once in SQL.

export type SourceType = 'spreadsheet' | 'manual' | 'student_submission' | 'partner' | 'website_page';
export type AccessLevel = 'public' | 'members' | 'officers';

export type OpportunityStatus =
  | 'open_verified'
  | 'open_unverified'
  | 'closed'
  | 'expired'
  | 'unknown'
  | 'archive_only'
  | 'needs_review'
  | 'broken_link'
  | 'duplicate'
  | 'not_relevant'
  | 'hidden';

export const PUBLIC_STATUSES: OpportunityStatus[] = ['open_verified', 'open_unverified'];

export type ReviewStatus = 'pending' | 'approved' | 'rejected' | 'changes_requested';
export type PaidStatus = 'paid' | 'unpaid' | 'stipend' | 'unknown';
export type PersonRole = 'mentor' | 'alumnus' | 'speaker' | 'officer' | 'other';
export type ParseStatus = 'ok' | 'error' | 'skipped';
export type ImportRunStatus = 'running' | 'completed' | 'failed';
export type EventType = 'workshop' | 'speaker_series' | 'other';
export type ResourceType = 'guide' | 'template' | 'link' | 'recording' | 'post';
export type TaskType =
  | 'new_import' | 'possible_duplicate' | 'possible_repost' | 'broken_link'
  | 'expiring' | 'submission' | 'consent_check' | 'stale_record' | 'import_changed'
  | 'source_new' | 'source_changed' | 'source_reopened' | 'source_health';
export type TaskStatus = 'open' | 'in_progress' | 'done' | 'dismissed';
export type SubmissionType = 'opportunity' | 'mentor_update' | 'resource' | 'correction';
export type SubmissionStatus = 'new' | 'in_review' | 'approved' | 'rejected' | 'spam';
export type SourceKind =
  | 'greenhouse' | 'lever' | 'ashby' | 'usajobs' | 'nih_program' | 'nsf_program'
  | 'nasa_program' | 'rss' | 'schema_org' | 'static_html' | 'other_api';
export type SourceTriggerKind = 'scheduled' | 'manual' | 'retry' | 'recheck';
export type SourceFetchRunStatus =
  | 'pending' | 'running' | 'completed' | 'failed' | 'partial' | 'cancelled';
export type SourceErrorClass =
  | 'network' | 'timeout' | 'robots' | 'auth' | 'schema' | 'rate_limit' | 'unexpected';
export type SourceRemoteType = 'remote' | 'hybrid' | 'onsite' | 'unknown';
export type SourceClassification = 'internship' | 'entry_level' | 'fellowship' | 'research' | 'other';
export type SourceDeadlineKind = 'hard' | 'rolling' | 'unknown';
export type SourcePostingStatus = 'open' | 'missing' | 'closure_candidate' | 'closed' | 'reopened' | 'unknown';

export interface SourceRecord {
  id: string;
  name: string;
  source_type: SourceType;
  url: string | null;
  owner: string | null;
  access_level: AccessLevel;
  canonical_status: string | null;
  refresh_policy: string | null;
  last_imported_at: string | null;
  last_reviewed_at: string | null;
  public_safe: boolean;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface ImportRun {
  id: string;
  source_record_id: string;
  filename: string;
  uploaded_by: string | null;
  status: ImportRunStatus;
  started_at: string;
  finished_at: string | null;
  total_rows: number;
  inserted_count: number;
  updated_count: number;
  duplicate_count: number;
  error_count: number;
  notes: string | null;
}

export interface JobSource {
  id: string;
  source_record_id: string;
  company_id: string | null;
  source_name: string;
  source_kind: SourceKind;
  source_identifier: string | null;
  careers_url: string;
  api_endpoint: string | null;
  config_json: Record<string, unknown>;
  enabled: boolean;
  priority: number;
  fetch_interval_hours: number;
  expected_geography: string[];
  expected_audience: string[];
  terms_reviewed: boolean;
  terms_review_date: string | null;
  robots_reviewed: boolean;
  last_attempted_at: string | null;
  last_successful_at: string | null;
  consecutive_failures: number;
  last_http_status: number | null;
  last_payload_hash: string | null;
  degraded_at: string | null;
  automatic_scheduling_paused_at: string | null;
  notes: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface SourceFetchRun {
  id: string;
  job_source_id: string;
  trigger_kind: SourceTriggerKind;
  status: SourceFetchRunStatus;
  scheduled_for: string;
  started_at: string | null;
  finished_at: string | null;
  attempt_no: number;
  worker_id: string | null;
  http_status: number | null;
  records_seen: number;
  records_new: number;
  records_changed: number;
  records_unchanged: number;
  records_reviewed: number;
  records_closed_candidates: number;
  payload_count: number;
  error_class: SourceErrorClass | null;
  error_message: string | null;
  log_json: Record<string, unknown>;
  created_at: string;
}

export interface SourcePayload {
  id: string;
  source_fetch_run_id: string;
  request_url: string;
  final_url: string | null;
  content_type: string | null;
  etag: string | null;
  last_modified: string | null;
  status_code: number | null;
  sha256: string;
  size_bytes: number;
  storage_path: string;
  created_at: string;
}

export interface SourcePosting {
  id: string;
  job_source_id: string;
  external_posting_id: string | null;
  canonical_url: string;
  identity_key: string;
  employer_name_raw: string | null;
  employer_name_normalized: string | null;
  title_normalized: string | null;
  location_normalized: string | null;
  remote_type: SourceRemoteType | null;
  employment_type: string | null;
  classification: SourceClassification | null;
  department: string | null;
  focus_area: string | null;
  posted_at: string | null;
  closes_at: string | null;
  deadline_kind: SourceDeadlineKind | null;
  current_status: SourcePostingStatus;
  relevance_score: number | null;
  relevance_score_version: string | null;
  score_breakdown_json: Record<string, unknown>;
  uncertainty_flags: string[];
  closure_confidence: number;
  first_seen_at: string;
  last_seen_at: string;
  last_payload_id: string | null;
  last_material_hash: string;
  consecutive_misses: number;
  created_at: string;
  updated_at: string;
}

export interface SourcePostingVersion {
  id: string;
  source_posting_id: string;
  source_fetch_run_id: string;
  source_payload_id: string;
  connector_version: string;
  is_material_change: boolean;
  material_hash: string;
  normalized_json: Record<string, unknown>;
  score_breakdown_json: Record<string, unknown>;
  field_diff_json: Record<string, unknown>;
  created_at: string;
}

export interface OpportunitySourceLink {
  id: string;
  opportunity_id: string;
  source_posting_id: string;
  match_type: string;
  is_primary: boolean;
  created_at: string;
}

export interface RawImportRow {
  id: string;
  import_run_id: string;
  row_number: number;
  raw: Record<string, string>;
  parse_status: ParseStatus;
  error_message: string | null;
  matched_opportunity_id: string | null;
  created_at: string;
}

export interface Company {
  id: string;
  name: string;
  name_normalized: string;
  website: string | null;
  location: string | null;
  industry_tags: string[];
  description: string | null;
  notes_private: string | null;
  public_safe: boolean;
  created_at: string;
  updated_at: string;
}

export interface Opportunity {
  id: string;
  company_id: string | null;
  source_record_id: string | null; // nullable in DB for legacy rows; REQUIRED by the import flow
  title: string;
  posting_url: string | null;
  location: string | null;
  eligibility: string | null;
  focus_area: string | null;
  deadline: string | null;        // ISO date
  deadline_text: string | null;   // original text ('Rolling', 'ASAP', ...)
  start_date_text: string | null;
  paid_status: PaidStatus;
  application_type: string | null;
  source_status_raw: string | null;
  status: OpportunityStatus;
  public_notes: string | null;
  private_notes: string | null;
  date_added: string | null;
  first_seen_at: string;
  last_seen_at: string;
  last_checked_at: string | null;
  relevance_score: number | null;
  relevance_reasons: string[];
  review_status: ReviewStatus;
  public_safe: boolean;
  dedupe_key: string | null;   // strict: company|full title|url — allows automatic updates
  family_key: string | null;   // season/year-stripped — repost FLAGGING only, never auto-update
  duplicate_of: string | null;
  created_at: string;
  updated_at: string;
}

/** Draft produced by the CSV pipeline before it becomes a DB row. */
export interface OpportunityDraft {
  companyName: string;
  title: string;
  posting_url: string | null;
  location: string | null;
  eligibility: string | null;
  focus_area: string | null;
  deadline: string | null;
  deadline_text: string | null;
  start_date_text: string | null;
  paid_status: PaidStatus;
  application_type: string | null;
  source_status_raw: string | null;
  /** Spreadsheet Notes column lands PRIVATE by default; officer promotes at review. */
  private_notes: string | null;
  date_added: string | null;
  dedupe_key: string;  // strict
  family_key: string;  // repost family
}

export interface Person {
  id: string;
  full_name: string;
  role_types: PersonRole[];
  email: string | null;
  linkedin_url: string | null;
  affiliation: string | null;
  title: string | null;
  bio: string | null;
  photo_url: string | null;
  contact_public: boolean;
  consent_on_file: boolean;
  consent_date: string | null;
  consent_notes: string | null;
  public_safe: boolean;
  created_at: string;
  updated_at: string;
}

export interface MentorshipProfile {
  id: string;
  person_id: string;
  focus_areas: string[];
  availability: string | null;
  meeting_format: string | null;
  ask_me_about: string | null;
  accepting_mentees: boolean;
  public_safe: boolean;
  created_at: string;
  updated_at: string;
}

export interface ClubEvent {
  id: string;
  title: string;
  event_type: EventType;
  event_date: string | null;
  speaker_person_id: string | null;
  description: string | null;
  recording_url: string | null;
  slides_url: string | null;
  public_safe: boolean;
  created_at: string;
  updated_at: string;
}

export interface Resource {
  id: string;
  title: string;
  resource_type: ResourceType;
  url: string | null;
  description: string | null;
  career_path_id: string | null;
  tags: string[];
  public_safe: boolean;
  last_reviewed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CareerPath {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  typical_roles: string[];
  education_notes: string | null;
  sort_order: number;
  public_safe: boolean;
  created_at: string;
  updated_at: string;
}

export interface ReviewTask {
  id: string;
  task_type: TaskType;
  entity_table: string;
  entity_id: string;
  status: TaskStatus;
  assigned_to: string | null;
  due_date: string | null;
  notes: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface UserSubmission {
  id: string;
  submission_type: SubmissionType;
  payload: Record<string, unknown>;
  submitter_name: string | null;
  submitter_email: string | null;
  status: SubmissionStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_opportunity_id: string | null;
  notes: string | null;
  created_at: string;
}

export interface SemesterReport {
  id: string;
  semester_label: string;
  starts_on: string;
  ends_on: string;
  stats: Record<string, number>;
  narrative: string | null;
  published: boolean;
  created_at: string;
}

/** Row shape of the anon-readable public_opportunities view. */
export interface PublicOpportunity {
  id: string;
  company_name: string;
  title: string;
  posting_url: string | null;
  location: string | null;
  eligibility: string | null;
  focus_area: string | null;
  deadline: string | null;
  deadline_text: string | null;
  start_date_text: string | null;
  paid_status: PaidStatus;
  application_type: string | null;
  status: Extract<OpportunityStatus, 'open_verified' | 'open_unverified'>;
  public_notes: string | null;
  relevance_score: number | null;
  last_checked_at: string | null;
  first_seen_at: string;
  source_name: string | null;
}
