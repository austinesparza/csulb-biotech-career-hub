-- Cover audit-history foreign keys so officer filtering and referential checks
-- remain efficient as revision history grows.

create index if not exists idx_opportunity_revisions_changed_by
  on public.opportunity_revisions(changed_by);

create index if not exists idx_opportunity_revisions_restored_revision
  on public.opportunity_revisions(restored_revision_id)
  where restored_revision_id is not null;
