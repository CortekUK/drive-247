/**
 * A 2D canvas for jsdom, which has none.
 *
 * `lib/appearance/logo.ts` draws the initials mark that stands in for a tenant's
 * square icon on a canvas, and under jsdom `getContext('2d')` returns null and
 * `toDataURL()` returns `"data:,"` — so without this the only path a test can
 * reach is the one where the mark cannot be drawn at all.
 *
 * The stub records what was drawn and hands back a data URL built from that
 * record, so a test can read the colours and the letters straight out of the
 * string it asserts on, and two different marks are never the same string. It
 * starts `data:image/png` because that is what the drawing code checks for
 * before it trusts what came back.
 */

export interface DrawnMark {
  size: number;
  /** Every `fillStyle` set, in order: the plate first, then the letters. */
  fills: string[];
  fonts: string[];
  texts: string[];
  /** True once a rounded rectangle was traced (native `roundRect` or the long way). */
  rounded: boolean;
  radius: number | null;
  align: string;
  baseline: string;
}

export interface CanvasStub {
  /** Every mark drawn since the stub was installed, oldest first. */
  drawn: DrawnMark[];
  /** The data URL the stub would return for a given drawing. */
  urlFor: (mark: DrawnMark) => string;
  restore: () => void;
}

function describe(mark: DrawnMark): string {
  return [mark.size, mark.fills.join('/'), mark.fonts.join('/'), mark.texts.join('')].join('|');
}

/**
 * Install the stub for the rest of the test. Call `restore()` afterwards (or
 * let the returned handle be used in an `afterEach`).
 */
export function installCanvas(): CanvasStub {
  const drawn: DrawnMark[] = [];
  const proto = HTMLCanvasElement.prototype as unknown as Record<string, unknown>;
  const original = {
    getContext: Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'getContext'),
    toDataURL: Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, 'toDataURL'),
  };

  const marks = new WeakMap<HTMLCanvasElement, DrawnMark>();

  proto.getContext = function (this: HTMLCanvasElement, kind: string) {
    if (kind !== '2d') return null;
    const mark: DrawnMark = {
      size: this.width,
      fills: [],
      fonts: [],
      texts: [],
      rounded: false,
      radius: null,
      align: '',
      baseline: '',
    };
    marks.set(this, mark);
    drawn.push(mark);
    const ctx = {
      set fillStyle(value: string) {
        mark.fills.push(value);
      },
      get fillStyle() {
        return mark.fills[mark.fills.length - 1] ?? '';
      },
      set font(value: string) {
        mark.fonts.push(value);
      },
      get font() {
        return mark.fonts[mark.fonts.length - 1] ?? '';
      },
      set textAlign(value: string) {
        mark.align = value;
      },
      get textAlign() {
        return mark.align;
      },
      set textBaseline(value: string) {
        mark.baseline = value;
      },
      get textBaseline() {
        return mark.baseline;
      },
      beginPath() {},
      closePath() {},
      moveTo() {},
      lineTo() {},
      quadraticCurveTo() {},
      roundRect(_x: number, _y: number, _w: number, _h: number, r: number) {
        mark.rounded = true;
        mark.radius = r;
      },
      fill() {},
      fillText(text: string) {
        mark.texts.push(text);
      },
    };
    return ctx as unknown as CanvasRenderingContext2D;
  };

  proto.toDataURL = function (this: HTMLCanvasElement) {
    const mark = marks.get(this);
    return mark ? `data:image/png;drawn=${encodeURIComponent(describe(mark))}` : 'data:,';
  };

  return {
    drawn,
    urlFor: (mark) => `data:image/png;drawn=${encodeURIComponent(describe(mark))}`,
    restore: () => {
      if (original.getContext) Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', original.getContext);
      else delete proto.getContext;
      if (original.toDataURL) Object.defineProperty(HTMLCanvasElement.prototype, 'toDataURL', original.toDataURL);
      else delete proto.toDataURL;
    },
  };
}

/**
 * The exact data URL `brandMarkDataUrl` produces under the stub for one
 * drawing, worked out from the drawing code's own numbers rather than read back
 * out of it: a `size` box, the plate in `background`, then the letters in
 * `foreground` at `600 round(size × 0.375)px <stack>`.
 */
export function expectedMarkUrl({
  initials,
  background,
  foreground,
  fontFamily,
  size = 64,
}: {
  initials: string;
  background: string;
  foreground: string;
  fontFamily: string;
  size?: number;
}): string {
  const description = [
    size,
    [background, foreground].join('/'),
    `600 ${Math.round(size * 0.375)}px ${fontFamily}`,
    initials,
  ].join('|');
  return `data:image/png;drawn=${encodeURIComponent(description)}`;
}
