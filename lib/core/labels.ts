import { distanceToOutline, pointInPolygon } from "./geometry.ts";
import type { Point } from "./site.ts";

/**
 * Where and how big to write a room's name. The whole text box must fit inside
 * the room's walls: we try spots across the room and one line / two lines /
 * sideways, and keep whichever allows the biggest text.
 */
export interface RoomLabel {
  x: number;
  y: number;
  fontSize: number;
  lines: string[];
  vertical: boolean;
}

/** Average character width and line height, as fractions of font size (bold sans). */
const CHAR = 0.6;
const LINE = 1.15;

const cache = new Map<string, RoomLabel>();

export function roomLabel(name: string, polygon: Point[], maxSize: number): RoomLabel {
  const key = `${name}|${maxSize.toFixed(2)}|${polygon.map((p) => `${p.x},${p.y}`).join(" ")}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const label = fitLabel(name, polygon, maxSize);
  if (cache.size > 2000) cache.clear();
  cache.set(key, label);
  return label;
}

function layouts(name: string): { lines: string[]; vertical: boolean }[] {
  const out = [{ lines: [name], vertical: false }];
  const words = name.split(" ");
  if (words.length > 1) {
    let best = 1;
    const diff = (i: number) => Math.abs(words.slice(0, i).join(" ").length - words.slice(i).join(" ").length);
    for (let i = 2; i < words.length; i++) if (diff(i) < diff(best)) best = i;
    out.push({ lines: [words.slice(0, best).join(" "), words.slice(best).join(" ")], vertical: false });
  }
  out.push({ lines: [name], vertical: true });
  if (words.length > 1) out.push({ lines: out[1].lines, vertical: true });
  return out;
}

function fitLabel(name: string, poly: Point[], maxSize: number): RoomLabel {
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  const minX = Math.min(...xs), minY = Math.min(...ys), maxX = Math.max(...xs), maxY = Math.max(...ys);
  // Candidate spots: the point deepest inside, plus a grid across the room.
  const spots: Point[] = [innermostPoint(poly)];
  const N = 9;
  for (let i = 1; i < N; i++) for (let j = 1; j < N; j++) {
    const p = { x: minX + ((maxX - minX) * i) / N, y: minY + ((maxY - minY) * j) / N };
    if (pointInPolygon(p, poly)) spots.push(p);
  }
  const options = layouts(name);
  let best: RoomLabel = { x: spots[0].x, y: spots[0].y, fontSize: 0, lines: [name], vertical: false };
  let bestScore = -1;
  for (const opt of options) {
    const long = Math.max(3, ...opt.lines.map((l) => l.length));
    // Text box per unit of font size, with a little breathing room.
    let bw = (long * CHAR) / 0.88, bh = (opt.lines.length * LINE) / 0.85;
    if (opt.vertical) [bw, bh] = [bh, bw];
    for (const s of spots) {
      const size = largestFit(poly, s, bw, bh, maxSize);
      // Prefer horizontal text and the deepest spot unless another is clearly bigger.
      const score = size * (opt.vertical ? 0.85 : 1) * (opt.lines.length > 1 ? 0.97 : 1) * (s === spots[0] ? 1.03 : 1);
      if (score > bestScore) {
        bestScore = score;
        best = { x: s.x, y: s.y, fontSize: size, lines: opt.lines, vertical: opt.vertical };
      }
    }
  }
  return best;
}

/** Biggest font size whose text box (bw × bh per unit size), centred at c, stays inside the shape. */
function largestFit(poly: Point[], c: Point, bw: number, bh: number, maxSize: number) {
  if (boxInside(poly, c, (bw * maxSize) / 2, (bh * maxSize) / 2)) return maxSize;
  let lo = 0, hi = maxSize;
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (boxInside(poly, c, (bw * mid) / 2, (bh * mid) / 2)) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Is the axis-aligned box (centre c, half-sizes hw × hh) inside the polygon? */
function boxInside(poly: Point[], c: Point, hw: number, hh: number) {
  const x0 = c.x - hw, x1 = c.x + hw, y0 = c.y - hh, y1 = c.y + hh;
  for (const p of [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]) if (!pointInPolygon(p, poly)) return false;
  // No corner of the room may poke into the box, and no wall may cross it.
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i], b = poly[(i + 1) % poly.length];
    if (a.x > x0 && a.x < x1 && a.y > y0 && a.y < y1) return false;
    if (segmentCrossesBox(a, b, x0, y0, x1, y1)) return false;
  }
  return true;
}

function segmentCrossesBox(a: Point, b: Point, x0: number, y0: number, x1: number, y1: number) {
  // Liang–Barsky clip: does any part of ab lie strictly inside the box?
  let t0 = 0, t1 = 1;
  const dx = b.x - a.x, dy = b.y - a.y;
  const clip = (p: number, q: number) => {
    if (Math.abs(p) < 1e-12) return q > 0;
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
    return true;
  };
  const e = 1e-6;
  if (clip(-dx, a.x - x0 - e) && clip(dx, x1 - e - a.x) && clip(-dy, a.y - y0 - e) && clip(dy, y1 - e - a.y)) return t1 - t0 > 1e-9;
  return false;
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
  const queue: Cell[] = [];
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
