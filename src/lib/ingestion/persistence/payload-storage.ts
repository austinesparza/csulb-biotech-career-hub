'use server';

import { sha256Hex } from '../hash';
import type { ConnectorFetchResult } from '../types';
import { PayloadStorageMetadataError } from './errors';
import type { IngestionRepository, SourcePayloadRow } from './repository';

export interface StoredPayload {
  payload: SourcePayloadRow;
  hash: string;
  byteSize: number;
  storagePath: string;
  inserted: boolean;
}

function toUtf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function makeStoragePath(jobSourceId: string, fetchRunId: string, payloadHash: string): string {
  return `${jobSourceId}/${fetchRunId}/${payloadHash.slice(0, 2)}/${payloadHash}.txt`;
}

export async function storeRawPayload(params: {
  repository: IngestionRepository;
  fetchRunId: string;
  jobSourceId: string;
  fetchResult: ConnectorFetchResult;
}): Promise<StoredPayload | null> {
  const { fetchResult, repository, fetchRunId, jobSourceId } = params;
  if (!fetchResult.rawResponseText || !fetchResult.requestUrl) {
    return null;
  }

  const body = fetchResult.rawResponseText;
  const payloadHash = sha256Hex(body);
  const bytes = toUtf8Bytes(body);
  const storagePath = makeStoragePath(jobSourceId, fetchRunId, payloadHash);

  const existing = await repository.getPayloadByUniqueKey(fetchRunId, payloadHash, fetchResult.requestUrl);
  if (existing) {
    return {
      payload: existing,
      hash: payloadHash,
      byteSize: bytes.length,
      storagePath: existing.storage_path,
      inserted: false,
    };
  }

  await repository.uploadPayloadObject(storagePath, bytes);

  try {
    const inserted = await repository.insertPayloadMetadata({
      sourceFetchRunId: fetchRunId,
      requestUrl: fetchResult.requestUrl,
      finalUrl: fetchResult.finalUrl,
      contentType: fetchResult.contentType,
      etag: fetchResult.etag,
      lastModified: fetchResult.lastModified,
      statusCode: fetchResult.httpStatus,
      sha256: payloadHash,
      sizeBytes: bytes.length,
      storagePath,
    });

    return {
      payload: inserted,
      hash: payloadHash,
      byteSize: bytes.length,
      storagePath,
      inserted: true,
    };
  } catch (error) {
    throw new PayloadStorageMetadataError(
      fetchRunId,
      storagePath,
      payloadHash,
      `Raw payload object uploaded but metadata insert failed. Re-run is safe and should reconcile via (source_fetch_run_id, sha256, request_url) uniqueness. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}
