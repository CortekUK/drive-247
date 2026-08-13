/**
 * Wordmark / monogram generator.
 *
 * For the tenant who has no logo file at all — today they get an empty gap in
 * the sidebar, which makes a real business look unfinished on day one.
 *
 * Deliberately NOT an AI image generator. Generated pictorial logos are
 * generic, cost money per attempt, can unintentionally echo an existing
 * trademark, and "I don't like any of these" turns into a support thread. A
 * typographic mark built from the business name is instant, free, carries no
 * legal exposure, and always looks composed.
 *
 * Output is SVG, which matters for three reasons: crisp at any size, a couple
 * of KB, and recolourable — so the same mark can be re-rendered for dark mode
 * instead of needing a second upload.
 */

export type MonogramStyleId =
  | 'circle-solid'
  | 'circle-outline'
  | 'squircle'
  | 'square-split'
  | 'wordmark'
  | 'stacked';

export interface MonogramStyle {
  id: MonogramStyleId;
  name: string;
}

export const MONOGRAM_STYLES: MonogramStyle[] = [
  { id: 'circle-solid', name: 'Circle' },
  { id: 'circle-outline', name: 'Outline' },
  { id: 'squircle', name: 'Squircle' },
  { id: 'square-split', name: 'Split' },
  { id: 'wordmark', name: 'Wordmark' },
  { id: 'stacked', name: 'Stacked' },
];

/**
 * Initials from a business name.
 *
 * Legal and structural words are dropped so "East Peak Rentals LLC" gives EP
 * rather than EPRL — two letters read as a mark, four read as an acronym
 * nobody can parse at sidebar size.
 */
export function initialsFrom(name: string): string {
  const NOISE = new Set([
    'llc', 'ltd', 'inc', 'co', 'corp', 'company', 'limited', 'plc', 'llp',
    'the', 'and', '&', 'of', 'group', 'holdings',
    'rental', 'rentals', 'rent', 'car', 'cars', 'auto', 'autos', 'motors',
    'hire', 'leasing', 'lease', 'fleet', 'transport', 'transportation',
  ]);

  const words = name
    .trim()
    .split(/[\s\-_]+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);

  const meaningful = words.filter((w) => !NOISE.has(w.toLowerCase()));
  const source = meaningful.length > 0 ? meaningful : words;

  if (source.length === 0) return '?';
  if (source.length === 1) {
    // Single word: two letters read better than one at small sizes.
    return source[0].slice(0, 2).toUpperCase();
  }
  return (source[0][0] + source[1][0]).toUpperCase();
}

/** The display name used by the wordmark styles — trimmed, never truncated mid-word. */
export function wordmarkText(name: string, maxChars = 18): string {
  const clean = name.trim().replace(/\s+/g, ' ');
  if (clean.length <= maxChars) return clean;
  const cut = clean.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 6 ? cut.slice(0, lastSpace) : cut).trim();
}

export interface MonogramOptions {
  style: MonogramStyleId;
  name: string;
  /** Brand colour — the mark is tinted with it so it matches the chosen theme. */
  color: string;
  /** Colour the mark will sit against, so contrast can be handled sensibly. */
  onColor?: string;
}

/**
 * Build the SVG source for a mark.
 *
 * Fonts are referenced by family name rather than embedded: these render inside
 * the app (where Manrope is already loaded) and are rasterised to PNG before
 * upload, so the glyphs are baked in and never depend on the viewer's fonts.
 */
export function buildMonogramSvg({
  style,
  name,
  color,
  onColor = '#FFFFFF',
}: MonogramOptions): string {
  const initials = initialsFrom(name);
  const text = wordmarkText(name);
  const font =
    "Manrope, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

  switch (style) {
    case 'circle-solid':
      return svg(
        256,
        256,
        `<circle cx="128" cy="128" r="120" fill="${color}"/>
         <text x="128" y="128" font-family="${font}" font-size="104" font-weight="700"
               fill="${onColor}" text-anchor="middle" dominant-baseline="central"
               letter-spacing="-2">${esc(initials)}</text>`
      );

    case 'circle-outline':
      return svg(
        256,
        256,
        `<circle cx="128" cy="128" r="114" fill="none" stroke="${color}" stroke-width="12"/>
         <text x="128" y="128" font-family="${font}" font-size="100" font-weight="600"
               fill="${color}" text-anchor="middle" dominant-baseline="central"
               letter-spacing="-2">${esc(initials)}</text>`
      );

    case 'squircle':
      return svg(
        256,
        256,
        `<rect x="8" y="8" width="240" height="240" rx="64" fill="${color}"/>
         <text x="128" y="128" font-family="${font}" font-size="104" font-weight="700"
               fill="${onColor}" text-anchor="middle" dominant-baseline="central"
               letter-spacing="-2">${esc(initials)}</text>`
      );

    case 'square-split': {
      const [a, b] = [initials[0] ?? '?', initials[1] ?? ''];
      return svg(
        256,
        256,
        `<rect x="8" y="8" width="240" height="240" rx="28" fill="${color}"/>
         <rect x="8" y="8" width="120" height="240" fill="${color}"/>
         <rect x="128" y="8" width="120" height="240" rx="0" fill="${onColor}" opacity="0.14"/>
         <text x="68" y="128" font-family="${font}" font-size="92" font-weight="700"
               fill="${onColor}" text-anchor="middle" dominant-baseline="central">${esc(a)}</text>
         <text x="188" y="128" font-family="${font}" font-size="92" font-weight="300"
               fill="${onColor}" text-anchor="middle" dominant-baseline="central">${esc(b)}</text>`
      );
    }

    case 'wordmark':
      return svg(
        640,
        160,
        `<rect x="0" y="0" width="640" height="160" fill="none"/>
         <rect x="16" y="52" width="8" height="56" rx="4" fill="${color}"/>
         <text x="44" y="80" font-family="${font}" font-size="52" font-weight="700"
               fill="${color}" dominant-baseline="central" letter-spacing="-1.5">${esc(text)}</text>`
      );

    case 'stacked': {
      const words = text.split(' ');
      const top = words[0] ?? text;
      const bottom = words.slice(1).join(' ');
      return svg(
        512,
        256,
        `<text x="256" y="${bottom ? 100 : 128}" font-family="${font}" font-size="64" font-weight="800"
               fill="${color}" text-anchor="middle" dominant-baseline="central"
               letter-spacing="-2">${esc(top)}</text>
         ${
           bottom
             ? `<text x="256" y="160" font-family="${font}" font-size="34" font-weight="400"
                      fill="${color}" text-anchor="middle" dominant-baseline="central"
                      letter-spacing="6" opacity="0.75">${esc(bottom.toUpperCase())}</text>`
             : ''
         }`
      );
    }
  }
}

/**
 * Rasterise generated SVG to a PNG blob for upload.
 *
 * Rendered at 2x for retina sidebars. Fonts are baked in during rasterisation,
 * so the stored asset never depends on the viewer having Manrope installed —
 * which is exactly what would break if the raw SVG were uploaded instead.
 */
export async function monogramToPng(svgSource: string, scale = 2): Promise<Blob | null> {
  const { width, height } = readViewBox(svgSource);

  const blob = new Blob([svgSource], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  try {
    const img = await new Promise<HTMLImageElement | null>((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => resolve(null);
      image.src = url;
    });
    if (!img) return null;

    const canvas = document.createElement('canvas');
    canvas.width = width * scale;
    canvas.height = height * scale;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;

    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>((resolve) =>
      canvas.toBlob((b) => resolve(b), 'image/png')
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

/* ------------------------------------------------------------------ */

function svg(width: number, height: number, body: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${body}</svg>`;
}

function readViewBox(source: string): { width: number; height: number } {
  const match = source.match(/viewBox="0 0 (\d+) (\d+)"/);
  return match
    ? { width: Number(match[1]), height: Number(match[2]) }
    : { width: 256, height: 256 };
}

function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
