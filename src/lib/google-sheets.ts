import 'server-only';

import { createSign } from 'node:crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_ORIGIN = 'https://sheets.googleapis.com';
const READ_ONLY_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const MAX_ROWS = 5_000;
const MAX_COLUMNS = 60;
const MAX_CELLS = 100_000;

export interface GoogleSheetsConfig {
  spreadsheetId: string;
  range: string;
  sourceRecordId: string;
  serviceAccountEmail: string;
  privateKey: string;
}

export interface SheetSnapshot {
  rows: string[][];
  range: string;
  rowCount: number;
  columnCount: number;
}

type FetchLike = typeof fetch;
type Environment = Readonly<Record<string, string | undefined>>;

function required(env: Environment, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is not configured`);
  if (/\r|\n/.test(value) && name !== 'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY') {
    throw new Error(`${name} must be a single line`);
  }
  return value;
}

export function googleSheetsConfigured(env: Environment = process.env): boolean {
  return [
    'GOOGLE_SHEETS_SPREADSHEET_ID',
    'GOOGLE_SHEETS_RANGE',
    'GOOGLE_SHEETS_SOURCE_RECORD_ID',
    'GOOGLE_SERVICE_ACCOUNT_EMAIL',
    'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY',
  ].every((name) => Boolean(env[name]?.trim()));
}

export function readGoogleSheetsConfig(env: Environment = process.env): GoogleSheetsConfig {
  const spreadsheetId = required(env, 'GOOGLE_SHEETS_SPREADSHEET_ID');
  if (!/^[a-zA-Z0-9_-]{20,200}$/.test(spreadsheetId)) {
    throw new Error('GOOGLE_SHEETS_SPREADSHEET_ID has an invalid format');
  }

  const serviceAccountEmail = required(env, 'GOOGLE_SERVICE_ACCOUNT_EMAIL');
  if (!/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/i.test(serviceAccountEmail)) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_EMAIL must be a service-account address');
  }

  const privateKey = required(env, 'GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY').replace(/\\n/g, '\n');
  if (!privateKey.includes('BEGIN PRIVATE KEY') || !privateKey.includes('END PRIVATE KEY')) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY is not a PEM private key');
  }

  const sourceRecordId = required(env, 'GOOGLE_SHEETS_SOURCE_RECORD_ID');
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sourceRecordId)) {
    throw new Error('GOOGLE_SHEETS_SOURCE_RECORD_ID must be a UUID');
  }

  return {
    spreadsheetId,
    range: required(env, 'GOOGLE_SHEETS_RANGE'),
    sourceRecordId,
    serviceAccountEmail,
    privateKey,
  };
}

function base64url(value: string): string {
  return Buffer.from(value).toString('base64url');
}

function serviceAccountAssertion(config: GoogleSheetsConfig, now: number): string {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({
    iss: config.serviceAccountEmail,
    scope: READ_ONLY_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3_600,
  }));
  const unsigned = `${header}.${payload}`;
  const signature = createSign('RSA-SHA256').update(unsigned).end().sign(config.privateKey, 'base64url');
  return `${unsigned}.${signature}`;
}

async function accessToken(config: GoogleSheetsConfig, fetchImpl: FetchLike, now: number): Promise<string> {
  const response = await fetchImpl(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: serviceAccountAssertion(config, now),
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Google service-account authentication failed (${response.status})`);
  const body = await response.json() as { access_token?: unknown };
  if (typeof body.access_token !== 'string' || !body.access_token) {
    throw new Error('Google service-account authentication returned no access token');
  }
  return body.access_token;
}

function normalizeRows(input: unknown): string[][] {
  if (!Array.isArray(input)) throw new Error('Google Sheets returned an invalid values payload');
  const rows = input.map((row) => {
    if (!Array.isArray(row)) throw new Error('Google Sheets returned a malformed row');
    return row.map((cell) => cell == null ? '' : String(cell));
  });
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  if (rows.length > MAX_ROWS || columnCount > MAX_COLUMNS || rows.length * columnCount > MAX_CELLS) {
    throw new Error(`Configured Sheet range is too large; limit it to ${MAX_ROWS} rows, ${MAX_COLUMNS} columns, and ${MAX_CELLS} cells`);
  }
  if (rows.length < 2 || rows[0].filter((cell) => cell.trim()).length < 2) {
    throw new Error('Configured Sheet range must include a header row and at least one data row');
  }
  return rows;
}

export async function fetchGoogleSheet(
  config: GoogleSheetsConfig,
  options: { fetchImpl?: FetchLike; now?: number } = {},
): Promise<SheetSnapshot> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Math.floor(Date.now() / 1_000);
  const token = await accessToken(config, fetchImpl, now);
  const path = `/v4/spreadsheets/${encodeURIComponent(config.spreadsheetId)}/values/${encodeURIComponent(config.range)}`;
  const url = new URL(path, SHEETS_ORIGIN);
  url.searchParams.set('majorDimension', 'ROWS');
  url.searchParams.set('valueRenderOption', 'FORMATTED_VALUE');
  url.searchParams.set('dateTimeRenderOption', 'FORMATTED_STRING');

  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    signal: AbortSignal.timeout(20_000),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Google Sheets read failed (${response.status})`);
  const body = await response.json() as { range?: unknown; values?: unknown };
  const rows = normalizeRows(body.values);
  return {
    rows,
    range: typeof body.range === 'string' ? body.range : config.range,
    rowCount: rows.length - 1,
    columnCount: rows.reduce((max, row) => Math.max(max, row.length), 0),
  };
}
