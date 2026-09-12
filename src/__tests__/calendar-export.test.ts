import { describe, expect, it } from 'vitest';
import { buildDeadlineCalendar, buildGoogleCalendarUrl } from '../lib/calendarExport';

describe('deadline calendar export', () => {
  it('creates bounded all-day events with useful reminders', () => {
    const calendar = buildDeadlineCalendar([{
      id: 'role-1',
      title: 'Genomics Intern',
      company: 'Example Biotech',
      deadline: '2027-01-15',
      location: 'Long Beach, CA',
      url: 'https://example.org/jobs/1',
    }], new Date('2026-09-12T12:00:00.000Z'));

    expect(calendar).toContain('DTSTART;VALUE=DATE:20270115');
    expect(calendar).toContain('DTEND;VALUE=DATE:20270116');
    expect(calendar).toContain('SUMMARY:Apply: Genomics Intern at Example Biotech');
    expect(calendar).toContain('TRIGGER:-P7D');
    expect(calendar).toContain('TRIGGER:-P1D');
    expect(calendar).toContain('TRIGGER:-P14D');
    expect(calendar).toContain('URL:https://example.org/jobs/1');
  });

  it('allows the exporter to use only the reminder times a student selected', () => {
    const calendar = buildDeadlineCalendar([{
      id: 'role-3',
      title: 'Research Intern',
      company: 'Example Biotech',
      deadline: '2027-03-10',
    }], new Date('2026-09-12T12:00:00.000Z'), [7]);

    expect(calendar).toContain('TRIGGER:-P7D');
    expect(calendar).not.toContain('TRIGGER:-P14D');
    expect(calendar).not.toContain('TRIGGER:-P1D');
  });

  it('builds a single-deadline Google Calendar link with an exclusive end date', () => {
    const url = new URL(buildGoogleCalendarUrl({
      id: 'role-4',
      title: 'Process Development Intern',
      company: 'Example Biotech',
      deadline: '2027-04-30',
      location: 'Long Beach, CA',
      url: 'https://example.org/jobs/4',
    }));

    expect(url.hostname).toBe('calendar.google.com');
    expect(url.searchParams.get('dates')).toBe('20270430/20270501');
    expect(url.searchParams.get('text')).toContain('Process Development Intern');
    expect(url.searchParams.get('location')).toBe('Long Beach, CA');
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
