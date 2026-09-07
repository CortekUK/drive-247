'use client';

/**
 * A half-hour time picker, used by both halves of the screen.
 *
 * Deliberately coarser than v1's three-column hour/minute/AM-PM scroller. That
 * control is right for the settings form, where a tenant sets their hours once
 * and wants the minute. Here an operator is sketching a week and clicks it
 * dozens of times, so 48 options in one list beats 12 + 60 + 2 in three.
 *
 * If the stored value is not on a half hour (v1 can write 09:07), it is added
 * to the list rather than silently rounded — the picker must never be the thing
 * that changes a tenant's real hours behind their back.
 */

import { useMemo } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui-v2/select';
import { cn } from '@/lib/utils';
import { TIME_OPTIONS, formatTime, toMinutes } from './availability-model';

interface TimePickProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}

export function TimePick({ value, onChange, disabled, className, ...rest }: TimePickProps) {
  const options = useMemo(() => {
    if (!value || TIME_OPTIONS.includes(value)) return TIME_OPTIONS;
    return [...TIME_OPTIONS, value].sort((a, b) => toMinutes(a) - toMinutes(b));
  }, [value]);

  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger
        className={cn('h-8 w-[112px] text-xs', className)}
        aria-label={rest['aria-label']}
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent className="max-h-[260px]">
        {options.map((t) => (
          <SelectItem key={t} value={t} className="text-xs">
            {formatTime(t)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
