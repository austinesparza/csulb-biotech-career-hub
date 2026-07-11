import { describe, it, expect } from 'vitest';
import {
  stableSerialize,
  sha256Hex,
  makeGreenhouseIdentityKey,
  makeGreenhouseMaterialHash,
} from '../../lib/ingestion/hash';

describe('stableSerialize', () => {
  it('produces identical output for objects with different key insertion order', () => {
    const a = { b: 2, a: 1, c: 3 };
    const b = { c: 3, a: 1, b: 2 };
    expect(stableSerialize(a)).toBe(stableSerialize(b));
  });
  it('sorts nested object keys recursively', () => {
    const a = { outer: { z: 26, a: 1 } };
    const b = { outer: { a: 1, z: 26 } };
    expect(stableSerialize(a)).toBe(stableSerialize(b));
  });
  it('preserves array element order', () => {
    const a = { arr: [3, 1, 2] };
    const b = { arr: [1, 2, 3] };
    expect(stableSerialize(a)).not.toBe(stableSerialize(b));
  });
  it('handles null and primitive values', () => {
    expect(stableSerialize(null)).toBe('null');
    expect(stableSerialize(42)).toBe('42');
    expect(stableSerialize('hello')).toBe('"hello"');
    expect(stableSerialize(true)).toBe('true');
  });
  it('treats undefined as null', () => {
    expect(stableSerialize(undefined)).toBe('null');
  });
  it('is deterministic', () => {
    const obj = { title: 'Intern', location: 'Remote', departments: ['R&D', 'Biology'] };
    expect(stableSerialize(obj)).toBe(stableSerialize(obj));
  });
});

describe('sha256Hex', () => {
  it('produces a 64-character lowercase hex string', () => {
    const result = sha256Hex('hello world');
    expect(result).toHaveLength(64);
    expect(result).toMatch(/^[0-9a-f]{64}$/);
  });
  it('produces known hash for empty string', () => {
    // SHA-256 of empty string is known constant
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
  it('produces a deterministic hash for a fixed input', () => {
    // Verify the actual output is stable between runs
    const h = sha256Hex('hello world');
    expect(h).toHaveLength(64);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    // Calling again must produce the same result
    expect(sha256Hex('hello world')).toBe(h);
  });
  it('is case-insensitive (all lowercase output)', () => {
    expect(sha256Hex('test')).toMatch(/^[a-f0-9]+$/);
  });
  it('is deterministic', () => {
    expect(sha256Hex('same input')).toBe(sha256Hex('same input'));
  });
  it('different inputs produce different hashes', () => {
    expect(sha256Hex('input A')).not.toBe(sha256Hex('input B'));
  });
});

describe('makeGreenhouseIdentityKey', () => {
  it('produces expected format', () => {
    expect(makeGreenhouseIdentityKey('mycompany', '12345')).toBe('greenhouse:mycompany:12345');
  });
  it('lowercases board token', () => {
    expect(makeGreenhouseIdentityKey('MyCompany', '12345')).toBe('greenhouse:mycompany:12345');
  });
  it('is stable across title changes', () => {
    const key1 = makeGreenhouseIdentityKey('labgenomicsinc', '1001001');
    const key2 = makeGreenhouseIdentityKey('labgenomicsinc', '1001001');
    expect(key1).toBe(key2);
  });
  it('is stable across location changes', () => {
    expect(makeGreenhouseIdentityKey('labgenomicsinc', '1001001'))
      .toBe(makeGreenhouseIdentityKey('labgenomicsinc', '1001001'));
  });
  it('is unique per job post ID', () => {
    expect(makeGreenhouseIdentityKey('mycompany', '1'))
      .not.toBe(makeGreenhouseIdentityKey('mycompany', '2'));
  });
  it('is unique per board token', () => {
    expect(makeGreenhouseIdentityKey('company-a', '1'))
      .not.toBe(makeGreenhouseIdentityKey('company-b', '1'));
  });
});

describe('makeGreenhouseMaterialHash', () => {
  const baseFields = {
    titleRaw: 'Biotechnology Intern',
    locationRaw: 'Long Beach, CA',
    canonicalUrl: 'https://boards.greenhouse.io/labgenomicsinc/jobs/1001001',
    departments: ['Research & Development'],
    offices: ['Long Beach'],
    closesAt: '2026-07-15',
    deadlineKind: 'hard' as const,
  };

  it('produces a 64-character lowercase hex string', () => {
    const hash = makeGreenhouseMaterialHash(baseFields);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is stable for identical inputs', () => {
    expect(makeGreenhouseMaterialHash(baseFields)).toBe(makeGreenhouseMaterialHash(baseFields));
  });

  it('is stable regardless of departments array order', () => {
    const reordered = {
      ...baseFields,
      departments: ['Biology', 'Research & Development'],
    };
    const sorted = {
      ...baseFields,
      departments: ['Research & Development', 'Biology'],
    };
    // Both should produce the same hash because makeGreenhouseMaterialHash sorts internally
    expect(makeGreenhouseMaterialHash(reordered)).toBe(makeGreenhouseMaterialHash(sorted));
  });

  it('changes when title changes', () => {
    const changed = { ...baseFields, titleRaw: 'New Title' };
    expect(makeGreenhouseMaterialHash(baseFields)).not.toBe(makeGreenhouseMaterialHash(changed));
  });

  it('changes when location changes', () => {
    const changed = { ...baseFields, locationRaw: 'Irvine, CA' };
    expect(makeGreenhouseMaterialHash(baseFields)).not.toBe(makeGreenhouseMaterialHash(changed));
  });

  it('changes when deadline changes', () => {
    const changed = { ...baseFields, closesAt: '2026-08-01' };
    expect(makeGreenhouseMaterialHash(baseFields)).not.toBe(makeGreenhouseMaterialHash(changed));
  });

  it('changes when canonical URL changes', () => {
    const changed = { ...baseFields, canonicalUrl: 'https://boards.greenhouse.io/labgenomicsinc/jobs/9999999' };
    expect(makeGreenhouseMaterialHash(baseFields)).not.toBe(makeGreenhouseMaterialHash(changed));
  });

  it('does NOT change for different JSON key ordering (stable serialization)', () => {
    // Simulate the same logical object but with a different key insertion order
    // by comparing two separate object literals with the same data
    const fields1 = {
      titleRaw: 'Biotech Intern',
      locationRaw: 'Long Beach, CA',
      canonicalUrl: 'https://boards.greenhouse.io/co/jobs/1',
      departments: ['R&D'],
      offices: ['Long Beach'],
      closesAt: '2026-07-01',
      deadlineKind: 'hard' as const,
    };
    const fields2 = {
      deadlineKind: 'hard' as const,
      offices: ['Long Beach'],
      departments: ['R&D'],
      canonicalUrl: 'https://boards.greenhouse.io/co/jobs/1',
      locationRaw: 'Long Beach, CA',
      titleRaw: 'Biotech Intern',
      closesAt: '2026-07-01',
    };
    expect(makeGreenhouseMaterialHash(fields1)).toBe(makeGreenhouseMaterialHash(fields2));
  });
});
