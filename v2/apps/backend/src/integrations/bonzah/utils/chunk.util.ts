import { BONZAH_MAX_CHUNK_DAYS } from '@drive247/shared-types';

export interface DateRange {
  start: Date;
  end: Date;
}

/**
 * Split a trip date range into chunks no longer than `maxDays`.
 *
 * Bonzah's maximum policy duration is 30 days — longer trips must be issued
 * as a series of contiguous policies. Chunks are contiguous (no gaps, no
 * overlaps) and ordered by start date.
 *
 * Semantics:
 *  - `start` and `end` are both inclusive date-times
 *  - `maxDays` chunk length is measured in 24h increments
 *  - A single-chunk trip returns one range unchanged
 *
 * Pure function — no side effects, safe to unit test in isolation.
 */
export function chunkDateRange(
  start: Date,
  end: Date,
  maxDays: number = BONZAH_MAX_CHUNK_DAYS,
): DateRange[] {
  if (end < start) {
    throw new Error('End date must be on or after start date');
  }
  if (maxDays <= 0) {
    throw new Error('maxDays must be positive');
  }

  const chunks: DateRange[] = [];
  const maxMs = maxDays * 24 * 60 * 60 * 1000;

  let cursor = new Date(start.getTime());
  while (cursor <= end) {
    const chunkEnd = new Date(
      Math.min(cursor.getTime() + maxMs - 1, end.getTime()),
    );
    chunks.push({ start: new Date(cursor.getTime()), end: chunkEnd });
    cursor = new Date(chunkEnd.getTime() + 1);
  }

  return chunks;
}
