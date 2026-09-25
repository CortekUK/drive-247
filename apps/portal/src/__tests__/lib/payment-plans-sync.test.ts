/**
 * The portal's payment-plans core is a generated mirror, and must stay one.
 *
 * The canonical engine lives in supabase/functions/_shared/payment-plans/ (the
 * cron and the webhook run it in Deno). The portal runs the SAME files — the
 * plan form's live preview, the plan card's math, the /dev simulator — from
 * src/lib/payment-plans/, written by `node scripts/sync-payment-plans.mjs`.
 *
 * If the two ever differ, the preview can show a schedule the server will not
 * store, and the simulator can pass a scenario the cron would fail — the
 * evidence would be about a different program. So this asserts the two
 * directories hold the same file names with the same bytes. A failure here
 * means: edit the canonical file, then re-run the sync. Never edit the mirror.
 */

import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const repoRoot = resolve(__dirname, '../../../../..');
const canonicalDir = join(repoRoot, 'supabase/functions/_shared/payment-plans');
const mirrorDir = join(repoRoot, 'apps/portal/src/lib/payment-plans');

const tsFiles = (dir: string) =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isFile() && e.name.endsWith('.ts'))
        .map((e) => e.name)
        .sort()
    : [];

describe('payment-plans portal mirror', () => {
  const canonical = tsFiles(canonicalDir);
  const mirror = tsFiles(mirrorDir);

  it('has canonical files to mirror', () => {
    // An empty canonical dir would make the equality below pass vacuously.
    expect(canonical).toContain('types.ts');
    expect(canonical).toContain('engine.ts');
  });

  it('mirrors exactly the canonical file names — nothing missing, nothing stale', () => {
    expect(mirror).toEqual(canonical);
  });

  it.each(canonical)('%s is byte-identical to its canonical copy', (name) => {
    const source = readFileSync(join(canonicalDir, name));
    const target = join(mirrorDir, name);
    expect(existsSync(target), `${name} missing from the mirror — run node scripts/sync-payment-plans.mjs`).toBe(true);
    const copy = readFileSync(target);
    expect(
      copy.equals(source),
      `${name} differs from supabase/functions/_shared/payment-plans/${name} — edit the canonical file and run node scripts/sync-payment-plans.mjs`,
    ).toBe(true);
  });
});
