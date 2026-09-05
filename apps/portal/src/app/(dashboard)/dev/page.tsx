'use client';

import { notFound } from 'next/navigation';

import { DevPageBody } from '@/components/dev/dev-page';

/**
 * `/dev` — the developer page. Local only, northwind only. See
 * `components/dev/dev-page.tsx` for the page and the other three gates.
 *
 * GATE 1 of 4 — the build gate, and nothing else in this file.
 *
 * No hooks, no state, no other statements. Next substitutes
 * `process.env.NODE_ENV` with the literal at build time, so in a production
 * bundle this reads `if ("production" === "development") return …;
 * notFound();` — a constant condition. The minifier drops the dead branch,
 * `DevPageBody` is then referenced from nowhere, and it is tree-shaken out
 * along with its reset actions and the Supabase delete. Even a typed URL on
 * production reaches only the not-found page.
 *
 * THE ORDER OF THE TWO LINES IS LOAD-BEARING. The obvious shape —
 * `if (!dev) notFound(); return <DevPageBody />` — does NOT fold: no
 * minifier knows that `notFound()` never returns, so the `return` after it
 * stays reachable and the body stays in the production bundle (proved with
 * esbuild, which is what caught it). Returning the body inside the
 * development branch and falling through to `notFound()` is the shape that
 * actually disappears. Do not "tidy" it back.
 */
export default function DevPage() {
  if (process.env.NODE_ENV === 'development') return <DevPageBody />;
  notFound();
}
