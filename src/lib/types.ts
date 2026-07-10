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
  | 'expiring' | 'submission' | 'consent_check' | 'stale_record' | 'import_changed';
export type TaskStatus = 'open' | 'in_progress' | 'done' | 'dismissed';
export type SubmissionType = 'opportunity' | 'mentor_update' | 'resource' | 'correction';
export type SubmissionStatus = 'new' | 'in_review' | 'approved' | 'rejected' | 'spam';

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
