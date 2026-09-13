import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Keep this equal to the basename of the newest executable migration.
 * scripts/check-migration-release.mjs enforces that contract in CI.
 */
export const EXPECTED_PRODUCTION_MIGRATION_NAME = 'database_release_health';

export type DatabaseReleaseHealth =
  | {
      status: 'current';
      expectedMigration: string;
      latestAppliedMigration: string | null;
      appliedMigrationCount: number;
    }
  | {
      status: 'drift';
      expectedMigration: string;
      latestAppliedMigration: string | null;
      appliedMigrationCount: number;
    }
  | {
      status: 'unavailable';
      expectedMigration: string;
      latestAppliedMigration: null;
      appliedMigrationCount: null;
    };

interface ReleaseHealthRow {
  expected_migration_name?: unknown;
  expected_applied?: unknown;
  latest_applied_name?: unknown;
  applied_migration_count?: unknown;
}

export async function loadDatabaseReleaseHealth(db: SupabaseClient): Promise<DatabaseReleaseHealth> {
  const { data, error } = await db.rpc('database_release_health', {
    p_expected_migration_name: EXPECTED_PRODUCTION_MIGRATION_NAME,
  });

  if (error) {
    console.warn('[database-release-health] migration health RPC unavailable', {
      code: error.code ?? null,
      message: error.message,
    });
    return {
      status: 'unavailable',
      expectedMigration: EXPECTED_PRODUCTION_MIGRATION_NAME,
      latestAppliedMigration: null,
      appliedMigrationCount: null,
    };
  }

  const row = (Array.isArray(data) ? data[0] : data) as ReleaseHealthRow | null;
  if (!row) {
    return {
      status: 'unavailable',
      expectedMigration: EXPECTED_PRODUCTION_MIGRATION_NAME,
      latestAppliedMigration: null,
      appliedMigrationCount: null,
    };
  }

  const latestAppliedMigration = typeof row.latest_applied_name === 'string'
    ? row.latest_applied_name
    : null;
  const count = Number(row.applied_migration_count);
  const appliedMigrationCount = Number.isFinite(count) ? count : 0;
  const expectedApplied = row.expected_applied === true;

  return {
    status: expectedApplied ? 'current' : 'drift',
    expectedMigration: EXPECTED_PRODUCTION_MIGRATION_NAME,
    latestAppliedMigration,
    appliedMigrationCount,
  };
}
