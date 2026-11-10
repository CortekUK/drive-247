/**
 * Turns an operator's uploaded logo into one ink colour on transparent, in the browser,
 * so every logo on the operator map (including one uploaded this morning) sits in the
 * same quiet style, painted through a CSS mask in the page's ink in either theme.
 *
 *   1. A solid background (most of the edge one opaque colour) is removed.
 *   2. Light-on-dark marks are flipped, so the mark is always the ink.
 *   3. Contrast is stretched so the strongest part of the mark reads solid.
 *   4. The result is trimmed to the mark and handed back as a blob URL.
 *
 * Logos come from our own public storage, which allows cross-origin reads, so the
 * canvas can read the pixels. Anything that fails answers null and the map shows the
 * operator's name instead.
 */

const MAX_SIDE = 560;
const CONCURRENT = 3;

const done = new Map<string, Promise<string | null>>();
const waiting: (() => void)[] = [];
let running = 0;

function schedule(task: () => Promise<string | null>): Promise<string | null> {
  return new Promise((resolve) => {
    const run = () => {
      running += 1;
      task()
        .catch(() => null)
        .then(resolve)
        .finally(() => {
          running -= 1;
          waiting.shift()?.();
        });
    };
    if (running < CONCURRENT) run();
    else waiting.push(run);
  });
}

/** The ink version of a logo, made once per page load however often it is asked for. */
export function inkMask(src: string): Promise<string | null> {
  let job = done.get(src);
  if (!job) {
    job = schedule(() => build(src));
    done.set(src, job);
  }
  return job;
}

const luminance = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

function median(values: number[]): number {
  values.sort((a, b) => a - b);
  return values[values.length >> 1] ?? 0;
}

async function build(src: string): Promise<string | null> {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.decoding = "async";
  image.src = src;
  await image.decode();

  const scale = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
  const W = Math.max(1, Math.round(image.naturalWidth * scale));
  const H = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, W, H);
  const pixels = ctx.getImageData(0, 0, W, H);
  const d = pixels.data;

  // 1. Is there a solid background? Look at the edge.
  const reds: number[] = [];
  const greens: number[] = [];
  const blues: number[] = [];
  let edge = 0;
  const sample = (x: number, y: number) => {
    const i = (y * W + x) * 4;
    edge += 1;
    if (d[i + 3] > 200) {
      reds.push(d[i]);
      greens.push(d[i + 1]);
      blues.push(d[i + 2]);
    }
  };
  for (let x = 0; x < W; x += 1) {
    sample(x, 0);
    sample(x, H - 1);
  }
  for (let y = 0; y < H; y += 1) {
    sample(0, y);
    sample(W - 1, y);
  }
  const background = reds.length > 0.6 * edge ? [median(reds), median(greens), median(blues)] : null;
  const backgroundLight = background ? luminance(background[0], background[1], background[2]) : null;

  // 2. Each pixel's coverage once the background is gone, and its lightness.
  const count = W * H;
  const alpha = new Float32Array(count);
  const light = new Float32Array(count);
  let sumAlpha = 0;
  let sumLight = 0;
  for (let p = 0, i = 0; p < count; p += 1, i += 4) {
    let a = d[i + 3] / 255;
    if (background) {
      const distance = Math.hypot(d[i] - background[0], d[i + 1] - background[1], d[i + 2] - background[2]);
      a *= Math.min(1, Math.max(0, (distance - 28) / 60));
    }
    const l = luminance(d[i], d[i + 1], d[i + 2]);
    alpha[p] = a;
    light[p] = l;
    sumAlpha += a;
    sumLight += a * l;
  }
  if (sumAlpha === 0) return null;
  const lightMark = backgroundLight !== null ? backgroundLight < 0.35 : sumLight / sumAlpha > 0.62;

  // 3. Stretch: the 90th percentile of the mark's ink becomes solid.
  const histogram = new Uint32Array(256);
  let solid = 0;
  for (let p = 0; p < count; p += 1) {
    if (alpha[p] <= 0.5) continue;
    const ink = lightMark ? light[p] : 1 - light[p];
    histogram[Math.min(255, Math.floor(ink * 255))] += 1;
    solid += 1;
  }
  let high = 1;
  if (solid) {
    let seen = 0;
    for (let bin = 0; bin < 256; bin += 1) {
      seen += histogram[bin];
      if (seen >= solid * 0.9) {
        high = bin / 255;
        break;
      }
    }
  }
  const low = 0.06;
  const span = Math.max(0.05, high - low);

  // 4. Write the ink and find the mark's edges.
  let minX = W;
  let minY = H;
  let maxX = -1;
  let maxY = -1;
  for (let p = 0, i = 0; p < count; p += 1, i += 4) {
    const ink = lightMark ? light[p] : 1 - light[p];
    const v = Math.pow(alpha[p] * Math.min(1, Math.max(0, (ink - low) / span)), 0.85);
    const a = v > 0.02 ? Math.round(v * 255) : 0;
    d[i] = 0;
    d[i + 1] = 0;
    d[i + 2] = 0;
    d[i + 3] = a;
    if (a > 12) {
      const x = p % W;
      const y = (p - x) / W;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;

  // A mark that fills most of its own box is a photo or a solid badge, not a logo:
  // in one ink it reads as a dark block, so the name is shown instead.
  let filled = 0;
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) filled += d[(y * W + x) * 4 + 3];
  }
  if (filled / 255 / ((maxX - minX + 1) * (maxY - minY + 1)) > 0.55) return null;

  ctx.putImageData(pixels, 0, 0);

  const trimmed = document.createElement("canvas");
  trimmed.width = maxX - minX + 1;
  trimmed.height = maxY - minY + 1;
  trimmed.getContext("2d")?.drawImage(canvas, minX, minY, trimmed.width, trimmed.height, 0, 0, trimmed.width, trimmed.height);
  const blob = await new Promise<Blob | null>((resolve) => trimmed.toBlob(resolve, "image/png"));
  return blob ? URL.createObjectURL(blob) : null;
}
