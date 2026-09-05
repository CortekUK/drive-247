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
