'use client';

import { useMemo, useState } from 'react';
import {
  buildDeadlineCalendar,
  buildGoogleCalendarUrl,
  CALENDAR_REMINDER_OPTIONS,
  type CalendarDeadline,
  type CalendarReminderDays,
} from '@/lib/calendarExport';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

function dateParts(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return { year, month, day };
}

function downloadName(items: CalendarDeadline[]) {
  return items.length === 1
    ? `${items[0].company}-${items[0].deadline}.ics`.toLowerCase().replace(/[^a-z0-9.-]+/g, '-')
    : 'career-hub-deadlines.ics';
}

export function DeadlinePlanner({ deadlines }: { deadlines: CalendarDeadline[] }) {
  const [selected, setSelected] = useState(() => new Set(deadlines.map((item) => item.id)));
  const [reminders, setReminders] = useState<Set<CalendarReminderDays>>(
    () => new Set(CALENDAR_REMINDER_OPTIONS),
  );
  const selectedDeadlines = useMemo(
    () => deadlines.filter((item) => selected.has(item.id)),
    [deadlines, selected],
  );

  const toggle = (id: string, checked: boolean) => {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const months = useMemo(() => {
    const grouped = new Map<string, CalendarDeadline[]>();
    for (const item of deadlines) {
      const key = item.deadline.slice(0, 7);
      grouped.set(key, [...(grouped.get(key) ?? []), item]);
    }
    return [...grouped.entries()].toSorted(([a], [b]) => a.localeCompare(b));
  }, [deadlines]);

  const download = (items = selectedDeadlines) => {
    if (items.length === 0) return;
    const blob = new Blob(
      [buildDeadlineCalendar(items, new Date(), [...reminders].toSorted((a, b) => b - a))],
      { type: 'text/calendar;charset=utf-8' },
    );
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = downloadName(items);
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const toggleReminder = (days: CalendarReminderDays) => {
    setReminders((current) => {
      const next = new Set(current);
      if (next.has(days)) next.delete(days);
      else next.add(days);
      return next;
    });
  };

  return (
    <div className="deadline-planner">
      <div className="deadline-exporter">
        <div>
          <h2>Take the deadlines with you.</h2>
          <p>Choose the roles and reminder times you want. The file works with Apple Calendar, Google Calendar, Outlook, and most calendar apps.</p>
        </div>
        <fieldset>
          <legend>Remind me</legend>
          {CALENDAR_REMINDER_OPTIONS.map((days) => (
            <label key={days}>
              <input type="checkbox" checked={reminders.has(days)} onChange={() => toggleReminder(days)} />
              <span>{days === 1 ? '1 day' : `${days} days`} before</span>
            </label>
          ))}
        </fieldset>
        <div className="deadline-export-actions">
          <p>{selected.size} of {deadlines.length} selected</p>
          <button type="button" onClick={() => setSelected(new Set(deadlines.map((item) => item.id)))}>Select all</button>
          <button type="button" onClick={() => setSelected(new Set())}>Clear</button>
          <button type="button" className="primary-button" onClick={() => download()} disabled={selected.size === 0}>Download selected .ics</button>
        </div>
      </div>
      <div className="deadline-calendar-scroll">
        <div className="deadline-calendar-months">
          {months.map(([key, monthDeadlines]) => {
            const { year, month } = dateParts(`${key}-01`);
            const offset = new Date(year, month - 1, 1).getDay();
            const days = new Date(year, month, 0).getDate();
            const cells = Array.from({ length: Math.ceil((offset + days) / 7) * 7 }, (_, index) => {
              const day = index - offset + 1;
              return day > 0 && day <= days ? day : null;
            });
            return (
              <section className="deadline-month" key={key} aria-label={new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}>
                <header>
                  <span>{new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long' })}</span>
                  <strong>{year}</strong>
                </header>
                <div className="deadline-weekdays" aria-hidden="true">{WEEKDAYS.map((day) => <span key={day}>{day}</span>)}</div>
                <ol className="deadline-days">
                  {cells.map((day, index) => {
                    const dayDeadlines = day ? monthDeadlines.filter((item) => dateParts(item.deadline).day === day) : [];
                    return (
                      <li key={`${key}-${index}`} className={dayDeadlines.length ? 'has-deadline' : ''}>
                        {day && <time dateTime={`${key}-${String(day).padStart(2, '0')}`}>{day}</time>}
                        {dayDeadlines.map((item) => (
                          <div className="deadline-calendar-event" key={item.id}>
                            <label title={`Select ${item.title}`}>
                              <input type="checkbox" checked={selected.has(item.id)} onChange={(event) => toggle(item.id, event.target.checked)} />
                              <span>{item.company}</span>
                            </label>
                            <strong>{item.title}</strong>
                            <div>
                              <button type="button" onClick={() => download([item])}>.ics</button>
                              <a href={buildGoogleCalendarUrl(item)} target="_blank" rel="noopener noreferrer">Google</a>
                              {item.url && <a href={item.url} target="_blank" rel="noopener noreferrer nofollow">Posting</a>}
                            </div>
                          </div>
                        ))}
                      </li>
                    );
                  })}
                </ol>
              </section>
            );
          })}
        </div>
      </div>
      <p className="deadline-planner-note">Calendar files are generated in your browser. Nothing about your selections is sent to us. Confirm every deadline on the employer posting.</p>
    </div>
  );
}
