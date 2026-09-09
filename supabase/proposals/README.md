# Deferred schema proposals

These SQL files are design records, not runnable migrations.

They originally introduced a second set of source, candidate, review, submission,
and publication tables. Migrations `0001` through `0007` already provide those
responsibilities through `source_records`, `job_sources`, `source_fetch_runs`,
`source_payloads`, `source_postings`, `source_posting_versions`, `review_tasks`,
`user_submissions`, `opportunities`, and `public_opportunities`.

Keep these proposals for reference only. Any useful field or function must be
adapted to the existing schema in a newly numbered migration. In particular,
`hybrid_retrieval.sql` must not become executable until the retrieval benchmark
shows a material improvement over lexical search on the project corpus.
