/**
 * The tenant's brand colour as the three HSL parameters `.pv2` reads
 * (`--brand-h/s/l`, see the portal v2 block in styles/site.css). Same idea as
 * the operator portal v2: neutral surfaces, one accent that follows the brand.
 *
 * Returns null for anything unusable — unparsable, or so close to black, white
 * or grey that it would paint grey buttons — and the `.pv2` defaults (the v2
 * indigo) stand.
 */
export function brandHslVars(hex: string | null | undefined): Record<string, string> | null {
  if (!hex) return null;
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;

  const value = parseInt(match[1], 16);
  const r = ((value >> 16) & 255) / 255;
  const g = ((value >> 8) & 255) / 255;
  const b = (value & 255) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));

  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }

  if (s < 0.15 || l < 0.12 || l > 0.88) return null;

  return {
    '--brand-h': `${Math.round(h)}`,
    '--brand-s': `${Math.round(s * 100)}%`,
    '--brand-l': `${Math.round(l * 100)}%`,
  };
}
