import fs from 'node:fs';
import path from 'node:path';

/**
 * Template 3's line-up: five cars seen straight from the front. The centre car
 * is forward and largest; each pair outside it stands a step further back and
 * a step smaller, and the outermost pair runs off the screen edges.
 *
 * The images in apps/booking/public/template-3/cars/ are transparent
 * cut-outs (WebP with alpha). A photo on a white or busy background has to be
 * cut out first: blend modes cannot hide a backdrop here, because the hero's
 * animated layers isolate each car. `w`/`h` are the files' pixel sizes.
 *
 * Server-only. A car whose file is missing comes back null and is left out,
 * because asking next/image for a missing file makes the dev server render
 * its not-found page and fail (a 500 with "Invalid hook call").
 */

export interface T3Car {
  src: string;
  alt: string;
  w: number;
  h: number;
}

export type T3LineUp = Record<keyof typeof LINE_UP, T3Car | null>;

const LINE_UP = {
  farLeft: { src: '/template-3/cars/mercedes-gle-black.webp', alt: 'Black Mercedes GLE, front view', w: 1691, h: 1342 },
  left: { src: '/template-3/cars/bmw-6-black.webp', alt: 'Black BMW 6 Series, front view', w: 1609, h: 1121 },
  centre: { src: '/template-3/cars/red-supercar.webp', alt: 'Red sports car, front view', w: 706, h: 485 },
  right: { src: '/template-3/cars/datsun-blue.webp', alt: 'Blue classic Datsun, front view', w: 1655, h: 1175 },
  farRight: { src: '/template-3/cars/bentley-black.webp', alt: 'Black Bentley Continental, front view', w: 1668, h: 1158 },
} satisfies Record<string, T3Car>;

const exists = (src: string) => fs.existsSync(path.join(process.cwd(), 'public', src));

export function loadT3Cars(): T3LineUp {
  return Object.fromEntries(
    Object.entries(LINE_UP).map(([slot, car]) => [slot, exists(car.src) ? car : null]),
  ) as T3LineUp;
}
