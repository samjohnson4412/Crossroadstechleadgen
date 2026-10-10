import { closestOnSegment, pointInPolygon } from "../core/geometry.ts";
import type { Point } from "../core/site.ts";
import { doorTypeFromColor, type ParsedPlan, type Segment } from "./svg.ts";

/**
 * Turns a parsed floor plan into rooms and doors: every area closed in by walls
 * (or dividers) is a room, named by the label inside it; every door line sits on
 * a wall and connects the rooms on either side of it.
 */

export interface PlanRoom {
  index: number;
  polygon: Point[];
  area: number;
  /** Label lines inside it (room number first), or empty when unlabeled. */
  lines: string[];
  /** More than one label landed in this room: probably a missing wall. */
  merged?: boolean;
}
export interface PlanDoor {
  position: Point;
  /** Room indexes; -1 = outside the building. */
  between: [number, number];
  type?: "access" | "keypad" | "key" | "none";
  /** Wall direction at the door (unit vector), for placing things beside it. */
  along: Point;
}
export interface PlanRooms {
  rooms: PlanRoom[];
  doors: PlanDoor[];
  /** Rooms split by a divider (not a wall): people walk straight between them. */
  openings: [number, number][];
  /** The building's outline (the outside of the walls). */
  footprint: Point[];
  warnings: string[];
}

const sub = (a: Point, b: Point) => ({ x: a.x - b.x, y: a.y - b.y });
const len = (a: Point) => Math.hypot(a.x, a.y);
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x;

export function signedArea(poly: Point[]) {
  let s = 0;
  for (let i = 0; i < poly.length; i++) s += cross(poly[i], poly[(i + 1) % poly.length]);
  return s / 2;
}

/** Where segments p and q cross: parameters along each, or null. */
function intersect(p: Segment, q: Segment) {
  const r = sub(p.b, p.a);
  const s = sub(q.b, q.a);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-9) return null;
  const qp = sub(q.a, p.a);
  const t = cross(qp, s) / den;
  const u = cross(qp, r) / den;
  if (t < -1e-9 || t > 1 + 1e-9 || u < -1e-9 || u > 1 + 1e-9) return null;
  return { t, u, point: { x: p.a.x + t * r.x, y: p.a.y + t * r.y } };
}

/** Drop collinear and duplicate corners. */
function simplify(poly: Point[], tol: number): Point[] {
  let pts = poly.slice();
  let changed = true;
  while (changed && pts.length > 3) {
    changed = false;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i - 1 + pts.length) % pts.length];
      const b = pts[i];
      const c = pts[(i + 1) % pts.length];
      if (closestOnSegment(b, a, c).distance < tol * 0.35 || len(sub(a, b)) < 1e-6) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return pts;
}

export function findRooms(plan: ParsedPlan, opts: { tolerance?: number; minArea?: number } = {}): PlanRooms {
  const warnings: string[] = [];
  const all = [...plan.walls, ...plan.dividers].filter((s) => len(sub(s.b, s.a)) > 1e-6).map((s) => ({ a: { ...s.a }, b: { ...s.b } }));
  const extent = Math.max(1, ...all.flatMap((s) => [s.a.x, s.a.y, s.b.x, s.b.y]).map(Math.abs));
  const tol = opts.tolerance ?? Math.max(1.5, extent * 0.0025);
  const minArea = opts.minArea ?? tol * tol * 40;

  // 1. Pull loose wall ends onto the wall they almost touch (T-junctions, small gaps).
  const splits: number[][] = all.map(() => [0, 1]);
  for (let i = 0; i < all.length; i++) {
    for (const end of ["a", "b"] as const) {
      const p = all[i][end];
      let best: { j: number; point: Point; d: number } | null = null;
      for (let j = 0; j < all.length; j++) {
        if (j === i) continue;
        const hit = closestOnSegment(p, all[j].a, all[j].b);
        if (hit.distance < tol && (!best || hit.distance < best.d)) best = { j, point: hit.point, d: hit.distance };
      }
      if (best && best.d > 0) all[i][end] = best.point;
    }
  }
  // 2. Split every wall where another wall touches or crosses it.
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      const hit = intersect(all[i], all[j]);
      if (hit) splits[i].push(hit.t), splits[j].push(hit.u);
    }
  // 3. Merge points closer than the tolerance into shared corners.
  const verts: Point[] = [];
  const grid = new Map<string, number[]>();
  const vertexAt = (p: Point) => {
    const gx = Math.floor(p.x / tol), gy = Math.floor(p.y / tol);
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (const v of grid.get(`${gx + dx},${gy + dy}`) ?? []) if (len(sub(verts[v], p)) < tol) return v;
    verts.push(p);
    const key = `${gx},${gy}`;
    grid.set(key, [...(grid.get(key) ?? []), verts.length - 1]);
    return verts.length - 1;
  };
  const edges = new Set<string>();
  for (let i = 0; i < all.length; i++) {
    const s = all[i];
    const ts = [...new Set(splits[i].map((t) => Math.round(t * 1e6) / 1e6))].sort((a, b) => a - b);
    let prev = vertexAt(s.a);
    for (const t of ts.slice(1)) {
      const v = vertexAt({ x: s.a.x + t * (s.b.x - s.a.x), y: s.a.y + t * (s.b.y - s.a.y) });
      if (v !== prev) edges.add(prev < v ? `${prev},${v}` : `${v},${prev}`);
      prev = v;
    }
  }
  const adj = new Map<number, Set<number>>();
  for (const e of edges) {
    const [u, v] = e.split(",").map(Number);
    if (!adj.has(u)) adj.set(u, new Set());
    if (!adj.has(v)) adj.set(v, new Set());
    adj.get(u)!.add(v);
    adj.get(v)!.add(u);
  }
  // 4. Remove dead ends (wall stubs that don't enclose anything).
  let pruned = true;
  while (pruned) {
    pruned = false;
    for (const [v, ns] of adj)
      if (ns.size <= 1) {
        for (const n of ns) adj.get(n)?.delete(v);
        adj.delete(v);
        pruned = true;
      }
  }
  // 5. Trace faces: at each corner take the next wall turning one way.
  const sorted = new Map<number, number[]>();
  for (const [v, ns] of adj) sorted.set(v, [...ns].sort((a, b) => Math.atan2(verts[a].y - verts[v].y, verts[a].x - verts[v].x) - Math.atan2(verts[b].y - verts[v].y, verts[b].x - verts[v].x)));
  const used = new Set<string>();
  const faces: Point[][] = [];
  for (const [u, ns] of sorted)
    for (const v of ns) {
      if (used.has(`${u}>${v}`)) continue;
      const cycle: number[] = [];
      let a = u, b = v;
      while (!used.has(`${a}>${b}`) && cycle.length < 10000) {
        used.add(`${a}>${b}`);
        cycle.push(a);
        const around = sorted.get(b)!;
        const idx = around.indexOf(a);
        const next = around[(idx - 1 + around.length) % around.length];
        a = b;
        b = next;
      }
      faces.push(cycle.map((i) => verts[i]));
    }
  // Rooms all wind one way; the outside of each connected drawing winds the other way.
  const areas = faces.map(signedArea);
  const pos = areas.filter((a) => a > 0).length;
  const neg = areas.length - pos;
  const roomSign = pos >= neg ? 1 : -1;
  const outers = faces.filter((_, i) => Math.sign(areas[i]) !== roomSign).sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)));
  let slivers = 0;
  const rooms: PlanRoom[] = [];
  faces.forEach((f, i) => {
    if (Math.sign(areas[i]) !== roomSign) return;
    if (Math.abs(areas[i]) < minArea) return void slivers++;
    const polygon = simplify(f, tol);
    if (polygon.length >= 3) rooms.push({ index: rooms.length, polygon, area: Math.abs(signedArea(polygon)), lines: [] });
  });
  if (slivers) warnings.push(`${slivers} tiny gap${slivers > 1 ? "s" : ""} between walls ignored.`);
  const footprint = outers[0] ? simplify(outers[0], tol) : [];

  const roomAt = (p: Point) => {
    let best = -1;
    for (const r of rooms) if (pointInPolygon(p, r.polygon) && (best < 0 || r.area < rooms[best].area)) best = r.index;
    return best;
  };

  // 6. Labels name the room they're in.
  for (const label of plan.labels) {
    const r = roomAt(label.at);
    if (r < 0) {
      warnings.push(`Label "${label.lines.join(" ")}" isn't inside any room.`);
      continue;
    }
    if (rooms[r].lines.length) rooms[r].merged = true;
    rooms[r].lines.push(...label.lines);
  }
  for (const r of rooms) if (r.merged) warnings.push(`"${r.lines.join(" ")}" are in one room — is a wall missing between them?`);

  // 7. Doors: find the wall each door line sits on, then the room on each side of it.
  const wallSegs = [...plan.walls, ...plan.dividers];
  const doors: PlanDoor[] = [];
  let lost = 0;
  for (const line of plan.doors) {
    const mid = { x: (line.a.x + line.b.x) / 2, y: (line.a.y + line.b.y) / 2 };
    const doorLen = len(sub(line.b, line.a));
    let best: { at: Point; wall: Segment; d: number } | null = null;
    for (const w of wallSegs) {
      const hit = intersect(line, w);
      const at = hit ? hit.point : closestOnSegment(mid, w.a, w.b).point;
      const d = hit ? len(sub(hit.point, mid)) * 0.01 : len(sub(at, mid));
      if (!best || d < best.d) best = { at, wall: w, d };
    }
    if (!best || best.d > Math.max(tol * 4, doorLen)) {
      lost++;
      continue;
    }
    const dir = sub(best.wall.b, best.wall.a);
    const along = { x: dir.x / len(dir), y: dir.y / len(dir) };
    const normal = { x: -along.y, y: along.x };
    let sides: [number, number] | null = null;
    for (const off of [tol * 2, tol * 4, tol * 7]) {
      const s1 = roomAt({ x: best.at.x + normal.x * off, y: best.at.y + normal.y * off });
      const s2 = roomAt({ x: best.at.x - normal.x * off, y: best.at.y - normal.y * off });
      if (s1 !== s2) {
        sides = [s1, s2];
        break;
      }
    }
    if (!sides) {
      lost++;
      continue;
    }
    const between: [number, number] = sides[0] < 0 ? [sides[0], sides[1]] : sides[1] < 0 ? [sides[1], sides[0]] : sides;
    // Double doors are often drawn as two lines: keep one door per pair of rooms per spot.
    const dupe = doors.find((d) => ((d.between[0] === between[0] && d.between[1] === between[1]) || (d.between[0] === between[1] && d.between[1] === between[0])) && len(sub(d.position, best!.at)) < Math.max(doorLen * 2, tol * 12));
    if (dupe) continue;
    doors.push({ position: best.at, between, type: doorTypeFromColor(line.color), along });
  }
  if (lost) warnings.push(`${lost} door line${lost > 1 ? "s" : ""} not on a wall between two rooms (ignored).`);
  const unlabeled = rooms.filter((r) => !r.lines.length).length;
  if (unlabeled) warnings.push(`${unlabeled} room${unlabeled > 1 ? "s have" : " has"} no label.`);
  // 8. Dividers split open areas: the rooms on either side connect without a door.
  const openings: [number, number][] = [];
  for (const dv of plan.dividers) {
    const dir = sub(dv.b, dv.a);
    const l = len(dir);
    if (l < tol) continue;
    const normal = { x: -dir.y / l, y: dir.x / l };
    for (const t of [0.15, 0.5, 0.85]) {
      const at = { x: dv.a.x + dir.x * t, y: dv.a.y + dir.y * t };
      const s1 = roomAt({ x: at.x + normal.x * tol * 2, y: at.y + normal.y * tol * 2 });
      const s2 = roomAt({ x: at.x - normal.x * tol * 2, y: at.y - normal.y * tol * 2 });
      if (s1 < 0 || s2 < 0 || s1 === s2) continue;
      const pair: [number, number] = s1 < s2 ? [s1, s2] : [s2, s1];
      if (!openings.some((o) => o[0] === pair[0] && o[1] === pair[1])) openings.push(pair);
    }
  }
  return { rooms, doors, openings, footprint, warnings };
}
