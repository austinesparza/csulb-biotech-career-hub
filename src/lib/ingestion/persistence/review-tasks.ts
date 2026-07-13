'use server';

import type { IngestionRepository, ReviewTaskRow } from './repository';

export type SourceReviewTaskType = 'source_new' | 'source_changed' | 'source_reopened' | 'source_health';

export async function ensureOpenSourceReviewTask(params: {
  repository: IngestionRepository;
  taskType: SourceReviewTaskType;
  entityTable: string;
  entityId: string;
  materialHash: string | null;
  noteTag: string;
  noteBody: string;
}): Promise<ReviewTaskRow> {
  const marker = params.materialHash ? `[${params.noteTag}:${params.materialHash}]` : `[${params.noteTag}]`;
  const notes = `${marker} ${params.noteBody}`;

  const existing = await params.repository.findOpenReviewTask(
    params.taskType,
    params.entityTable,
    params.entityId,
    notes,
  );

  if (existing) return existing;
  return params.repository.insertReviewTask(params.taskType, params.entityTable, params.entityId, notes);
}
