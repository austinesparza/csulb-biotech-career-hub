import test from 'node:test';
import assert from 'node:assert/strict';
import { materialDiff, normalizeCompany, validate } from './publish-reviewed-data.mjs';

test('reviewed data validates without touching a database', () => {
  assert.doesNotThrow(() => validate({ source: { name: 'Officer review', checked: '2026-09-09' }, opportunities: [{
    company: 'Example Bio', title: 'Graduate Intern', posting_url: 'https://example.org/job', status: 'open_verified',
    audience_bucket: 'graduate', audience_reason: 'Master students are explicitly eligible.',
  }] }));
});

test('material changes are held for officer review', () => {
  assert.deepEqual(materialDiff({ title: 'Old', location: null }, { title: 'New', location: null }), ['title']);
  assert.deepEqual(materialDiff({ title: 'Same' }, { title: 'Same' }), []);
});

test('company normalization is stable', () => {
  assert.equal(normalizeCompany('Johnson & Johnson'), 'johnson johnson');
});
