export interface CalendarDeadline {
  id: string;
  title: string;
  company: string;
  deadline: string;
  location?: string | null;
  url?: string | null;
}

export const CALENDAR_REMINDER_OPTIONS = [14, 7, 1] as const;
export type CalendarReminderDays = typeof CALENDAR_REMINDER_OPTIONS[number];

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

function nextDate(value: string): string {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

export function buildDeadlineCalendar(
  deadlines: CalendarDeadline[],
  now = new Date(),
  reminderDays: readonly number[] = [14, 7, 1],
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
      `DTEND;VALUE=DATE:${compactDate(nextDate(item.deadline))}`,
      `SUMMARY:${escapeCalendarText(`Apply: ${item.title} at ${item.company}`)}`,
      `DESCRIPTION:${escapeCalendarText(description)}`,
      'CATEGORIES:Application deadline,Career Hub',
      ...(item.url ? [`URL:${item.url}`] : []),
      ...reminderDays.flatMap((days) => [
        'BEGIN:VALARM',
        `TRIGGER:-P${days}D`,
        'ACTION:DISPLAY',
        `DESCRIPTION:Application deadline in ${days === 1 ? 'one day' : `${days} days`}`,
        'END:VALARM',
      ]),
      'END:VEVENT',
    ].join('\r\n');
  });

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//CSULB Biotech Career Hub//Deadline Reminders//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Career Hub deadlines',
    ...events,
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

export function buildGoogleCalendarUrl(item: CalendarDeadline): string {
  const description = [
    `Application deadline for ${item.title} at ${item.company}.`,
    item.location ? `Location: ${item.location}.` : null,
    item.url ? `Official posting: ${item.url}` : null,
    'Confirm the deadline on the employer posting before applying.',
  ].filter(Boolean).join('\n\n');
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Apply: ${item.title} at ${item.company}`,
    dates: `${compactDate(item.deadline)}/${compactDate(nextDate(item.deadline))}`,
    details: description,
    ...(item.location ? { location: item.location } : {}),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
