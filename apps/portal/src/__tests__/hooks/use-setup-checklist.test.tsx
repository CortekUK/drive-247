/**
 * The setup checklist reader (hooks/use-setup-checklist.ts): how
 * `video_duration_seconds` and the two links come off a PostgREST row.
 *
 * Every row below is untrusted input, and each expected value is worked out by
 * hand from the parsing rule in the comment beside it. The rule, as the brief
 * states it: a finite, positive, whole number of seconds up to 14400 (4 x 60 x
 * 60 = four hours), given as a number or a numeric string — anything else is
 * `null`, and so is any length on a row without a (safe) video.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const env = vi.hoisted(() => ({
  slug: 'northwind' as string | null,
  rows: [] as unknown[],
  calls: [] as { table: string; select?: string }[],
}));

vi.mock('@/contexts/TenantContext', () => ({
  useTenant: () => ({
    tenant: env.slug ? { id: 'tenant-1', slug: env.slug } : null,
    tenantSlug: env.slug,
  }),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      const call: { table: string; select?: string } = { table };
      env.calls.push(call);
      const query: Record<string, unknown> = {};
      query.select = (cols: string) => {
        call.select = cols;
        return query;
      };
      query.eq = () => query;
      query.order = () => Promise.resolve({ data: env.rows, error: null });
      return query;
    },
  },
}));

import { useSetupChecklist } from '@/hooks/use-setup-checklist';
import { SETUP_CHECKLIST_ITEMS } from '@/lib/setup-checklist';

// `children` is typed loosely on purpose: apps/portal carries a nested React 18
// copy of @types/react beside the root React 19 one, and the two ReactNode
// types do not assign to each other under tsc.
function wrapper({ children }: { children?: any }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const row = (key: string, fields: Record<string, unknown>) => ({
  item_key: key,
  title: key.toUpperCase(),
  description: '',
  video_url: '/explainers/x.mp4',
  video_duration_seconds: null,
  guide_url: '/settings?tab=payg',
  ...fields,
});

beforeEach(() => {
  env.slug = 'northwind';
  env.rows = [];
  env.calls = [];
});

describe('useSetupChecklist — video_duration_seconds', () => {
  it('asks for the column by name', async () => {
    env.rows = [row('a', { video_duration_seconds: 125 })];
    const { result } = renderHook(() => useSetupChecklist(), { wrapper });
    await waitFor(() => expect(result.current.isFallback).toBe(false));
    expect(env.calls).toHaveLength(1);
    expect(env.calls[0].table).toBe('setup_checklist_items');
    expect(env.calls[0].select?.split(',')).toContain('video_duration_seconds');
  });

  it('keeps a valid length and turns everything else into null', async () => {
    env.rows = [
      row('number', { video_duration_seconds: 125 }), // a whole number: 125
      row('string', { video_duration_seconds: '90' }), // numeric string "90": 90
      row('padded', { video_duration_seconds: ' 45 ' }), // surrounding spaces: 45
      row('point-zero', { video_duration_seconds: '60.0' }), // "60.0" is whole: 60
      row('one', { video_duration_seconds: 1 }), // the smallest length: 1
      row('ceiling', { video_duration_seconds: 14400 }), // exactly four hours: 14400
      row('over', { video_duration_seconds: 14401 }), // one past four hours: null
      row('zero', { video_duration_seconds: 0 }), // not positive: null
      row('negative', { video_duration_seconds: -5 }), // not positive: null
      row('fraction', { video_duration_seconds: 90.5 }), // not whole: null
      row('fraction-string', { video_duration_seconds: '90.5' }), // not whole: null
      row('clock', { video_duration_seconds: '1:30' }), // m:ss is the admin form's job: null
      row('word', { video_duration_seconds: 'ninety' }), // not a number: null
      row('infinite', { video_duration_seconds: Infinity }), // not finite: null
      row('nan', { video_duration_seconds: Number.NaN }), // not finite: null
      row('boolean', { video_duration_seconds: true }), // not a number: null
      row('missing', {}), // NULL in the column: null
      // A length with no video to belong to: null, whatever the number.
      row('no-video', { video_url: null, video_duration_seconds: 60 }),
      row('blank-video', { video_url: '   ', video_duration_seconds: 60 }),
    ];
    const { result } = renderHook(() => useSetupChecklist(), { wrapper });
    await waitFor(() => expect(result.current.isFallback).toBe(false));

    expect(result.current.items.map((i) => [i.key, i.videoDurationSeconds])).toEqual([
      ['number', 125],
      ['string', 90],
      ['padded', 45],
      ['point-zero', 60],
      ['one', 1],
      ['ceiling', 14400],
      ['over', null],
      ['zero', null],
      ['negative', null],
      ['fraction', null],
      ['fraction-string', null],
      ['clock', null],
      ['word', null],
      ['infinite', null],
      ['nan', null],
      ['boolean', null],
      ['missing', null],
      ['no-video', null],
      ['blank-video', null],
    ]);
  });

  it('treats an unsafe link as absent, and drops a row left with no link at all', async () => {
    env.rows = [
      // Unsafe video, safe guide: the row stays, with no video and so no length.
      row('bad-video', {
        video_url: 'javascript:alert(1)',
        video_duration_seconds: 60,
        guide_url: '/settings?tab=payg',
      }),
      // Safe video, unsafe guide: the row stays, with no guide.
      row('bad-guide', {
        video_url: 'https://www.loom.com/embed/abc',
        video_duration_seconds: 30,
        guide_url: 'javascript:alert(1)',
      }),
      // Both unsafe: nothing behind it, so the row is dropped.
      row('both-bad', { video_url: 'javascript:alert(1)', guide_url: '//evil.example' }),
      // Both are paths whose dot segments collapse to "//evil.example" — "."
      // is dropped, and ".." removes "settings" — so both count as unsafe and
      // the row is dropped too.
      row('collapsing', {
        video_url: '/.//evil.example/x.mp4',
        guide_url: '/settings/..//evil.example',
      }),
      // A safe path is kept RESOLVED: "settings", "..", "rentals" -> "/rentals".
      row('resolved', { video_url: null, guide_url: '/settings/../rentals' }),
    ];
    const { result } = renderHook(() => useSetupChecklist(), { wrapper });
    await waitFor(() => expect(result.current.isFallback).toBe(false));

    expect(result.current.items).toEqual([
      {
        key: 'bad-video',
        title: 'BAD-VIDEO',
        description: '',
        videoUrl: null,
        videoDurationSeconds: null,
        guideUrl: '/settings?tab=payg',
      },
      {
        key: 'bad-guide',
        title: 'BAD-GUIDE',
        description: '',
        videoUrl: 'https://www.loom.com/embed/abc',
        videoDurationSeconds: 30,
        guideUrl: null,
      },
      {
        key: 'resolved',
        title: 'RESOLVED',
        description: '',
        videoUrl: null,
        videoDurationSeconds: null,
        guideUrl: '/rentals',
      },
    ]);
  });

  it('reads nothing for any other tenant, and hands back the compiled list', () => {
    env.slug = 'some-other-tenant';
    const { result } = renderHook(() => useSetupChecklist(), { wrapper });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.items).toBe(SETUP_CHECKLIST_ITEMS);
    expect(env.calls).toHaveLength(0);
  });
});
