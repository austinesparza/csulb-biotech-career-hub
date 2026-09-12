export interface CalendarDeadline {
  id: string;
  title: string;
  company: string;
  deadline: string;
  location?: string | null;
  url?: string | null;
}

function escapeCalendarText(value: string): string {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replaceAll(/\r?\n/g, '\\n');
}

function compactDate(value: string): string {
  return value.replaceAll('-', '');
}

function utcStamp(now: Date): string {
  return now.toISOString().replaceAll('-', '').replaceAll(':', '').replace(/\.\d{3}Z$/, 'Z');
}

export function buildDeadlineCalendar(
  deadlines: CalendarDeadline[],
  now = new Date(),
): string {
  const events = deadlines.map((item) => {
    const description = [
      `Application deadline for ${item.title} at ${item.company}.`,
      item.location ? `Location: ${item.location}.` : null,
      'Confirm the deadline and requirements on the current employer posting before applying.',
    ].filter(Boolean).join(' ');

    return [
      'BEGIN:VEVENT',
      `UID:${escapeCalendarText(`${item.id}@csulb-biotech-career-hub`)}`,
      `DTSTAMP:${utcStamp(now)}`,
      `DTSTART;VALUE=DATE:${compactDate(item.deadline)}`,
      `SUMMARY:${escapeCalendarText(`Apply: ${item.title} at ${item.company}`)}`,
      `DESCRIPTION:${escapeCalendarText(description)}`,
      ...(item.url ? [`URL:${item.url}`] : []),
      'BEGIN:VALARM',
      'TRIGGER:-P7D',
      'ACTION:DISPLAY',
      'DESCRIPTION:Application deadline in one week',
      'END:VALARM',
      'BEGIN:VALARM',
      'TRIGGER:-P1D',
      'ACTION:DISPLAY',
      'DESCRIPTION:Application deadline tomorrow',
      'END:VALARM',
      'END:VEVENT',
    ].join('\r\n');
  });

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CSULB Biotech Career Hub//Deadline Reminders//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...events,
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}
