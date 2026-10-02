import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/*
 * No citation list may contain a hole.
 *
 * The orchestrator builds a turn's `sources` by looking every cited id up in a
 * Map and used to assert the hit with `!`. One branch — get_integration_status —
 * pushed its evidence directly and never registered its source, so the lookup
 * missed, `undefined` went into the array, JSON.stringify wrote it out as `null`,
 * and that null was both sent to the browser and stored in the conversation.
 * Reopening that conversation from history then replaced the whole portal with
 * the error page, because the citation line read `source.title` off it.
 *
 * Two invariants hold it shut: the lookups drop misses instead of asserting them
 * away, and every source attached to evidence is registered in the same breath.
 */
const ORCHESTRATOR = resolve(
  __dirname,
  '../../../../../supabase/functions/trax-support/support/orchestrator.ts',
);
const source = readFileSync(ORCHESTRATOR, 'utf8');

describe('a cited source that cannot be resolved is dropped, not asserted', () => {
  it('never non-null-asserts a sources or actions lookup', () => {
    // `sources.get(id)!` is the exact shape that produced the null.
    const asserted = [...source.matchAll(/(?:sources|actions)\.get\([^)]*\)!/g)].map((m) => m[0]);
    expect(asserted).toEqual([]);
  });

  it('still builds a citation list, by dropping the misses', () => {
    expect(source).toMatch(/const shownSources=.*flatMap\(id=>\{const s=sources\.get\(id\);return s\?\[s\]:\[\];\}\)/);
  });
});

describe('every source attached to evidence is registered for citation', () => {
  it('the integration branch registers its own source', () => {
    // It is outside the tool path that does this for every other branch, so it
    // has to do it itself — this is the line whose absence was the bug.
    expect(source).toContain('sources.set(integrationSource.id,integrationSource)');
    const push = source.indexOf('evidence.push({status:\'verified\',observedAt:status.observedAt');
    expect(push).toBeGreaterThan(source.indexOf('sources.set(integrationSource.id,integrationSource)'));
  });

  it('attaches the registered object itself, so the two cannot drift', () => {
    expect(source).toContain('sources:[integrationSource],');
  });
});
