/**
 * Tests for the triggerAltosIngestion server action.
 *
 * Security requirements verified:
 * - Unauthorized callers never reach createServiceClient
 * - createServiceClient is called only AFTER requireOfficer succeeds
 * - The action accepts no external source URL or board token
 * - The returned summary is the safe AltosIngestionSummary type
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AltosIngestionSummary } from '../../lib/ingestion/manual-ingestion-pilot';

// ============================================================
// MODULE-LEVEL MOCKS
// ============================================================

// Track call order for requireOfficer / createServiceClient
const callLog: string[] = [];
let officerShouldSucceed = true;
let pilotShouldThrow: Error | null = null;
let pilotSummaryOverride: Partial<AltosIngestionSummary> | null = null;

// Store captured pilot call arguments for inspection in tests
let capturedPilotArgs: unknown[] = [];

// Mock @/lib/supabase/server
vi.mock('@/lib/supabase/server', () => ({
  requireOfficer: vi.fn(async () => {
    callLog.push('requireOfficer');
    if (!officerShouldSucceed) throw new Error('Not an active officer');
    return { user: { id: 'user-abc-123' }, officer: { user_id: 'user-abc-123', display_name: 'Test Officer' } };
  }),
  createServiceClient: vi.fn(() => {
    callLog.push('createServiceClient');
    return {
      storage: { from: vi.fn() },
    };
  }),
}));

// Mock @/lib/ingestion/manual-ingestion-pilot
vi.mock('@/lib/ingestion/manual-ingestion-pilot', () => ({
  ALTOS_BOARD_TOKEN: 'altoslabs',
  ALTOS_EMPLOYER_NAME: 'Altos Labs',
  runAltosLabsPilot: vi.fn(async (...args: unknown[]) => {
    callLog.push('runAltosLabsPilot');
    capturedPilotArgs = args;
    if (pilotShouldThrow) throw pilotShouldThrow;
    return {
      fetchRunId: 'run-pilot-test-1',
      status: 'completed',
      recordsSeen: 10,
      recordsNormalized: 10,
      recordsSkipped: 0,
      recordsNew: 3,
      recordsChanged: 0,
      recordsUnchanged: 7,
      recordsReviewed: 3,
      payloadStored: true,
      errorMessage: null,
      ...pilotSummaryOverride,
    } as AltosIngestionSummary;
  }),
}));

// Mock next/cache
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

// ============================================================
// LAZY IMPORT (after mocks are set up)
// ============================================================

async function getAction() {
  // Re-import to pick up fresh vi.mock context
  const { triggerAltosIngestion } = await import('../../app/admin/ingestion/actions');
  return triggerAltosIngestion;
}

// ============================================================
// TESTS
// ============================================================

describe('triggerAltosIngestion server action', () => {
  beforeEach(() => {
    callLog.length = 0;
    officerShouldSucceed = true;
    pilotShouldThrow = null;
    pilotSummaryOverride = null;
    vi.clearAllMocks();
  });

  it('calls requireOfficer before createServiceClient', async () => {
    const action = await getAction();
    await action();
    const reqIdx = callLog.indexOf('requireOfficer');
    const svcIdx = callLog.indexOf('createServiceClient');
    expect(reqIdx).toBeGreaterThanOrEqual(0);
    expect(svcIdx).toBeGreaterThan(reqIdx);
  });

  it('does not call createServiceClient when requireOfficer throws', async () => {
    const action = await getAction();
    officerShouldSucceed = false;
    await expect(action()).rejects.toThrow('Not an active officer');
    expect(callLog).not.toContain('createServiceClient');
  });

  it('does not call runAltosLabsPilot when requireOfficer throws', async () => {
    const action = await getAction();
    officerShouldSucceed = false;
    await expect(action()).rejects.toThrow();
    expect(callLog).not.toContain('runAltosLabsPilot');
  });

  it('returns only the safe AltosIngestionSummary type with the expected fields', async () => {
    const action = await getAction();
    const summary = await action();

    expect(summary).toBeDefined();
    expect(typeof summary.fetchRunId).toBe('string');
    expect(typeof summary.status).toBe('string');
    expect(typeof summary.recordsSeen).toBe('number');
    expect(typeof summary.recordsNormalized).toBe('number');
    expect(typeof summary.recordsSkipped).toBe('number');
    expect(typeof summary.recordsNew).toBe('number');
    expect(typeof summary.recordsChanged).toBe('number');
    expect(typeof summary.recordsUnchanged).toBe('number');
    expect(typeof summary.recordsReviewed).toBe('number');
    expect(typeof summary.payloadStored).toBe('boolean');
    expect(summary.errorMessage === null || typeof summary.errorMessage === 'string').toBe(true);

    // Ensure no sensitive fields are present
    const keys = Object.keys(summary);
    expect(keys).not.toContain('rawResponseText');
    expect(keys).not.toContain('candidates');
    expect(keys).not.toContain('workerId');
    expect(keys).not.toContain('serviceRoleKey');
  });

  it('does not accept a board token, URL, source ID, or company name from FormData', async () => {
    const action = await getAction();
    // The action signature is () => Promise<AltosIngestionSummary> — no parameters accepted.
    // It must be callable with no arguments (FormData not accepted).
    const length = action.length;
    expect(length).toBe(0);
  });

  it('passes a workerId derived from the authenticated user ID to runAltosLabsPilot', async () => {
    const action = await getAction();
    capturedPilotArgs = [];
    await action();

    expect(capturedPilotArgs).toHaveLength(1);
    const callArg = capturedPilotArgs[0] as Record<string, unknown>;
    expect(typeof callArg.workerId).toBe('string');
    expect(callArg.workerId as string).toContain('user-abc-123');
    // Worker ID must not be returned to browser — it's only passed internally
    expect(callArg.workerId).not.toBe('user-abc-123'); // must be prefixed/transformed
  });

  it('returns a completed summary on successful ingestion', async () => {
    const action = await getAction();
    const summary = await action();
    expect(summary.status).toBe('completed');
    expect(summary.recordsNew).toBe(3);
    expect(summary.payloadStored).toBe(true);
  });

  it('propagates pilot errors to the caller', async () => {
    const action = await getAction();
    pilotShouldThrow = new Error('Source not found — run migration 0007 first.');
    await expect(action()).rejects.toThrow('Source not found');
  });

  it('revalidates the expected paths on success', async () => {
    const nextCache = await import('next/cache');
    const revalidatePath = nextCache.revalidatePath as unknown as ReturnType<typeof vi.fn>;
    const action = await getAction();
    await action();

    const paths = revalidatePath.mock.calls.map((c: unknown[]) => c[0]);
    expect(paths).toContain('/admin');
    expect(paths).toContain('/admin/ingestion');
    expect(paths).toContain('/admin/review');
  });
});
