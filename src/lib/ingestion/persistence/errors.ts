import 'server-only';

import type { SourceFetchErrorClass, SourceFetchRunStatus } from '../types';

export class IngestionPersistenceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'IngestionPersistenceError';
    this.code = code;
  }
}

export class FetchRunValidationError extends IngestionPersistenceError {
  readonly fetchRunId: string;

  constructor(fetchRunId: string, message: string) {
    super('fetch_run_validation', message);
    this.name = 'FetchRunValidationError';
    this.fetchRunId = fetchRunId;
  }
}

export class FetchRunAlreadyFinalizedError extends IngestionPersistenceError {
  readonly fetchRunId: string;
  readonly status: SourceFetchRunStatus;

  constructor(fetchRunId: string, status: SourceFetchRunStatus) {
    super('fetch_run_already_finalized', `Fetch run ${fetchRunId} is already finalized with status ${status}.`);
    this.name = 'FetchRunAlreadyFinalizedError';
    this.fetchRunId = fetchRunId;
    this.status = status;
  }
}

export class PayloadStorageMetadataError extends IngestionPersistenceError {
  readonly fetchRunId: string;
  readonly storagePath: string;
  readonly payloadHash: string;

  constructor(fetchRunId: string, storagePath: string, payloadHash: string, message: string) {
    super('payload_metadata_insert_failed', message);
    this.name = 'PayloadStorageMetadataError';
    this.fetchRunId = fetchRunId;
    this.storagePath = storagePath;
    this.payloadHash = payloadHash;
  }
}

export class DuplicateRaceRecoveredError extends IngestionPersistenceError {
  constructor(message: string) {
    super('duplicate_race_recovered', message);
    this.name = 'DuplicateRaceRecoveredError';
  }
}

export function isAllowedFetchRunErrorClass(value: string): value is SourceFetchErrorClass {
  return [
    'network',
    'timeout',
    'robots',
    'auth',
    'schema',
    'rate_limit',
    'unexpected',
  ].includes(value);
}
