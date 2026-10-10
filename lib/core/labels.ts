import { distanceToOutline, pointInPolygon } from "./geometry.ts";
import type { Point } from "./site.ts";

/**
 * Where and how big to write a room's name: at the roomiest spot inside the
 * shape (works for L- and U-shaped halls, where the middle may be outside),
 * sized to the space there, on one line, two lines, or turned sideways for
 * tall narrow rooms — whichever fits the biggest text.
 */
export interface RoomLabel {
  x: number;
  y: number;
  fontSize: number;
  lines: string[];
  vertical: boolean;
}

/** Average character width as a fraction of font size (bold sans). */
const CHAR = 0.6;

const spotCache = new WeakMap<Point[], { x: number; y: number; w: number; h: number }>();

export function roomLabel(name: string, polygon: Point[], maxSize: number): RoomLabel {
  const spot = labelSpot(polygon);
  const options: RoomLabel[] = [];
  const fit = (lines: string[], vertical: boolean) => {
    const long = Math.max(...lines.map((l) => l.length), 3);
    const [along, across] = vertical ? [spot.h, spot.w] : [spot.w, spot.h];
    const size = Math.min(maxSize, (along * 0.88) / (long * CHAR), (across * 0.8) / (lines.length * 1.15));
    options.push({ x: spot.x, y: spot.y, fontSize: size, lines, vertical });
  };
  fit([name], false);
  const words = name.split(" ");
  if (words.length > 1) {
    // Split where the two lines come out most even.
    let best = 1;
    for (let i = 1; i < words.length; i++)
      if (Math.abs(words.slice(0, i).join(" ").length - words.slice(i).join(" ").length) < Math.abs(words.slice(0, best).join(" ").length - words.slice(best).join(" ").length)) best = i;
    fit([words.slice(0, best).join(" "), words.slice(best).join(" ")], false);
  }
  if (spot.h > spot.w * 1.6) fit([name], true);
  // Prefer plain horizontal text unless another option is clearly bigger.
  return options.reduce((a, b) => (b.fontSize > a.fontSize * 1.15 ? b : a));
}

/** The point inside the shape furthest from its walls, and the open width/height through it. */
export function labelSpot(polygon: Point[]) {
  const cached = spotCache.get(polygon);
  if (cached) return cached;
  const p = innermostPoint(polygon);
  const xs = crossings(polygon, p, "x");
  const ys = crossings(polygon, p, "y");
  const left = Math.max(...xs.filter((v) => v <= p.x), -Infinity), right = Math.min(...xs.filter((v) => v >= p.x), Infinity);
  const top = Math.max(...ys.filter((v) => v <= p.y), -Infinity), bottom = Math.min(...ys.filter((v) => v >= p.y), Infinity);
  const spot = Number.isFinite(left + right + top + bottom)
    ? { x: (left + right) / 2, y: (top + bottom) / 2, w: right - left, h: bottom - top }
    : { x: p.x, y: p.y, w: 1, h: 1 };
  // Re-centring along both axes can step outside an odd shape; then stay on the innermost point.
  if (!pointInPolygon(spot, polygon)) (spot.x = p.x), (spot.y = p.y);
  spotCache.set(polygon, spot);
  return spot;
}

/** Where a horizontal ("x") or vertical ("y") line through p crosses the outline. */
function crossings(poly: Point[], p: Point, axis: "x" | "y"): number[] {
  const out: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if (axis === "x") {
      if (a.y > p.y !== b.y > p.y) out.push(a.x + ((p.y - a.y) * (b.x - a.x)) / (b.y - a.y));
    } else if (a.x > p.x !== b.x > p.x) out.push(a.y + ((p.x - a.x) * (b.y - a.y)) / (b.x - a.x));
  }
  return out;
}

/** "Pole of inaccessibility": refine a grid toward the point furthest inside the shape. */
export function innermostPoint(poly: Point[]): Point {
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  const minX = Math.min(...xs), minY = Math.min(...ys), maxX = Math.max(...xs), maxY = Math.max(...ys);
  const depth = (p: Point) => (pointInPolygon(p, poly) ? 1 : -1) * distanceToOutline(p, poly).distance;
  const precision = Math.max(maxX - minX, maxY - minY) / 200;
  let cell = Math.min(maxX - minX, maxY - minY) / 2 || 1;
  type Cell = { x: number; y: number; h: number; d: number; max: number };
  const make = (x: number, y: number, h: number): Cell => {
    const d = depth({ x, y });
    return { x, y, h, d, max: d + h * Math.SQRT2 };
  };
  let queue: Cell[] = [];
  for (let x = minX; x < maxX; x += cell * 2) for (let y = minY; y < maxY; y += cell * 2) queue.push(make(x + cell, y + cell, cell));
  let best = make((minX + maxX) / 2, (minY + maxY) / 2, 0);
  for (const c of queue) if (c.d > best.d) best = c;
  let guard = 0;
  while (queue.length && guard++ < 5000) {
    queue.sort((a, b) => b.max - a.max);
    const c = queue.shift()!;
    if (c.d > best.d) best = c;
    if (c.max - best.d <= precision) continue;
    cell = c.h / 2;
    queue.push(make(c.x - cell, c.y - cell, cell), make(c.x + cell, c.y - cell, cell), make(c.x - cell, c.y + cell, cell), make(c.x + cell, c.y + cell, cell));
  }
  return { x: best.x, y: best.y };
}
