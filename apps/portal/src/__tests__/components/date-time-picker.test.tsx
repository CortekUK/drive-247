/**
 * The v2 date-time picker that replaced the native `datetime-local` popup in the
 * reminders composer. It must hand back exactly the string that input did
 * ("YYYY-MM-DDTHH:mm", or "" for none), so the save path is unchanged.
 *
 * "Now" is pinned to Tue 15 Sep 2026, 10:07 local. Only `Date` is faked, so
 * Radix's own timers still run.
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DateTimePicker,
  parseLocalDateTime,
  toLocalDateTime,
} from '@/components/ui-v2/date-time-picker';

function Harness({ initial = '' }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <>
      <DateTimePicker value={value} onChange={setValue} defaultOpen aria-label="When" />
      <output data-testid="value">{value}</output>
    </>
  );
}

const value = () => screen.getByTestId('value').textContent;
const click = (el: HTMLElement) => act(() => { fireEvent.click(el); });
const day = (n: number) => screen.getByRole('gridcell', { name: String(n) });
const slot = (label: string) => screen.getByRole('button', { name: label });

// Radix positions the popover with floating-ui, which calls `new ResizeObserver`.
// The shared setup mocks ResizeObserver with an arrow function, and an arrow
// function cannot be constructed, so this file installs a stand-in that can.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 15, 10, 7));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('DateTimePicker', () => {
  it('opens with shortcuts, the month and the time slots', () => {
    render(<Harness />);
    expect(screen.getByText('September 2026')).toBeInTheDocument();
    expect(slot('Tomorrow 9 AM')).toBeInTheDocument();
    expect(slot('2:30 PM')).toBeInTheDocument();
  });

  it('a day, then a time, gives the datetime-local string', () => {
    render(<Harness />);
    click(day(20));
    expect(value()).toBe('2026-09-20T09:00');
    click(slot('2:30 PM'));
    expect(value()).toBe('2026-09-20T14:30');
    expect(screen.getByRole('button', { name: 'When' })).toHaveTextContent('Sun 20 Sep, 2:30 PM');
  });

  it('a time picked first lands today, or tomorrow once it has already gone', () => {
    render(<Harness />);
    click(slot('11:00 AM'));
    expect(value()).toBe('2026-09-15T11:00');
    click(slot('Clear'));
    expect(value()).toBe('');
    click(slot('8:00 AM'));
    expect(value()).toBe('2026-09-16T08:00');
  });

  it('refuses past days, and past times on today', () => {
    render(<Harness />);
    expect(day(14)).toBeDisabled();
    click(day(15));
    expect(value()).toBe('2026-09-15T10:15'); // the next slot after 10:07
    expect(slot('10:00 AM')).toBeDisabled();
    expect(slot('10:15 AM')).not.toBeDisabled();
  });

  it('moves a kept time forward when the day changes to today and that time has gone', () => {
    render(<Harness initial="2026-09-20T08:00" />);
    click(day(15));
    expect(value()).toBe('2026-09-15T10:15');
  });

  it('shortcuts set the whole value', () => {
    render(<Harness />);
    click(slot('Tomorrow 9 AM'));
    expect(value()).toBe('2026-09-16T09:00');
    click(slot('In 1 hour'));
    expect(value()).toBe('2026-09-15T11:15');
    click(slot('Monday 9 AM'));
    expect(value()).toBe('2026-09-21T09:00');
  });

  it('clicking the chosen day again keeps the value; Clear empties it', () => {
    render(<Harness initial="2026-09-20T14:30" />);
    click(day(20));
    expect(value()).toBe('2026-09-20T14:30');
    click(slot('Clear'));
    expect(value()).toBe('');
  });
});

describe('local date-time strings', () => {
  it('round-trips a wall-clock value', () => {
    expect(toLocalDateTime(parseLocalDateTime('2026-09-20T14:30')!)).toBe('2026-09-20T14:30');
  });

  it('rejects empty, malformed and impossible values', () => {
    expect(parseLocalDateTime('')).toBeNull();
    expect(parseLocalDateTime('2026-09-20 14:30')).toBeNull();
    expect(parseLocalDateTime('2026-02-30T10:00')).toBeNull();
    expect(parseLocalDateTime('2026-09-20T24:00')).toBeNull();
  });
});
