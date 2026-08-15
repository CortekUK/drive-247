export type WatchedRange = readonly [start: number, end: number];

const RANGE_JOIN_TOLERANCE_SECONDS = 0.25;
const MAX_STORED_RANGES = 256;
const MAX_STORED_POSITION_SECONDS = 86_400;

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

/**
 * Normalizes and merges played ranges. Ranges are coverage, not seek position,
 * so callers must only add intervals observed during real playback.
 */
export function mergeWatchedRanges(
  ranges: readonly WatchedRange[],
  duration?: number,
): WatchedRange[] {
  const maximum =
    isFiniteNonNegative(duration) && duration > 0
      ? duration
      : Number.POSITIVE_INFINITY;

  const normalized = ranges
    .filter(
      (range): range is WatchedRange =>
        Array.isArray(range) &&
        range.length === 2 &&
        isFiniteNonNegative(range[0]) &&
        isFiniteNonNegative(range[1]) &&
        range[1] > range[0],
    )
    .map(
      ([start, end]) =>
        [Math.min(start, maximum), Math.min(end, maximum)] as WatchedRange,
    )
    .filter(([start, end]) => end > start)
    .sort((left, right) => left[0] - right[0]);

  return normalized.reduce<WatchedRange[]>((merged, current) => {
    const previous = merged.at(-1);

    if (
      !previous ||
      current[0] > previous[1] + RANGE_JOIN_TOLERANCE_SECONDS
    ) {
      merged.push(current);
      return merged;
    }

    merged[merged.length - 1] = [
      previous[0],
      Math.max(previous[1], current[1]),
    ];
    return merged;
  }, []);
}

export function addWatchedRange(
  ranges: readonly WatchedRange[],
  start: number,
  end: number,
  duration: number,
): WatchedRange[] {
  if (
    !isFiniteNonNegative(start) ||
    !isFiniteNonNegative(end) ||
    !isFiniteNonNegative(duration) ||
    duration <= 0 ||
    end <= start
  ) {
    return mergeWatchedRanges(ranges, duration);
  }

  return mergeWatchedRanges([...ranges, [start, end]], duration);
}

export function watchedSeconds(
  ranges: readonly WatchedRange[],
  duration?: number,
): number {
  return mergeWatchedRanges(ranges, duration).reduce(
    (total, [start, end]) => total + (end - start),
    0,
  );
}

export function watchedPercent(
  ranges: readonly WatchedRange[],
  duration: number,
): number {
  if (!Number.isFinite(duration) || duration <= 0) return 0;

  return Math.min(
    100,
    Math.max(0, (watchedSeconds(ranges, duration) / duration) * 100),
  );
}

/**
 * A normal completion needs 90% unique coverage. The ended event is accepted
 * at 80% coverage to tolerate short credits/outros, but never by itself.
 */
export function isVideoComplete(
  ranges: readonly WatchedRange[],
  duration: number,
  ended = false,
): boolean {
  const percent = watchedPercent(ranges, duration);
  return percent >= 90 || (ended && percent >= 80);
}

export function sanitizeStoredRanges(value: unknown): WatchedRange[] {
  if (!Array.isArray(value)) return [];
  const bounded = value
    .slice(0, MAX_STORED_RANGES)
    .filter(
      (range): range is WatchedRange =>
        Array.isArray(range) &&
        range.length === 2 &&
        isFiniteNonNegative(range[0]) &&
        isFiniteNonNegative(range[1]) &&
        range[0] <= MAX_STORED_POSITION_SECONDS &&
        range[1] <= MAX_STORED_POSITION_SECONDS,
    );
  return mergeWatchedRanges(bounded, MAX_STORED_POSITION_SECONDS);
}
