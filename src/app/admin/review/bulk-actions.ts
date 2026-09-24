'use server';

import { revalidatePath } from 'next/cache';
import type { AudienceBucket, GraduateStage } from '@/lib/types';
import { createServiceClient, requireOfficer } from '@/lib/supabase/server';
import { readSheetReviewIntent, type SheetReviewIntent } from '@/lib/sheet-review';
import { resolveSheetPublishCandidate } from '@/lib/review-publish';
import { syncReviewWorkflow, type ReviewWorkflowSyncSummary } from '@/app/admin/import/review-workflow-actions';
import { reconcileAndSyncMachineReviewQueueToSheet } from '@/app/admin/import/sheet-reconcile-actions';

interface PublishCandidateRow {
  id: string;
  title: string;
  posting_url: string | null;
  public_notes: string | null;
  audience_bucket: AudienceBucket;
  audience_reason: string | null;
  graduate_stage: GraduateStage;
  scientific_lanes: string[] | null;
  job_functions: string[] | null;
  methods: string[] | null;
  source_check_result: string | null;
  last_checked_at: string | null;
  companies: { public_safe: boolean } | Array<{ public_safe: boolean }> | null;
}

export interface ReviewedPublishBlockedItem {
  id: string;
  title: string;
  reason: string;
}

export interface ReviewedPublishSummary {
  sync: ReviewWorkflowSyncSummary;
  pendingCandidates: number;
  sheetApproved: number;
  published: number;
  blocked: ReviewedPublishBlockedItem[];
  sheetArchiveWarning: string | null;
}

export type ReviewedPublishResult =
  | { ok: true; summary: ReviewedPublishSummary }
  | { ok: false; error: string };

function companyPublicSafe(
  relation: PublishCandidateRow['companies'],
): boolean {
  if (Array.isArray(relation)) return relation[0]?.public_safe ?? false;
  return relation?.public_safe ?? false;
}

function revalidatePublicationViews() {
  for (const path of ['/', '/internships', '/companies', '/admin', '/admin/review', '/admin/manage']) {
    revalidatePath(path);
  }
}

/**
 * Normal high-throughput officer path:
 * 1. Pull the latest governed Sheet decisions.
 * 2. Publish only rows explicitly marked Approve + Public Safe that also pass
 *    the same audience and stage gates as individual review.
 * 3. Refresh the Sheet so resolved rows move to Archive.
 *
 * Source findings, special-affiliation roles, ineligible roles, incomplete
 * audience evidence, and unapproved Sheet rows remain private.
 */
export async function syncAndPublishReviewedOpportunities(): Promise<ReviewedPublishResult> {
  try {
    await requireOfficer();

    const sync = await syncReviewWorkflow();
    if (!sync.ok) {
      return {
        ok: false,
        error: `The review Sheet could not be synchronized first: ${sync.error}`,
      };
    }

    const { user } = await requireOfficer();
    const db = createServiceClient();
    const { data: pending, error: pendingError } = await db
      .from('opportunities')
      .select(
        'id, title, posting_url, public_notes, audience_bucket, audience_reason, graduate_stage, ' +
        'scientific_lanes, job_functions, methods, source_check_result, last_checked_at, companies(public_safe)',
      )
      .eq('status', 'needs_review')
      .eq('review_status', 'pending')
      .eq('public_safe', false)
      .order('relevance_score', { ascending: false, nullsFirst: false })
      .limit(100);
    if (pendingError) throw new Error('Could not load the private publish queue');

    const candidates = (pending ?? []) as unknown as PublishCandidateRow[];
    const ids = candidates.map((candidate) => candidate.id);
    const latestSheetReview = new Map<string, SheetReviewIntent>();

    if (ids.length > 0) {
      const { data: rawRows, error: rawError } = await db
        .from('raw_import_rows')
        .select('matched_opportunity_id, raw, created_at')
        .in('matched_opportunity_id', ids)
        .order('created_at', { ascending: false });
      if (rawError) throw new Error('Could not load the latest Sheet review decisions');

      for (const row of (rawRows ?? []) as Array<{
        matched_opportunity_id: string | null;
        raw: Record<string, unknown>;
      }>) {
        if (!row.matched_opportunity_id || latestSheetReview.has(row.matched_opportunity_id)) continue;
        latestSheetReview.set(row.matched_opportunity_id, readSheetReviewIntent(row.raw));
      }
    }

    let sheetApproved = 0;
    let published = 0;
    const blocked: ReviewedPublishBlockedItem[] = [];

    for (const candidate of candidates) {
      const sheetReview = latestSheetReview.get(candidate.id) ?? null;
      if (sheetReview?.decision !== 'approve') continue;
      sheetApproved += 1;

      const resolution = resolveSheetPublishCandidate({
        postingUrl: candidate.posting_url,
        audienceBucket: candidate.audience_bucket,
        audienceReason: candidate.audience_reason,
        graduateStage: candidate.graduate_stage,
        sheetReview,
        sourceCheckResult: candidate.source_check_result,
        lastCheckedAt: candidate.last_checked_at,
      });
      if (!resolution.ready) {
        blocked.push({ id: candidate.id, title: candidate.title, reason: resolution.reason });
        continue;
      }

      const { error } = await db.rpc('decide_opportunity_review', {
        p_opportunity_id: candidate.id,
        p_decided_by: user.id,
        p_decision: 'approve',
        p_target_status: 'open_verified',
        p_public_notes: candidate.public_notes?.trim() ?? '',
        p_make_company_public: !companyPublicSafe(candidate.companies),
        p_audience_bucket: resolution.audienceBucket,
        p_audience_reason: resolution.audienceReason,
        p_graduate_stage: resolution.graduateStage,
        p_final_fields: {
          scientific_lanes: candidate.scientific_lanes ?? [],
          job_functions: candidate.job_functions ?? [],
          methods: candidate.methods ?? [],
        },
        p_source_confirmed: true,
        p_public_safe_confirmed: true,
      });

      if (error) {
        console.error('[review-bulk-publish] candidate failed', {
          opportunityId: candidate.id,
          error: error.message,
        });
        blocked.push({
          id: candidate.id,
          title: candidate.title,
          reason: 'The final publication decision failed; the record stayed private',
        });
        continue;
      }
      published += 1;
    }

    revalidatePublicationViews();

    let sheetArchiveWarning: string | null = null;
    if (published > 0) {
      const refreshed = await reconcileAndSyncMachineReviewQueueToSheet();
      if (!refreshed.ok) {
        sheetArchiveWarning = 'Publication succeeded, but the Sheet could not be refreshed. The published rows will move to Archive on the next sync.';
      }
    }

    return {
      ok: true,
      summary: {
        sync: sync.summary,
        pendingCandidates: candidates.length,
        sheetApproved,
        published,
        blocked,
        sheetArchiveWarning,
      },
    };
  } catch (error) {
    console.error('[review-bulk-publish] workflow failed', {
      error: error instanceof Error ? error.message : 'unknown error',
    });
    return {
      ok: false,
      error: 'The reviewed-publication workflow stopped before it could finish. Records that were not explicitly approved remain private.',
    };
  }
}
