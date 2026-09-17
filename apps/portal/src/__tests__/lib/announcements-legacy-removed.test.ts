/**
 * The old announcement system is gone from the portal, and stays gone.
 *
 * Until Sep 16 2026 the portal read `feature_announcements` (the table the
 * booking app shows to RENTERS) through `hooks/use-feature-announcements.ts`,
 * showed it in `components/dashboard-v2/announcement-carousel.tsx` with dev-only
 * preview rows (`PREVIEW_ANNOUNCEMENTS`, the "DEPOSIT HOLDS" card), a per-browser
 * localStorage dismissal (`portal:announcements:dismissed`) and a detail dialog
 * that injected unsanitised `body_html`. Its replacement reads portal-only
 * tables through `get_portal_announcements` (components/announcements/).
 *
 * This guard replaces `__tests__/hooks/feature-announcements-gate.test.ts`,
 * which pinned the old hook's source. Its still-valid guarantees (`retry: false`,
 * no `if (error) throw error` swallowed into render, the canary gate on the
 * feature read) now belong to the new hook's own tests.
 *
 * WHAT IS SCANNED: every .ts/.tsx under apps/portal/src, except the generated
 * `integrations/supabase/types.ts` (it describes the whole database, including
 * the old table the booking app still uses) and `__tests__/**`. Comments are
 * stripped first with the TypeScript printer, so a sentence explaining the
 * history (lib/safe-href.ts, hooks/use-setup-checklist.ts) is not a failure,
 * while a string literal or an import is.
 *
 * NOT in the list on purpose: `SEVERITY_LABEL` and `DetailDialog`, which
 * notifications, settings-v2, turo-bridge and the calendar define for
 * themselves.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

const SRC_ROOT = resolve(__dirname, '../..');

const FORBIDDEN = [
  'feature_announcements',
  'use-feature-announcements',
  'announcement-carousel',
  'announcement-detail-dialog',
  'PREVIEW_ANNOUNCEMENTS',
  'portal:announcements:dismissed',
  'body_html',
] as const;

function listSources(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = relative(SRC_ROOT, full).split('\\').join('/');
    if (entry.isDirectory()) {
      if (rel === '__tests__' || entry.name === 'node_modules') continue;
      listSources(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && rel !== 'integrations/supabase/types.ts') {
      out.push(full);
    }
  }
  return out;
}

/** Source text with every comment removed (JSX-aware; string literals kept). */
function withoutComments(text: string, fileName: string): string {
  const kind = fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, false, kind);
  return ts.createPrinter({ removeComments: true }).printFile(sourceFile);
}

describe('the legacy portal announcement system', () => {
  it('strips comments but not code (positive control for the scan below)', () => {
    const sample = [
      "// feature_announcements in a line comment",
      "/* PREVIEW_ANNOUNCEMENTS in a block comment */",
      "const kept = 'body_html';",
      "export const View = () => <div>{/* announcement-carousel */}text</div>;",
    ].join('\n');
    const code = withoutComments(sample, 'sample.tsx');
    expect(code).not.toContain('feature_announcements');
    expect(code).not.toContain('PREVIEW_ANNOUNCEMENTS');
    expect(code).not.toContain('announcement-carousel');
    expect(code).toContain('body_html');
  });

  it('has no file left from it', () => {
    for (const rel of [
      'hooks/use-feature-announcements.ts',
      'components/dashboard-v2/announcement-carousel.tsx',
      'components/dashboard-v2/announcement-detail-dialog.tsx',
    ]) {
      expect(() => readFileSync(join(SRC_ROOT, rel)), rel).toThrow();
    }
  });

  it('left its still-valid guarantees to the replacement read (hooks/use-portal-announcements.ts)', () => {
    // Carried over from feature-announcements-gate.test.ts. Behaviour is pinned in
    // use-portal-announcements.test.tsx; this keeps the source-level promises the
    // old guard made, so deleting that file lost nothing.
    const file = join(SRC_ROOT, 'hooks/use-portal-announcements.ts');
    const code = withoutComments(readFileSync(file, 'utf8'), file);
    // A read that cannot succeed must not cost four round trips per mount.
    expect(code).toContain('retry: false');
    // A failure is logged, never a bare rethrow into render.
    expect(code).not.toMatch(/if \(error\) throw error;/);
    expect(code).toContain('console.warn(');
    // Feature rows stay behind the canary, keyed on the slug (never the id).
    expect(code).toMatch(/isLeanTenant\(tenant\?\.slug\)/);
    expect(code).not.toMatch(/isLeanTenant\(tenant\?\.id/);
  });

  it('is not referenced by any portal code', () => {
    const files = listSources(SRC_ROOT);
    // Sanity: the walk really covered the app.
    expect(files.length).toBeGreaterThan(500);
    expect(files.some((f) => f.endsWith('components/announcements/feature-announcement-deck.tsx'))).toBe(true);

    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      // Cheap pre-filter: only files that mention a needle at all are parsed.
      if (!FORBIDDEN.some((needle) => text.includes(needle))) continue;
      const code = withoutComments(text, file);
      for (const needle of FORBIDDEN) {
        if (code.includes(needle)) hits.push(`${relative(SRC_ROOT, file)}: ${needle}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
