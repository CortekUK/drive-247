/**
 * agreements-v2 edge function: the things that must stay in step with code it
 * cannot import, and the deploy-shape rules, checked from source. No network.
 *
 *  - validation.ts is the portal's lib/agreements-v2/validation.ts, byte for
 *    byte, except for one line (the OPERATOR_SIGNATURE_ATTR import, inlined);
 *  - isMissingTableError and the credit alert match the portal's copies;
 *  - the v2 gate is IMPORTED (trax-support's lib/v2.ts compile) and the lean
 *    BoldSign gate is IMPORTED (_shared/lean-tenants.ts), never re-typed;
 *  - every module but index.ts is pure (no Deno, no URL imports), so this
 *    suite really is running the function's logic;
 *  - verify_jwt stays ON: the function is not in config.toml's opt-out list;
 *  - the {{@sig1}} {{@init1}} {{@date1}} tags are never stripped or rewritten.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { isMissingTableError } from '@fn/agreements-v2/tables.ts';
import { isMissingTableError as portalIsMissingTableError } from '../../../apps/portal/src/lib/agreements-v2/status';
import { OPERATOR_SIGNATURE_ATTR } from '../../../apps/portal/src/lib/agreements-v2/types';
import { isV2 } from '@fn/trax-support/support/portal-v2.generated.js';

const ROOT = resolve(__dirname, '../../..');
const FN = resolve(ROOT, 'supabase/functions/agreements-v2');
const read = (path: string) => readFileSync(resolve(ROOT, path), 'utf8');

describe('validation.ts mirrors the portal file', () => {
  const IMPORT_LINE = "import { OPERATOR_SIGNATURE_ATTR } from '@/lib/agreements-v2/types';";
  const INLINE_LINE = "const OPERATOR_SIGNATURE_ATTR = 'data-operator-signature';";

  it('is the portal file with exactly the one import line inlined', () => {
    const portal = read('apps/portal/src/lib/agreements-v2/validation.ts');
    const mine = read('supabase/functions/agreements-v2/validation.ts');
    expect(portal.split(IMPORT_LINE)).toHaveLength(2);
    const expected = portal.replace(IMPORT_LINE, INLINE_LINE);
    expect(mine.endsWith(expected)).toBe(true);
    // What comes before is only the mirror banner: comment lines and a blank.
    const banner = mine.slice(0, mine.length - expected.length);
    for (const line of banner.split('\n').filter(Boolean)) expect(line.startsWith('//')).toBe(true);
    expect(mine).not.toMatch(/^import /m);
  });

  it('inlines the same attribute the portal types declare', () => {
    expect(OPERATOR_SIGNATURE_ATTR).toBe('data-operator-signature');
  });
});

describe('copies that must agree with the portal', () => {
  it('isMissingTableError answers as the portal does', () => {
    const cases = [
      null,
      undefined,
      { code: '42P01', message: 'relation "individual_agreements_v2" does not exist' },
      { code: 'PGRST205', message: 'Could not find the table' },
      { code: '42703', message: 'column x does not exist' },
      { code: null, message: 'Could not find the table public.x in the schema cache' },
      { message: 'relation "x" does not exist' },
      { message: 'column "y" does not exist' },
      { code: '23505', message: 'duplicate key' },
      { message: '' },
    ];
    for (const c of cases) expect(isMissingTableError(c as any)).toBe(portalIsMissingTableError(c as any));
  });

  it('the credit alert is the portal helper, function body byte for byte', () => {
    const from = (text: string) => text.slice(text.indexOf('export async function raiseEsignCreditAlert('));
    const portal = read('apps/portal/src/lib/esign-credit-alert.ts');
    const mine = read('supabase/functions/agreements-v2/credit-alert.ts');
    expect(from(mine)).toBe(from(portal));
    const head = (text: string) => text.slice(text.indexOf('const RULE_CODE'), text.indexOf('// Typed loosely'));
    expect(head(mine)).toBe(head(portal));
  });
});

describe('the gates are imported, not re-typed', () => {
  const auth = read('supabase/functions/agreements-v2/auth.ts');

  it('imports isV2 from the lib/v2.ts compile, and the lean BoldSign gate from _shared', () => {
    expect(auth).toContain("import { isV2 } from '../trax-support/support/portal-v2.generated.js';");
    expect(auth).toContain("import { readTenantOnV2ById, resolveBoldSignMode } from '../_shared/lean-tenants.ts';");
    expect(auth).toMatch(/isV2\('agreements', tenant\.slug, onV2\)/);
    expect(auth).toMatch(/resolveBoldSignMode\(tenant\.boldsign_mode, tenant\.slug, onV2\)/);
    expect(auth).not.toMatch(/'northwind'/);
  });

  it('the compiled gate has agreements for northwind only (plus portal_experience = v2)', () => {
    expect(isV2('agreements', 'northwind')).toBe(true);
    expect(isV2('agreements', 'goniko')).toBe(false);
    expect(isV2('agreements', 'goniko', true)).toBe(true);
    expect(isV2('agreements', null, true)).toBe(false);
    expect(read('apps/portal/src/lib/v2.ts')).toMatch(/agreements: \[NORTHWIND\]/);
  });
});

describe('deploy shape', () => {
  const modules = readdirSync(FN).filter((f) => /\.(ts|js)$/.test(f) && f !== 'index.ts');

  it('every module but index.ts is pure: no Deno, no URL or npm imports', () => {
    expect(modules.sort()).toEqual(['auth.ts', 'core.ts', 'credit-alert.ts', 'pdf-input.ts', 'provider.ts', 'tables.ts', 'validation.ts']);
    for (const f of modules) {
      // Code only: the comments may well mention Deno.serve.
      const text = readFileSync(resolve(FN, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      expect(text, f).not.toMatch(/\bDeno\./);
      expect(text, f).not.toMatch(/from ['"](https?:|npm:|jsr:)/);
    }
  });

  it('index.ts is the thin wrapper: the same client import as other functions, the shared CORS helpers', () => {
    const index = read('supabase/functions/agreements-v2/index.ts');
    const trax = read('supabase/functions/trax-support/index.ts');
    const clientImport = "import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';";
    expect(trax).toContain(clientImport);
    expect(index).toContain(clientImport);
    expect(index).toContain("import { handleCors, jsonResponse } from '../_shared/cors.ts';");
    expect(index).toMatch(/Deno\.env\.get/);
    expect(index).toMatch(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(index).toMatch(/handleCors\(req\)/);
    expect(index.split('\n').length).toBeLessThan(70);
  });

  it('keeps verify_jwt ON: not listed in supabase/config.toml', () => {
    const config = read('supabase/config.toml');
    expect(config).not.toMatch(/\[functions\.agreements-v2\]/);
  });

  it('never strips or rewrites the signer tags', () => {
    for (const f of ['core.ts', 'provider.ts']) {
      const text = readFileSync(resolve(FN, f), 'utf8');
      expect(text, f).not.toMatch(/\.replace\([^)]*@(sig1|init1|date1)/);
      expect(text, f).not.toMatch(/contentHtml\s*=\s*[^=]/);
    }
  });
});
