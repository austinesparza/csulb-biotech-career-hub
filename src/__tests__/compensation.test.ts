import { describe, expect, it } from 'vitest';
import { compensationEvidence, compensationLabel, inferCompensationStatus } from '../lib/compensation';
import { mapHeaders, rowToDraft } from '../lib/csvImport';

describe('compensation evidence and display', () => {
  it.each([
    ['$25/hr', 'paid'], ['$25 - $35 per hour', 'paid'],
    ['$35.34–$41.20/hour', 'paid'], ['$1,500/week', 'paid'],
    ['$5,000 stipend', 'stipend'], ['$60,000–$80,000 annually', 'paid'],
    ['The expected monthly compensation range is $10,000–$15,000.', 'paid'],
    ['The hourly pay for this role is $30.', 'paid'],
    ['Potential base pay range: $28–$32 USD; unit not specified.', 'paid'],
    ['$35/hour plus a housing stipend.', 'paid'],
  ] as const)('retains the stated text and period: %s', (text, status) => {
    expect(compensationEvidence(text)).toEqual([text]);
    expect(inferCompensationStatus(text)).toBe(status);
  });

  it.each([
    'We raised $130M in funding.', 'Annualized revenue of $400M.',
    'Benefits include paid holidays and unpaid time off.',
    'Housing stipend: $5,000.', '$5,000 housing stipend.', 'What are your salary expectations? $50,000',
    'Process 10,000 samples in 2027.', 'Pay Range: $0 - $0',
  ])('does not invent base compensation from %s', (text) => {
    expect(compensationEvidence(text)).toEqual([]);
    expect(inferCompensationStatus(text)).toBe('unknown');
  });

  it('preserves separate location ranges and prefers them over generic paid language', () => {
    const notes = 'Paid internship.\nCalifornia base pay: $30–$40/hour.\nNew York base pay: $32–$42/hour.';
    expect(compensationEvidence(notes)).toEqual(['California base pay: $30–$40/hour.', 'New York base pay: $32–$42/hour.']);
    expect(compensationLabel('unknown', notes)).toContain('$32–$42/hour');
  });

  it('shows exact reviewed pay and explicit amount-not-stated fallbacks', () => {
    expect(compensationLabel('paid', 'Role context.\nEmployer compensation: $35–$50/hour.\nFinancial support: Housing.')).toBe('$35–$50/hour.');
    expect(compensationLabel('paid', null)).toBe('Paid; amount not stated');
    expect(compensationLabel('stipend', null)).toBe('Stipend; amount not stated');
    expect(compensationLabel('unknown', null)).toBe('Pay not stated');
    expect(compensationLabel('unpaid', null)).toBe('Unpaid');
  });

  it('keeps a long tier schedule in the existing expanded notes', () => {
    const text = `Employer compensation: ${'Graduate rate $34/hour; '.repeat(12)}`;
    expect(compensationLabel('paid', text)).toBe('Paid; see rates in role notes');
  });

  it('captures both Sheet paid status and the original amount without publishing raw cells', () => {
    const { mapping } = mapHeaders(['Employer', 'Title', 'Paid status', 'Compensation']);
    const result = rowToDraft({ Employer: 'Bio', Title: 'Intern', 'Paid status': 'Paid', Compensation: '$1,500/week + housing assistance' }, mapping);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.draft.paid_status).toBe('paid');
    expect(result.draft.private_notes).toContain('Compensation (source column): $1,500/week + housing assistance');
    expect(result.draft).not.toHaveProperty('public_notes');
  });
});
