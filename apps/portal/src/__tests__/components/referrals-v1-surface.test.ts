/**
 * Referrals looks the same for a v1 tenant as it does for a v2 one.
 *
 * The page opened to every tenant on 30 Sep 2026. Sharing the component is not
 * the same as sharing the look: `.v2-theme` is a block of CSS custom properties
 * the root layout puts on <body> for gated tenants ONLY, and every shadcn
 * primitive on this page reads them. A v1 tenant therefore got this page's
 * structure painted in v1's tokens — flat white, no lavender wash — which is
 * what "I can't see any changes" turned out to mean.
 *
 * Custom properties inherit, so the class is hung on a wrapper instead. What is
 * pinned here is the shape of that wrapper, because two details are easy to get
 * wrong and neither fails loudly:
 *
 *  1. `.v2-theme .bg-app-gradient` is a DESCENDANT selector. Both classes on one
 *     element paints no wash at all.
 *  2. A v2 tenant already has `.v2-theme` on <body> and the gradient on the
 *     sidebar wrapper. A second `.bg-app-gradient` paints its fixed ::before
 *     twice and darkens the page.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const src = readFileSync(
  resolve(__dirname, '../../components/referrals/referrals-view.tsx'),
  'utf8',
);
const code = src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

describe('the referrals page carries the v2 surface for v1 tenants', () => {
  it('wraps the page in .v2-theme', () => {
    expect(code).toMatch(/className="v2-theme"/);
  });

  it('paints the wash on a DESCENDANT, not the same element', () => {
    // `.v2-theme .bg-app-gradient` needs an ancestor; one element matches nothing.
    expect(code).not.toMatch(/className="[^"]*v2-theme[^"]*bg-app-gradient/);
    expect(code).toMatch(/bg-background bg-app-gradient/);
  });

  it('does NOT double the wash for a tenant already on the v2 theme', () => {
    expect(code).toMatch(/const v2Theme = useV2\("theme"\)/);
    expect(code).toMatch(/if \(v2Theme\) return content;/);
  });

  it('still renders the same content either way', () => {
    // One `content`, used by both branches — the structure cannot drift.
    expect(code).toMatch(/const content = \(/);
    expect(code).toMatch(/\{content\}/);
  });
});
