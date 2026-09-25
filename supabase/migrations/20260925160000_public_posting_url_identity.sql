-- A public card must lead to its own application. Different employer
-- requisitions with similar titles remain separate; identical public URLs
-- cannot be approved twice, including trailing slash changes. Query strings
-- remain part of identity because some job boards identify roles there.
create unique index if not exists uq_public_opportunities_posting_url
  on public.opportunities (trim(trailing '/' from posting_url))
  where public_safe and review_status = 'approved'
    and status in ('open_verified', 'open_unverified')
    and posting_url is not null;
