/**
 * Per-FIELD merge of CMS content over a typed fallback.
 *
 * Why per field and not "CMS if present, else fallback": a section row is one
 * JSONB blob an operator edits in a form. Half-filling that form is normal —
 * they set a headline and leave the trust line blank, or the portal writes a
 * key with `""` because the input was never touched (the seeded
 * `home_hero.background_image` is exactly that). Swapping the whole object
 * would blank every field they did not fill; swapping field by field keeps the
 * shipped copy underneath and only replaces what they actually wrote.
 *
 * The rules, and the reason for each:
 *
 *   undefined / null  -> fallback. The key is absent or cleared.
 *   ""  (any blank)   -> fallback. The portal writes empty strings for
 *                        untouched inputs, so "" means "unset", never
 *                        "render nothing".
 *   []                -> fallback. Same reasoning for list sections.
 *   object            -> recurse, so a nested `contact_info.phone.number` can
 *                        be set without wiping `availability`.
 *   array (non-empty) -> replaces wholesale. Merging arrays element-wise would
 *                        resurrect an item the operator deleted.
 *   number / boolean  -> replaces. `0` and `false` are real values here.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mergeValue(fallback: unknown, incoming: unknown): unknown {
  if (incoming === undefined || incoming === null) return fallback;

  if (typeof incoming === "string") {
    return incoming.trim() === "" ? fallback : incoming;
  }

  if (Array.isArray(incoming)) {
    return incoming.length === 0 ? fallback : incoming;
  }

  if (isRecord(incoming)) {
    if (!isRecord(fallback)) return incoming;
    const merged: Record<string, unknown> = { ...fallback };
    for (const [key, value] of Object.entries(incoming)) {
      merged[key] = key in fallback ? mergeValue(fallback[key], value) : value;
    }
    return merged;
  }

  return incoming;
}

/**
 * Merge one section's stored JSON over its typed default.
 *
 * The single cast is the boundary between `Json` (what PostgREST returns, which
 * TypeScript cannot know the shape of) and `T` (what the section renders). It
 * is sound in the direction that matters: every key of `T` is present because
 * the fallback supplies it, and a key whose stored value has the wrong runtime
 * type is the operator's data being wrong, not this function lying — the
 * sections read only strings and arrays and tolerate both.
 */
export function mergeContent<T>(fallback: T, incoming: unknown): T {
  return mergeValue(fallback, incoming) as T;
}

/** Pull one section out of a page map, merged over its default. */
export function getSection<T>(
  sections: Readonly<Record<string, unknown>> | null | undefined,
  key: string,
  fallback: T,
): T {
  if (!sections) return fallback;
  return mergeContent(fallback, sections[key]);
}

/* ══════════════════════════════════════════════════════════════════════════
 * Partial lists
 *
 * `mergeValue` replaces a non-empty array WHOLESALE, and it has to: merging
 * element-wise would resurrect a row the operator deleted. That is correct for
 * a list saved through a form, which always writes every row and every field.
 *
 * The visual editor does not write whole lists. It writes ONE field of ONE row
 * — `home.safety_verification.cards.2.label` — and the write path builds the
 * path it was given and nothing else. So the first in-place edit to a section
 * that has no stored row yet produces:
 *
 *     { cards: [ <hole>, <hole>, { label: "Brake wear" } ] }
 *
 * which, replacing the default wholesale, is a three-item list whose first two
 * items are null and whose third has no `value` and no `footnote`. The section
 * then reads `item.footnote.trim()` and the page 500s — on the operator's own
 * home page, one keystroke after they first touched it.
 *
 * These two put the shipped values back under the holes: index for index,
 * because index for index is exactly what the operator was looking at when
 * they typed. Rows past the end of the defaults are filled from the SHAPE of
 * the first default rather than its content, so adding a fourth reason does not
 * inherit the third one's words.
 * ═════════════════════════════════════════════════════════════════════════ */

/** Every key of `shape`, blanked — "" for text, 0 for numbers, [] for lists. */
function blankLike<T extends object>(shape: T): T {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(shape)) {
    out[key] =
      typeof value === "number" ? 0 : typeof value === "boolean" ? false : Array.isArray(value) ? [] : "";
  }
  return out as T;
}

/**
 * A stored list of objects, laid over its defaults row by row.
 *
 * A blank field falls through to the default for the same reason a blank
 * string does in `mergeValue`: the portal writes "" for anything untouched.
 */
export function completeRows<T extends object>(rows: unknown, defaults: readonly T[]): T[] {
  if (!Array.isArray(rows)) return [...defaults];
  return rows.map((row, index) => {
    const base = defaults[index] ?? (defaults[0] ? blankLike(defaults[0]) : ({} as T));
    if (!isRecord(row)) return { ...base };
    const merged: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [key, value] of Object.entries(row)) {
      if (value === null || value === undefined) continue;
      if (typeof value === "string" && value.trim() === "") continue;
      merged[key] = value;
    }
    return merged as T;
  });
}

/** The same, for a plain `string[]` — the marquee, the trust points. */
export function completeLines(lines: unknown, defaults: readonly string[]): string[] {
  if (!Array.isArray(lines)) return [...defaults];
  return lines.map((line, index) =>
    typeof line === "string" && line.trim() !== "" ? line : (defaults[index] ?? ""),
  );
}
