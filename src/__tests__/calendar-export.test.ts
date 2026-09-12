import { describe, expect, it } from 'vitest';
import { buildDeadlineCalendar } from '../lib/calendarExport';

describe('deadline calendar export', () => {
  it('creates all-day events with two useful reminders', () => {
    const calendar = buildDeadlineCalendar([{
      id: 'role-1',
      title: 'Genomics Intern',
      company: 'Example Biotech',
      deadline: '2027-01-15',
      location: 'Long Beach, CA',
      url: 'https://example.org/jobs/1',
    }], new Date('2026-09-12T12:00:00.000Z'));

    expect(calendar).toContain('DTSTART;VALUE=DATE:20270115');
    expect(calendar).toContain('SUMMARY:Apply: Genomics Intern at Example Biotech');
    expect(calendar).toContain('TRIGGER:-P7D');
    expect(calendar).toContain('TRIGGER:-P1D');
    expect(calendar).toContain('URL:https://example.org/jobs/1');
  });

  it('escapes calendar punctuation', () => {
    const calendar = buildDeadlineCalendar([{
      id: 'role-2',
      title: 'Research, Data; Intern',
      company: 'A & B',
      deadline: '2027-02-01',
    }]);

    expect(calendar).toContain('Research\\, Data\\; Intern');
  });
});
