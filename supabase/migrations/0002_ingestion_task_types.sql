-- Add four new task_type enum values required by the automated ingestion workflow.
-- These values must be committed before 0003 uses them in constraints or application code.
-- Note: ALTER TYPE … ADD VALUE cannot run in a transaction that subsequently references
-- the new values; keep this migration separate and apply it before 0003.

alter type public.task_type add value if not exists 'source_new';
alter type public.task_type add value if not exists 'source_changed';
alter type public.task_type add value if not exists 'source_reopened';
alter type public.task_type add value if not exists 'source_health';
