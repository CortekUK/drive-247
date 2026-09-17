/**
 * The v2 portal takes its whole palette from one brand hex: styles/v2-theme.css
 * derives every brand-coloured token from --brand-h / --brand-s / --brand-l,
 * and `v2BrandVars` is what turns the saved colour into those three (plus the
 * few extras CSS cannot work out). Every expected value below was worked by
 * hand; the working is in the comments.
 */
import { describe, expect, it } from 'vitest';

import { hexToHsl, hslToHex, v2BrandVars } from '@/lib/appearance/color';

describe('hexToHsl', () => {
  it('#442DD7, the v2 default indigo, is 248 68% 51%', () => {
    // r=68 g=45 b=215. max=b=215, min=g=45, delta=170.
    // l = (215+45)/510 = 0.5098 -> 51
    // s = (170/255) / (1 - |2*0.5098 - 1|) = 0.66667 / 0.98039 = 0.68 -> 68
    // h = ((r-g)/delta + 4) * 60 = (23/170 + 4) * 60 = 248.1 -> 248
    expect(hexToHsl('#442DD7')).toEqual({ h: 248, s: 68, l: 51 });
  });

  it('#0F766E (teal) is 175 77% 26%', () => {
    // r=15 g=118 b=110. max=g=118, min=r=15, delta=103.
    // l = (118+15)/510 = 0.26078 -> 26
    // s = (103/255) / (1 - |2*0.26078 - 1|) = 0.40392 / 0.52157 = 0.77444 -> 77
    // h = ((b-r)/delta + 2) * 60 = (95/103 + 2) * 60 = 175.34 -> 175
    expect(hexToHsl('#0F766E')).toEqual({ h: 175, s: 77, l: 26 });
  });

  it('rejects what is not a hex', () => {
    expect(hexToHsl('teal')).toBeNull();
    expect(hexToHsl('#12')).toBeNull();
  });
});

describe('hslToHex', () => {
  it('round-trips the default indigo', () => {
    // C = (1 - |1.02 - 1|) * 0.68 = 0.6664, m = 0.51 - 0.3332 = 0.1768,
    // h' = 4.1333 -> X = C * 0.1333 = 0.08885, (X, 0, C) + m
    // = (0.26565, 0.1768, 0.8432) * 255 = (67.7, 45.1, 215.0) -> #442DD7
    expect(hslToHex(248, 68, 51)).toBe('#442DD7');
  });

  it('clamps and wraps like CSS does', () => {
    expect(hslToHex(0, 0, 100)).toBe('#FFFFFF');
    expect(hslToHex(120, -10, 50)).toBe('#808080'); // saturation below 0 is grey
    expect(hslToHex(-120, 100, 50)).toBe(hslToHex(240, 100, 50));
  });
});

describe('v2BrandVars', () => {
  it('the default indigo writes exactly the stylesheet defaults and nothing else', () => {
    // Button text: #442DD7 has luminance 0.0801, so white is 1.05/0.1301 = 8.07:1
    // and #0A0A0A is 0.1301/0.0530 = 2.45:1 -> white, the default, not written.
    // Link on white is that same 8.07:1 -> no deeper link lightness.
    // Dark primary hsl(246 61% 42%) also takes white -> not written.
    expect(v2BrandVars('#442DD7')).toEqual({
      '--brand-h': '248',
      '--brand-s': '68%',
      '--brand-l': '51%',
    });
  });

  it('teal: dark text on the brighter dark-mode primary only', () => {
    // Light primary #0F766E: luminance 0.1419 -> white 5.47:1, black 3.62:1 -> white.
    // Link on white 5.47:1 >= 4.5 -> no --brand-link-l.
    // Dark primary hsl(173 70% 42%) = #20B6A5: luminance 0.3648 -> white
    // 1.05/0.4148 = 2.53:1, black 0.4148/0.0530 = 7.82:1 -> near-black text.
    expect(v2BrandVars('#0F766E')).toEqual({
      '--brand-h': '175',
      '--brand-s': '77%',
      '--brand-l': '26%',
      '--brand-fg-dark': '0 0% 3.9%',
    });
  });

  it('a pale brand gets a readable link lightness and dark button text', () => {
    // #FDE68A: r=253 g=230 b=138, max=r, delta=115.
    //   h = (92/115) * 60 = 48, l = 391/510 = 0.7667 -> 77,
    //   s = 0.45098 / (1 - |1.5333 - 1|) = 0.9664 -> 97.
    // Link: hsl(48 97% L) on white needs luminance <= 0.1833.
    //   L=29 -> #927502 (146,117,2): luminance 0.1884 -> 4.41:1, fails
    //   L=28 -> #8D7102 (141,113,2): luminance 0.1748 -> 4.67:1, passes -> 28%
    // Light primary is the pale yellow itself (luminance ~0.79) -> black 15.8:1.
    // Dark primary hsl(46 90% 42%) = (203,159,11): luminance 0.3752 ->
    //   white 2.47:1, black 8.02:1 -> near-black.
    expect(v2BrandVars('#FDE68A')).toEqual({
      '--brand-h': '48',
      '--brand-s': '97%',
      '--brand-l': '77%',
      '--brand-link-l': '28%',
      '--brand-fg': '0 0% 3.9%',
      '--brand-fg-dark': '0 0% 3.9%',
    });
  });

  it("near-black (the canary's saved colour) leaves the default indigo standing", () => {
    // #020303: max=g=3, min=r=2, delta=1. l = 5/510 = 0.0098 -> 1, under 12.
    // Painting that made every button black and the page wash colourless.
    expect(v2BrandVars('#020303')).toBeNull();
  });

  it('near-white and grey brands leave the default indigo standing too', () => {
    // #FAFAFA: grey, s = 0 -> under 15 (and l = 250/255 = 98 -> over 92).
    expect(v2BrandVars('#FAFAFA')).toBeNull();
    // #808080: s = 0, l = 50 -> fails on saturation alone.
    expect(v2BrandVars('#808080')).toBeNull();
    // #7A8288: max=b=136, min=r=122, delta=14. l = 258/510 = 0.506 -> 51,
    // s = (14/255) / (1 - |1.012 - 1|) = 0.0549 / 0.988 = 0.0556 -> 6 -> under 15.
    expect(v2BrandVars('#7A8288')).toBeNull();
  });

  it('a deep slate brand like the Graphite preset still themes the portal', () => {
    // #1E293B: r=30 g=41 b=59. max=59, min=30, delta=29.
    // l = 89/510 = 0.1745 -> 17 (>= 12)
    // s = (29/255) / (1 - |0.349 - 1|) = 0.11373 / 0.34902 = 0.3258 -> 33 (>= 15)
    // h = ((r-g)/delta + 4) * 60 = (-11/29 + 4) * 60 = 217.2 -> 217
    const vars = v2BrandVars('#1E293B');
    expect(vars).not.toBeNull();
    expect(vars?.['--brand-s']).toBe('33%');
    expect(vars?.['--brand-l']).toBe('17%');
  });

  it('returns null for no colour or a bad one, so the stylesheet default stands', () => {
    expect(v2BrandVars(null)).toBeNull();
    expect(v2BrandVars(undefined)).toBeNull();
    expect(v2BrandVars('')).toBeNull();
    expect(v2BrandVars('not-a-colour')).toBeNull();
  });
});
