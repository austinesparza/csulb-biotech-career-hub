import type { SubmissionType } from './types';

export const PUBLIC_SUBMISSION_TYPES = ['opportunity', 'correction', 'resource'] as const;
export type PublicSubmissionType = Extract<SubmissionType, (typeof PUBLIC_SUBMISSION_TYPES)[number]>;

export interface PublicSubmission {
  submissionType: PublicSubmissionType;
  payload: {
    url: string;
    company: string | null;
    title: string | null;
    details: string | null;
  };
  submitterName: string | null;
  submitterEmail: string | null;
}

export type SubmissionValidation =
  | { ok: true; value: PublicSubmission }
  | { ok: false; error: string };

function optionalText(value: FormDataEntryValue | null, max: number): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  return text.slice(0, max);
}

export function validatePublicSubmission(formData: FormData): SubmissionValidation {
  const rawType = String(formData.get('type') ?? '');
  if (!PUBLIC_SUBMISSION_TYPES.includes(rawType as PublicSubmissionType)) {
    return { ok: false, error: 'Choose a valid submission type.' };
  }

  const rawUrl = String(formData.get('url') ?? '').trim();
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return { ok: false, error: 'Enter a valid HTTPS link.' };
  }
  if (url.protocol !== 'https:' || url.username || url.password || rawUrl.length > 500) {
    return { ok: false, error: 'Enter a valid HTTPS link.' };
  }

  const email = optionalText(formData.get('email'), 120);
  if (email && !/^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/.test(email)) {
    return { ok: false, error: 'Enter a valid email address or leave it blank.' };
  }

  return {
    ok: true,
    value: {
      submissionType: rawType as PublicSubmissionType,
      payload: {
        url: url.href,
        company: optionalText(formData.get('company'), 120),
        title: optionalText(formData.get('title'), 160),
        details: optionalText(formData.get('details'), 1000),
      },
      submitterName: optionalText(formData.get('name'), 80),
      submitterEmail: email,
    },
  };
}
