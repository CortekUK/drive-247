/**
 * Squarified treemap (Bruls, Huizing and van Wijk): splits a rectangle into one tile
 * per item, each tile's area in proportion to its weight, keeping tiles as close to
 * square as the weights allow. The tiles cover the rectangle exactly, edge to edge.
 *
 * Items are laid out in the order given; pass them largest first for the squarest
 * result. Pure: no DOM, so it runs the same on the server and in the browser.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Node<T> {
  item: T;
  area: number;
}

/** The worst (largest) aspect ratio a row would have, laid along a side of length `side`. */
function worst<T>(row: readonly Node<T>[], side: number): number {
  let sum = 0;
  let max = 0;
  let min = Infinity;
  for (const node of row) {
    sum += node.area;
    if (node.area > max) max = node.area;
    if (node.area < min) min = node.area;
  }
  const s2 = sum * sum;
  const side2 = side * side;
  return Math.max((side2 * max) / s2, s2 / (side2 * min));
}

/** Lays one row along the shorter side of `box`; returns what is left of the box. */
function place<T>(row: readonly Node<T>[], box: Box, out: (T & { rect: Box })[]): Box {
  const sum = row.reduce((total, node) => total + node.area, 0);
  if (box.w >= box.h) {
    // A column down the left edge.
    const width = box.h > 0 ? sum / box.h : 0;
    let y = box.y;
    for (const node of row) {
      const height = width > 0 ? node.area / width : 0;
      out.push({ ...node.item, rect: { x: box.x, y, w: width, h: height } });
      y += height;
    }
    return { x: box.x + width, y: box.y, w: box.w - width, h: box.h };
  }
  // A row along the top edge.
  const height = box.w > 0 ? sum / box.w : 0;
  let x = box.x;
  for (const node of row) {
    const width = height > 0 ? node.area / height : 0;
    out.push({ ...node.item, rect: { x, y: box.y, w: width, h: height } });
    x += width;
  }
  return { x: box.x, y: box.y + height, w: box.w, h: box.h - height };
}

export function squarify<T extends { weight: number }>(items: readonly T[], box: Box): (T & { rect: Box })[] {
  const positive = items.filter((item) => item.weight > 0);
  const total = positive.reduce((sum, item) => sum + item.weight, 0);
  if (!positive.length || total <= 0 || box.w <= 0 || box.h <= 0) return [];

  const scale = (box.w * box.h) / total;
  const nodes = positive.map((item) => ({ item, area: item.weight * scale }));
  const out: (T & { rect: Box })[] = [];

  let rest = { ...box };
  let row: Node<T>[] = [];
  let i = 0;
  while (i < nodes.length) {
    const side = Math.min(rest.w, rest.h);
    const next = nodes[i];
    if (row.length === 0 || worst([...row, next], side) <= worst(row, side)) {
      row.push(next);
      i += 1;
    } else {
      rest = place(row, rest, out);
      row = [];
    }
  }
  if (row.length) place(row, rest, out);
  return out;
}
