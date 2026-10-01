/**
 * /api/esign/signing-redirect — the link in the renter's email.
 *
 * WHY THIS CHANGED. Sending a replacement agreement REVOKES the previous one,
 * so every earlier email the renter is holding points at a document BoldSign
 * will not accept a signature on. The route still minted a signing link for it,
 * so the renter tapped "Review and Sign", landed on a dead BoldSign page, and
 * told the operator "it doesn't work" — whose fix is to send again, revoking
 * one more link and adding one more identically-titled email to the inbox.
 *
 * Moore Luxe, week of 25 Sep 2026: 36 documents across 13 rentals, 16 revoked,
 * 5 ever signed, one renter sent SEVEN. That is the loop this closes.
 *
 * So the id in the email now means "which rental, which kind of agreement".
 * Whatever the renter taps, old or new, they get the document that is live.
 *
 * WHAT MUST NOT HAPPEN: a renter sent to the wrong document. A rental can hold
 * a live original AND a live extension at once, so the search is scoped to the
 * same agreement_type — the last test here is the one that matters most.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://project.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key';
process.env.BOLDSIGN_LIVE_API_KEY = 'live-key';
process.env.BOLDSIGN_TEST_API_KEY = 'test-key';

interface Agreement {
  id: string;
  document_id: string | null;
  document_status: string;
  agreement_type: string;
  created_at: string;
  rental_id: string;
  tenant_id: string;
  boldsign_mode: string;
}

const state = vi.hoisted(() => ({ agreements: [] as Agreement[] }));

vi.mock('@supabase/supabase-js', () => {
  const resolve = (table: string, f: Record<string, unknown>, mode: 'single' | 'many') => {
    if (table === 'rental_agreements') {
      if (mode === 'single') {
        return { data: state.agreements.find((a) => a.id === f.id) ?? null, error: null };
      }
      const rows = state.agreements
        .filter((a) => a.rental_id === f.rental_id && a.agreement_type === f.agreement_type)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      return { data: rows, error: null };
    }
    if (table === 'rentals') {
      return { data: { customers: { email: 'renter@example.com' } }, error: null };
    }
    if (table === 'tenants') {
      return { data: { boldsign_mode: 'live', slug: 'moore-luxe-rentals' }, error: null };
    }
    return { data: null, error: null };
  };

  const query = (table: string) => {
    const filters: Record<string, unknown> = {};
    const api: Record<string, unknown> = {
      select: () => api,
      eq: (col: string, val: unknown) => {
        filters[col] = val;
        return api;
      },
      order: () => Promise.resolve(resolve(table, filters, 'many')),
      single: () => Promise.resolve(resolve(table, filters, 'single')),
      maybeSingle: () => Promise.resolve(resolve(table, filters, 'single')),
    };
    return api;
  };

  return { createClient: () => ({ from: (table: string) => query(table) }) };
});

vi.mock('@/lib/portal-tenant', () => ({ readTenantOnV2ById: async () => false }));

const { GET } = await import('@/app/api/esign/signing-redirect/route');
const { NextRequest } = await import('next/server');

/** The document id BoldSign was asked for, which is the whole question here. */
let askedFor: string | null = null;

beforeEach(() => {
  askedFor = null;
  state.agreements = [];
  vi.stubGlobal('fetch', async (url: string) => {
    askedFor = new URL(String(url)).searchParams.get('documentId');
    return {
      ok: true,
      json: async () => ({ signLink: `https://app.boldsign.com/document/sign/${askedFor}` }),
      text: async () => '',
      status: 200,
    } as unknown as Response;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const agreement = (over: Partial<Agreement>): Agreement => ({
  id: 'a1',
  document_id: 'doc-a1',
  document_status: 'sent',
  agreement_type: 'original',
  created_at: '2026-09-29T03:00:00Z',
  rental_id: 'rental-1',
  tenant_id: 'tenant-1',
  boldsign_mode: 'live',
  ...over,
});

const tap = (id: string) =>
  GET(new NextRequest(`https://moore-luxe-rentals.portal.drive-247.com/api/esign/signing-redirect?id=${id}`));

describe('an old email still reaches the live document', () => {
  it('redirects a revoked link to the newest live agreement', async () => {
    state.agreements = [
      agreement({ id: 'old', document_id: 'doc-old', document_status: 'voided', created_at: '2026-09-29T03:00:00Z' }),
      agreement({ id: 'new', document_id: 'doc-new', document_status: 'sent', created_at: '2026-09-30T15:19:00Z' }),
    ];

    const res = await tap('old');

    expect(res.status).toBe(307);
    expect(askedFor).toBe('doc-new');
  });

  it('uses the newest live one when several are live', async () => {
    state.agreements = [
      agreement({ id: 'a', document_id: 'doc-a', created_at: '2026-09-29T03:45:00Z' }),
      agreement({ id: 'b', document_id: 'doc-b', created_at: '2026-09-29T04:53:00Z' }),
    ];

    await tap('a');

    expect(askedFor).toBe('doc-b');
  });

  it('leaves a single live agreement exactly as it was', async () => {
    state.agreements = [agreement({ id: 'only', document_id: 'doc-only' })];

    const res = await tap('only');

    expect(res.status).toBe(307);
    expect(askedFor).toBe('doc-only');
  });
});

describe('when there is nothing left to sign, it says so', () => {
  it('tells a renter who already signed that they are done', async () => {
    state.agreements = [
      agreement({ id: 'old', document_status: 'voided', created_at: '2026-09-29T03:00:00Z' }),
      agreement({ id: 'done', document_status: 'completed', created_at: '2026-09-30T15:19:00Z' }),
    ];

    const res = await tap('old');

    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Already signed');
    // Nothing is asked of BoldSign: there is no link to mint.
    expect(askedFor).toBeNull();
  });

  it('explains a replaced link instead of dropping them on an error', async () => {
    // Every version revoked and none signed: only the operator can fix this,
    // so the page says to ask them rather than showing a 502.
    state.agreements = [
      agreement({ id: 'old', document_status: 'voided', created_at: '2026-09-29T03:00:00Z' }),
      agreement({ id: 'newer', document_status: 'voided', created_at: '2026-09-29T19:06:00Z' }),
    ];

    const res = await tap('old');

    expect(res.status).toBe(410);
    const body = await res.text();
    expect(body).toContain('This link has been replaced');
    expect(body).toContain('send it again');
    expect(askedFor).toBeNull();
  });
});

describe('it never sends a renter to the wrong document', () => {
  it('will not answer an extension link with the original', async () => {
    // Both are live and both are legitimate. Signing the original when the
    // email was about the extension is a worse outcome than a dead link.
    state.agreements = [
      agreement({ id: 'orig', document_id: 'doc-orig', agreement_type: 'original', created_at: '2026-09-29T03:00:00Z' }),
      agreement({
        id: 'ext',
        document_id: 'doc-ext',
        agreement_type: 'extension',
        document_status: 'voided',
        created_at: '2026-09-30T10:00:00Z',
      }),
    ];

    const res = await tap('ext');

    expect(res.status).toBe(410);
    expect(askedFor).toBeNull();
  });

  it('keeps the two types independent when both are live', async () => {
    state.agreements = [
      agreement({ id: 'orig', document_id: 'doc-orig', agreement_type: 'original', created_at: '2026-09-29T03:00:00Z' }),
      agreement({ id: 'ext', document_id: 'doc-ext', agreement_type: 'extension', created_at: '2026-09-30T10:00:00Z' }),
    ];

    await tap('orig');
    expect(askedFor).toBe('doc-orig');

    await tap('ext');
    expect(askedFor).toBe('doc-ext');
  });
});
