import type { PaidStatus } from './types';

const MONEY = /\$\s*\d[\d,]*(?:\.\d+)?(?:\s*(?:[-–]|to)\s*\$?\s*\d[\d,]*(?:\.\d+)?)?/;
const PERIOD = /(?:\/|per\s+)(?:hours?|hrs?|weeks?|months?|years?)\b|\b(?:hourly|weekly|monthly|annually|annualized|annual salary|yearly|stipend)\b/i;
const BASE_PAY = /\b(?:base pay|base salary|salary range|pay range|pay rate|hourly pay|hourly range|hourly rate|hourly compensation|monthly compensation|expected pay|compensation range|employer compensation|employer pay range)\b/i;
const ANCILLARY = /\b(?:housing|relocation|travel|transportation|meal|sign[ -]?on|signing)\b/i;
const PAID = /\bpaid[ -]+(?:(?:summer|year[ -]round|full[ -]time|part[ -]time)[ -]+)*(?:internship|co[ -]?op|position|role|opportunity|program)\b/i;
const UNPAID = /\bunpaid[ -]+(?:internship|co[ -]?op|position|role|opportunity)\b|\b(?:internship|co[ -]?op|position|role|opportunity)\b[^.!?]{0,50}\bis unpaid\b/i;

/** Evidence only. Never convert periods, complete blank ranges, or infer a unit. */
export function compensationEvidence(text: string | null | undefined): string[] {
  const parts = (text ?? '').split(/\n+|(?<=[.!?])\s+(?=[A-Z])|[•▪◦]/)
    .map((part) => part.replace(/\s+/g, ' ').trim()).filter(Boolean);
  return [...new Set(parts.filter((part) => {
    if (/salary expectations?|desired salary|current salary|revenue|funding|capital raised|training cost|tuition cost|research budget|veteran.*compensation/i.test(part)) return false;
    const money = part.match(MONEY);
    if (!money || /^\$\s*0(?:\.0+)?(?:\s*[-–]\s*\$?\s*0(?:\.0+)?)?$/.test(money[0])) return false;
    // Housing and relocation are support, not the base wage or research stipend.
    if (ANCILLARY.test(part) && !BASE_PAY.test(part) && !/(?:\/|per\s+)(?:hours?|hrs?)\b/i.test(part)) return false;
    return PERIOD.test(part) || BASE_PAY.test(part) || /\b(?:paid position|paid salary|paid a salary|base pay)\b/i.test(part);
  }))];
}

export function inferCompensationStatus(text: string | null | undefined): PaidStatus {
  if (!text) return 'unknown';
  if (UNPAID.test(text)) return 'unpaid';
  const evidence = compensationEvidence(text);
  if (evidence.some((part) => !/\bstipend\b/i.test(part) || BASE_PAY.test(part) || /(?:\/|per\s+)(?:hours?|hrs?)\b/i.test(part))) return 'paid';
  if (evidence.length || /\b(?:receive|receives|provided|provides|offer|offers|offered)\b[^.!?\n]{0,60}\b(?:monthly |annual |yearly )?stipend\b|\bstipend (?:is )?(?:provided|offered)\b/i.test(text)) return 'stipend';
  return PAID.test(text) ? 'paid' : 'unknown';
}

/** Existing public_notes remain the publication contract and full source context. */
export function compensationLabel(paidStatus: PaidStatus, notes: string | null): string {
  const marked = notes?.match(/(?:^|\n)Employer compensation:\s*([^\n]+)/i)?.[1]?.trim();
  const evidence = marked || compensationEvidence(notes).join(' ');
  if (evidence) return evidence.length > 180 ? `${paidStatus === 'stipend' ? 'Stipend' : 'Paid'}; see rates in role notes` : evidence;
  if (paidStatus === 'paid') return 'Paid; amount not stated';
  if (paidStatus === 'stipend') return 'Stipend; amount not stated';
  if (paidStatus === 'unpaid') return 'Unpaid';
  return 'Pay not stated';
}
