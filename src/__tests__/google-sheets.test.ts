import { generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  fetchGoogleSheet,
  googleSheetsConfigured,
  readGoogleSheetsConfig,
  writeGoogleSheet,
  type GoogleSheetsConfig,
} from '../lib/google-sheets';

const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();

function config(): GoogleSheetsConfig {
  return {
    spreadsheetId: 'abcdefghijklmnopqrstuvwxyz1234567890',
    range: 'Opportunities!A1:N5000',
    sourceRecordId: '00000000-0000-4000-8000-000000000001',
    serviceAccountEmail: 'career-hub@test-project.iam.gserviceaccount.com',
    privateKey: pem,
  };
}

describe('Google Sheet configuration', () => {
  it('requires every server-only binding', () => {
    expect(googleSheetsConfigured({})).toBe(false);
    expect(() => readGoogleSheetsConfig({})).toThrow('GOOGLE_SHEETS_SPREADSHEET_ID');
  });

  it('accepts an escaped PEM and keeps the source binding fixed', () => {
    const env = {
      GOOGLE_SHEETS_SPREADSHEET_ID: config().spreadsheetId,
      GOOGLE_SHEETS_RANGE: config().range,
      GOOGLE_SHEETS_SOURCE_RECORD_ID: config().sourceRecordId,
      GOOGLE_SERVICE_ACCOUNT_EMAIL: config().serviceAccountEmail,
      GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY: pem.replaceAll('\n', '\\n'),
    };
    expect(googleSheetsConfigured(env)).toBe(true);
    expect(readGoogleSheetsConfig(env)).toMatchObject({
      spreadsheetId: config().spreadsheetId,
      range: config().range,
      sourceRecordId: config().sourceRecordId,
      privateKey: pem,
    });
  });
});

describe('governed Google Sheet client', () => {
  it('uses a scoped service-account token and reads only the configured range', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      if (calls.length === 1) return new Response(JSON.stringify({ access_token: 'short-lived-token' }), { status: 200 });
      return new Response(JSON.stringify({
        range: 'Opportunities!A1:N3',
        values: [['Company', 'Title'], ['Example Bio', 'Genomics Intern'], ['Example Lab', 2027]],
      }), { status: 200 });
    }) as typeof fetch;

    const snapshot = await fetchGoogleSheet(config(), { fetchImpl, now: 1_789_000_000 });
    expect(snapshot).toEqual({
      range: 'Opportunities!A1:N3',
      rows: [['Company', 'Title'], ['Example Bio', 'Genomics Intern'], ['Example Lab', '2027']],
      rowCount: 2,
      columnCount: 2,
    });
    expect(calls[0].url).toBe('https://oauth2.googleapis.com/token');
    const body = calls[0].init?.body as URLSearchParams;
    const assertion = body.get('assertion')!;
    const payload = JSON.parse(Buffer.from(assertion.split('.')[1], 'base64url').toString());
    expect(payload).toMatchObject({
      iss: config().serviceAccountEmail,
      scope: 'https://www.googleapis.com/auth/spreadsheets',
      aud: 'https://oauth2.googleapis.com/token',
      iat: 1_789_000_000,
      exp: 1_789_003_600,
    });
    expect(calls[1].url).toContain('/v4/spreadsheets/abcdefghijklmnopqrstuvwxyz1234567890/values/Opportunities!A1%3AN5000');
    expect((calls[1].init?.headers as Record<string, string>).Authorization).toBe('Bearer short-lived-token');
    expect(calls[1].init?.cache).toBe('no-store');
  });

  it('fails closed on malformed or unexpectedly large Sheet responses', async () => {
    const huge = Array.from({ length: 5_001 }, () => ['x', 'y']);
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ values: huge }), { status: 200 })) as typeof fetch;
    await expect(fetchGoogleSheet(config(), { fetchImpl })).rejects.toThrow('too large');
  });

  it('does not include response bodies or credentials in errors', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token' }), { status: 200 }))
      .mockResolvedValueOnce(new Response('private spreadsheet contents', { status: 403 })) as typeof fetch;
    await expect(fetchGoogleSheet(config(), { fetchImpl })).rejects.toThrow('Google Sheets read failed (403)');
  });

  it('updates explicit ranges and appends rows without returning Sheet contents', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), init });
      if (calls.length === 1) {
        return new Response(JSON.stringify({ access_token: 'short-lived-token' }), { status: 200 });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;

    const summary = await writeGoogleSheet(config(), {
      updates: [{ range: 'Opportunities!X2:X2', values: [['record-id']] }],
      appendRows: [['AUTO-1234', 'Needs review']],
    }, { fetchImpl, now: 1_789_000_000 });

    expect(summary).toEqual({ updatedRanges: 1, appendedRows: 1 });
    expect(calls).toHaveLength(3);
    expect(calls[1].url).toContain('/values:batchUpdate');
    expect(calls[1].init?.method).toBe('POST');
    expect(JSON.parse(String(calls[1].init?.body))).toMatchObject({
      valueInputOption: 'RAW',
      data: [{ range: 'Opportunities!X2:X2', values: [['record-id']] }],
    });
    expect(calls[2].url).toContain('/values/Opportunities!A1%3AN5000:append');
    expect(calls[2].url).toContain('insertDataOption=INSERT_ROWS');
    expect(calls[2].init?.method).toBe('POST');
  });

  it('rejects oversized writes before requesting a Google token', async () => {
    const fetchImpl = vi.fn() as typeof fetch;
    const rows = Array.from({ length: 101 }, () => ['x']);
    await expect(writeGoogleSheet(config(), { appendRows: rows }, { fetchImpl }))
      .rejects.toThrow('100-row safety limit');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

});
