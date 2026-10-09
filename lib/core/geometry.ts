import type { Point } from "./site.ts";

export function pointInPolygon(p: Point, polygon: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Closest point on segment ab to p, and the distance to it. */
export function closestOnSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  const point = { x: a.x + t * dx, y: a.y + t * dy };
  return { point, distance: Math.hypot(p.x - point.x, p.y - point.y) };
}

/** Distance from p to a polygon's outline, plus which edge (index of its first corner) is closest. */
export function distanceToOutline(p: Point, polygon: Point[]) {
  let best = { distance: Infinity, edge: 0, point: polygon[0] };
  for (let i = 0; i < polygon.length; i++) {
    const hit = closestOnSegment(p, polygon[i], polygon[(i + 1) % polygon.length]);
    if (hit.distance < best.distance) best = { distance: hit.distance, edge: i, point: hit.point };
  }
  return best;
}

/** Do two shapes share a wall (or overlap)? Used to suggest which rooms connect. */
export function polygonsTouch(a: Point[], b: Point[], tolerance = 3): boolean {
  if (a.some((p) => pointInPolygon(p, b)) || b.some((p) => pointInPolygon(p, a))) return true;
  // A shared wall: points along one outline sit on the other's outline.
  const samples = (poly: Point[]) =>
    poly.flatMap((p, i) => {
      const q = poly[(i + 1) % poly.length];
      return [0.25, 0.5, 0.75].map((t) => ({ x: p.x + (q.x - p.x) * t, y: p.y + (q.y - p.y) * t }));
    });
  return samples(a).some((p) => distanceToOutline(p, b).distance <= tolerance) || samples(b).some((p) => distanceToOutline(p, a).distance <= tolerance);
}
