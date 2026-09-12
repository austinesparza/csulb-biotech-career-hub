'use client';

import { useMemo, useState } from 'react';
import { buildDeadlineCalendar, type CalendarDeadline } from '@/lib/calendarExport';

function formatDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

export function DeadlinePlanner({ deadlines }: { deadlines: CalendarDeadline[] }) {
  const [selected, setSelected] = useState(() => new Set(deadlines.map((item) => item.id)));
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

  const download = () => {
    if (selectedDeadlines.length === 0) return;
    const blob = new Blob([buildDeadlineCalendar(selectedDeadlines)], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'career-hub-deadlines.ics';
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="deadline-planner">
      <div className="deadline-planner-actions">
        <p>{selected.size} of {deadlines.length} deadline{deadlines.length === 1 ? '' : 's'} selected</p>
        <div>
          <button type="button" onClick={() => setSelected(new Set(deadlines.map((item) => item.id)))}>Select all</button>
          <button type="button" onClick={() => setSelected(new Set())}>Clear</button>
          <button type="button" className="primary-button" onClick={download} disabled={selected.size === 0}>Add reminders to calendar</button>
        </div>
      </div>
      <ol className="timeline-list">
        {deadlines.map((item) => (
          <li className="timeline-row" key={item.id}>
            <label className="timeline-select">
              <input
                type="checkbox"
                checked={selected.has(item.id)}
                onChange={(event) => toggle(item.id, event.target.checked)}
              />
              <time className="timeline-date">{formatDate(item.deadline)}</time>
            </label>
            <div className="timeline-line">
              <h2>{item.title}</h2>
              <p><strong>{item.company}</strong>{item.location ? ` · ${item.location}` : ''}</p>
              {item.url && <p><a href={item.url} target="_blank" rel="noopener noreferrer nofollow">Official posting ↗</a></p>}
            </div>
          </li>
        ))}
      </ol>
      <p className="deadline-planner-note">The download stays on your device and includes reminders one week and one day before each deadline.</p>
    </div>
  );
}
