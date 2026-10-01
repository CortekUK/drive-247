/**
 * Placeholder rows for <AutoSkeleton>. While a list loads, the page renders
 * these through its real components, so the skeleton has the page's exact
 * shape. The values are never seen (the text is transparent), only their
 * lengths are: names get name-sized bars, amounts get amount-sized bars.
 *
 * Deterministic: row 3 is always the same shape, so the skeleton does not
 * jitter between renders or between the server and the browser.
 */

export type SkeletonFaker = {
  /** A few words, `min`–`max` of them, e.g. a name or a model. */
  text: (min?: number, max?: number) => string;
  /** One word of `min`–`max` letters, e.g. a plate or a reference. */
  word: (min?: number, max?: number) => string;
  /** A whole number in [min, max]. */
  int: (min?: number, max?: number) => number;
  /** An amount, e.g. 1234.5. */
  money: (min?: number, max?: number) => number;
  /** An ISO date `daysAgo` days before a fixed day (negative = ahead). */
  date: (daysAgo?: number) => string;
  /** One of the options, e.g. a status the row renders. */
  pick: <T>(options: readonly T[]) => T;
  /** A stable id for this row, `skeleton-<i>`. */
  id: string;
};

/** The fixed "today" placeholder dates are counted from. */
const EPOCH = Date.UTC(2026, 0, 15, 10, 0, 0);

function random(seed: number) {
  let t = seed + 0x6d2b79f5;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

export function skeletonFaker(i: number): SkeletonFaker {
  const next = random(i * 7919 + 17);
  const int = (min = 0, max = 100) => min + Math.floor(next() * (max - min + 1));
  const word = (min = 4, max = 9) => "x".repeat(int(min, max));
  return {
    text: (min = 1, max = 3) => Array.from({ length: int(min, max) }, () => word(3, 9)).join(" "),
    word,
    int,
    money: (min = 40, max = 4000) => Math.round((min + next() * (max - min)) * 100) / 100,
    date: (daysAgo = int(0, 60)) => new Date(EPOCH - daysAgo * 86_400_000).toISOString(),
    pick: (options) => options[int(0, options.length - 1)],
    id: `skeleton-${i}`,
  };
}

/** `count` placeholder rows, each built by `make`. */
export function skeletonRows<T>(count: number, make: (f: SkeletonFaker, i: number) => T): T[] {
  return Array.from({ length: count }, (_, i) => make(skeletonFaker(i), i));
}
