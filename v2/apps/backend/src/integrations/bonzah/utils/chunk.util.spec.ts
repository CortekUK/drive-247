import { describe, it, expect } from 'vitest';
import { chunkDateRange } from './chunk.util';

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe('chunkDateRange', () => {
  it('returns a single chunk when range fits in one window', () => {
    const start = day('2026-05-01');
    const end = day('2026-05-05');
    const chunks = chunkDateRange(start, end, 30);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].start).toEqual(start);
    expect(chunks[0].end).toEqual(end);
  });

  it('returns a single chunk at exactly maxDays length', () => {
    const start = day('2026-05-01');
    const end = new Date(start.getTime() + 30 * 24 * 60 * 60 * 1000 - 1);
    const chunks = chunkDateRange(start, end, 30);
    expect(chunks).toHaveLength(1);
  });

  it('splits a 31-day range into two chunks', () => {
    const start = day('2026-05-01');
    const end = new Date(start.getTime() + 31 * 24 * 60 * 60 * 1000 - 1);
    const chunks = chunkDateRange(start, end, 30);
    expect(chunks).toHaveLength(2);
  });

  it('splits 90 days into three chunks of ≤30 days each', () => {
    const start = day('2026-05-01');
    const end = new Date(start.getTime() + 90 * 24 * 60 * 60 * 1000 - 1);
    const chunks = chunkDateRange(start, end, 30);
    expect(chunks).toHaveLength(3);
    for (const c of chunks) {
      const spanMs = c.end.getTime() - c.start.getTime() + 1;
      expect(spanMs).toBeLessThanOrEqual(30 * 24 * 60 * 60 * 1000);
    }
  });

  it('produces contiguous chunks with no overlap', () => {
    const start = day('2026-05-01');
    const end = new Date(start.getTime() + 65 * 24 * 60 * 60 * 1000 - 1);
    const chunks = chunkDateRange(start, end, 30);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].start.getTime()).toBe(chunks[i - 1].end.getTime() + 1);
    }
  });

  it('covers the full original range exactly', () => {
    const start = day('2026-05-01');
    const end = new Date(start.getTime() + 73 * 24 * 60 * 60 * 1000 - 1);
    const chunks = chunkDateRange(start, end, 30);
    expect(chunks[0].start).toEqual(start);
    expect(chunks[chunks.length - 1].end).toEqual(end);
  });

  it('throws if end is before start', () => {
    const start = day('2026-05-05');
    const end = day('2026-05-04');
    expect(() => chunkDateRange(start, end, 30)).toThrow(
      /end date must be on or after/i,
    );
  });

  it('throws for non-positive maxDays', () => {
    const start = day('2026-05-01');
    const end = day('2026-05-10');
    expect(() => chunkDateRange(start, end, 0)).toThrow(/positive/);
    expect(() => chunkDateRange(start, end, -1)).toThrow(/positive/);
  });

  it('handles same-day range', () => {
    const start = day('2026-05-01');
    const end = new Date(start.getTime() + 23 * 60 * 60 * 1000);
    const chunks = chunkDateRange(start, end, 30);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].start).toEqual(start);
    expect(chunks[0].end).toEqual(end);
  });
});
