import { distanceToOutline, pointInPolygon } from "../core/geometry.ts";
import type { SiteLayout } from "../core/overrides.ts";
import type { DoorPlacement, Floor, Point, Zone, ZoneKind } from "../core/site.ts";
import { findRooms, signedArea, type PlanRooms, type PlanRoom } from "./rooms.ts";
import { parsePlanSvg } from "./svg.ts";

/**
 * Puts a floor plan drawn in Inkscape on the map. The operator lines it up by
 * hand (move / resize / quarter turns); this file only does the geometry:
 * - every area closed in by walls becomes a room, named by its label;
 * - every door line becomes a door between the rooms on either side;
 * - when it replaces a building, things that pointed at the old rooms
 *   (cameras, badge doors, stairs) point at whatever new room is in the same spot.
 */

export interface ReadPlan extends PlanRooms {
  wallLines: Point[][];
  /** The drawing's extent, in its own units. */
  box: { minX: number; minY: number; w: number; h: number };
}

/** Where the plan goes on the map: its middle at (x, y), turned, then stretched (map axes). */
export interface Placement {
  x: number;
  y: number;
  /** Quarter turns clockwise. */
  turns: number;
  scaleX: number;
  scaleY: number;
}

export interface ImportReport {
  rooms: number;
  doors: number;
  exteriorDoors: number;
  removedRooms: string[];
  warnings: string[];
}

export function readPlan(svg: string): ReadPlan {
  const plan = parsePlanSvg(svg);
  if (!plan.walls.length) throw new Error("No walls found. Draw them on the Walls layer of the template.");
  const found = findRooms(plan);
  if (!found.rooms.length) throw new Error("No closed rooms found: walls need to meet so they enclose each room.");
  const pts = found.footprint.length ? found.footprint : plan.wallLines.flat();
  return { ...found, wallLines: plan.wallLines, box: bboxOf(pts) };
}

/** Size of the plan on the map at scale 1, after turning. */
export function turnedSize(plan: ReadPlan, turns: number) {
  return turns % 2 ? { w: plan.box.h, h: plan.box.w } : { w: plan.box.w, h: plan.box.h };
}

/** Plan point → map point. */
export function placer(plan: ReadPlan, at: Placement) {
  const cx = plan.box.minX + plan.box.w / 2;
  const cy = plan.box.minY + plan.box.h / 2;
  const t = ((at.turns % 4) + 4) % 4;
  return (p: Point): Point => {
    const dx = p.x - cx, dy = p.y - cy;
    // Clockwise quarter turns in screen coordinates (y points down).
    const [rx, ry] = t === 0 ? [dx, dy] : t === 1 ? [-dy, dx] : t === 2 ? [-dx, -dy] : [dy, -dx];
    return { x: round(at.x + rx * at.scaleX), y: round(at.y + ry * at.scaleY) };
  };
}

/** A starting spot: over the building it replaces, or the middle of the map at half its size. */
export function startPlacement(plan: ReadPlan, floor: Floor, replacing?: string): Placement {
  const old = replacing ? floor.zones.filter((z) => sameName(z.building, replacing)) : [];
  if (old.length) {
    const b = bboxOf(old.flatMap((z) => z.polygon));
    const s = Math.min(b.w / plan.box.w, b.h / plan.box.h);
    return { x: b.minX + b.w / 2, y: b.minY + b.h / 2, turns: 0, scaleX: s, scaleY: s };
  }
  const s = Math.min((floor.width * 0.5) / plan.box.w, (floor.height * 0.5) / plan.box.h);
  return { x: floor.width / 2, y: floor.height / 2, turns: 0, scaleX: s, scaleY: s };
}

export function roomName(room: PlanRoom) {
  return room.lines.length ? room.lines.join(" ").replace(/\s+/g, " ").trim() : "Unlabeled room";
}

export function kindFor(name: string): ZoneKind {
  const n = name.toLowerCase();
  if (/elevator|stair/.test(n)) return "stair";
  if (/hall|corridor|breezeway|walkway|vestibule/.test(n)) return "hall";
  if (/lobby|entry|entrance|foyer/.test(n)) return "entry";
  if (/gym|sanctuary|caf[eé]|cafeteria|auditorium|library|chapel|multipurpose|commons/.test(n)) return "common";
  if (/office|counsel|account|reception|lounge|conference/.test(n)) return "office";
  return "room";
}

export function applyPlan(opts: {
  layout: SiteLayout;
  floorId: string;
  plan: ReadPlan;
  placement: Placement;
  /** Building name for the new rooms. */
  building: string;
  /** Replace this building's rooms (and drawing) on this level. */
  replace?: string;
}): { layout: SiteLayout; report: ImportReport } {
  const layout: SiteLayout = structuredClone(opts.layout);
  const floors = layout.buildings.flatMap((b) => b.floors);
  const floor = floors.find((f) => f.id === opts.floorId);
  if (!floor) throw new Error(`No level "${opts.floorId}"`);
  const building = opts.building.trim();
  if (!building) throw new Error("Give the building a name.");
  const { plan } = opts;
  const at = placer(plan, opts.placement);
  const report: ImportReport = { rooms: plan.rooms.length, doors: 0, exteriorDoors: 0, removedRooms: [], warnings: [...plan.warnings] };

  const old = opts.replace ? floor.zones.filter((z) => sameName(z.building, opts.replace)) : [];
  const replaced = new Set(old.map((z) => z.id));
  const allIds = new Set(floors.flatMap((f) => [...f.zones, ...f.cameras, ...f.doors, ...f.displays].map((x) => x.id)));
  for (const id of replaced) allIds.delete(id);
  const newId = (base: string) => {
    let id = base;
    for (let n = 2; allIds.has(id); n++) id = `${base}-${n}`;
    allIds.add(id);
    return id;
  };
  const prefix = `${building.split(/\s+/).map((w) => w[0]).join("")}${floor.id}`.toLowerCase().replace(/[^a-z0-9]/g, "");

  // ---------- rooms ----------
  // A replaced room with the same name keeps its id, so its history carries over.
  const oldByName = new Map<string, Zone[]>();
  for (const z of old) oldByName.set(z.name.toLowerCase(), [...(oldByName.get(z.name.toLowerCase()) ?? []), z]);
  const roomZone = new Map<number, Zone>();
  for (const room of plan.rooms) {
    const name = roomName(room);
    const same = oldByName.get(name.toLowerCase());
    const keep = same?.length === 1 && room.lines.length && !allIds.has(same[0].id) ? same[0] : undefined;
    const zone: Zone = { id: keep ? keep.id : newId(`${prefix}-${slug(name)}`), name, kind: keep?.kind ?? kindFor(name), building, polygon: room.polygon.map(at) };
    allIds.add(zone.id);
    const lp = labelPoint(room);
    if (lp) zone.labelAt = at(lp);
    roomZone.set(room.index, zone);
  }
  const newZones = [...roomZone.values()];
  report.removedRooms = old.filter((z) => !newZones.some((n) => n.id === z.id)).map((z) => z.name);

  // Old rooms that went away → the new room in the same spot.
  const remap = new Map<string, string>();
  for (const z of old) {
    if (newZones.some((n) => n.id === z.id)) {
      remap.set(z.id, z.id);
      continue;
    }
    const c = areaCentroid(z.polygon);
    const target =
      smallestContaining(newZones, c) ?? newZones.slice().sort((a, b) => distanceToOutline(c, a.polygon).distance - distanceToOutline(c, b.polygon).distance)[0];
    remap.set(z.id, target.id);
  }
  const re = (id: string) => remap.get(id) ?? id;
  floor.zones = [...floor.zones.filter((z) => !replaced.has(z.id)), ...newZones];

  if (replaced.size) {
    // Stairs / passages to other buildings and levels follow the room.
    const seen = new Set<string>();
    layout.passages = layout.passages.flatMap((p) => {
      if (replaced.has(p.between[0]) && replaced.has(p.between[1])) return [];
      const between: [string, string] = [re(p.between[0]), re(p.between[1])];
      const k = [...between].sort().join("|");
      if (between[0] === between[1] || seen.has(k)) return [];
      seen.add(k);
      return [{ ...p, between }];
    });
    for (const f of floors) {
      // Plain doors inside the old building are replaced by the plan's doors; badge doors stay where they are.
      f.doors = f.doors.flatMap((d) => {
        if (!d.between.some((z) => replaced.has(z))) return [d];
        if (d.between.every((z) => replaced.has(z)) && !d.source) return [];
        const here = f.id === floor.id ? smallestContaining(newZones, d.position) : undefined;
        let between: [string, string] = [re(d.between[0]), re(d.between[1])];
        if (here && !between.includes(here.id)) between = replaced.has(d.between[0]) ? [here.id, between[1]] : [between[0], here.id];
        return between[0] === between[1] ? [] : [{ ...d, between }];
      });
      for (const c of f.cameras) c.covers = [...new Set(c.covers.map(re))];
      for (const d of f.displays) d.zoneId = re(d.zoneId);
    }
  }

  // ---------- doors ----------
  const outsideZones = floor.zones.filter((z) => !newZones.includes(z));
  let doorNo = 0;
  for (const d of plan.doors) {
    const pos = at(d.position);
    const inside = roomZone.get(d.between[1])!;
    const exterior = d.between[0] < 0;
    let other = exterior ? undefined : roomZone.get(d.between[0]);
    if (exterior) {
      // An outside door connects to whatever is drawn right outside it (an outdoor area, another building).
      const reach = Math.max(Math.sqrt(Math.abs(signedArea(inside.polygon))), 10);
      other = outsideZones
        .map((z) => ({ z, d: pointInPolygon(pos, z.polygon) ? 0 : distanceToOutline(pos, z.polygon).distance }))
        .filter((c) => c.d <= reach)
        .sort((a, b) => a.d - b.d)[0]?.z;
      if (!other) {
        report.warnings.push(`An outside door of ${inside.name} doesn't lead to anything drawn on the map, so it was left out. Draw the outdoor area, then add the door in Edit map.`);
        continue;
      }
      report.exteriorDoors++;
    }
    const door: DoorPlacement = {
      id: newId(`${prefix}-door-${++doorNo}`),
      name: exterior ? `${inside.name} outside door` : `${other!.name} – ${inside.name}`,
      position: pos,
      between: [other!.id, inside.id],
      ...(exterior ? { exterior: true } : {}),
      ...(d.type ? { lockType: d.type } : {}),
    };
    floor.doors.push(door);
    report.doors++;
  }

  // ---------- the drawing ----------
  const keep = (floor.drawings ?? []).filter((dr) => !sameName(dr.building, building) && !sameName(dr.building, opts.replace));
  floor.drawings = [
    ...keep,
    { building, outline: plan.footprint.length ? pathOf([plan.footprint.map(at)], true) : "", walls: pathOf(plan.wallLines.map((l) => l.map(at)), false) },
  ];
  return { layout, report };
}

// ---------- helpers ----------

const round = (n: number) => Math.round(n * 10) / 10;
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "room";
const sameName = (a?: string, b?: string) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();
const pathOf = (lines: Point[][], close: boolean) => lines.map((l) => `M${l.map((p) => `${round(p.x)} ${round(p.y)}`).join("L")}${close ? "Z" : ""}`).join("");

function bboxOf(points: Point[]) {
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  return { minX, minY, w: Math.max(1e-6, Math.max(...xs) - minX), h: Math.max(1e-6, Math.max(...ys) - minY) };
}

/** Area-weighted middle of a shape. */
export function areaCentroid(poly: Point[]): Point {
  const a = signedArea(poly);
  if (Math.abs(a) < 1e-9) return { x: poly.reduce((s, p) => s + p.x, 0) / poly.length, y: poly.reduce((s, p) => s + p.y, 0) / poly.length };
  let cx = 0, cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i], q = poly[(i + 1) % poly.length];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return { x: cx / (6 * a), y: cy / (6 * a) };
}

function smallestContaining(zones: Zone[], p: Point) {
  return zones.filter((z) => pointInPolygon(p, z.polygon)).sort((a, b) => Math.abs(signedArea(a.polygon)) - Math.abs(signedArea(b.polygon)))[0];
}

/** Where the room's label was drawn, when the middle of the shape would be a bad spot (L/U-shaped halls). */
function labelPoint(room: PlanRoom): Point | undefined {
  if (!room.labelAt) return undefined;
  const c = areaCentroid(room.polygon);
  const b = bboxOf(room.polygon);
  const nearMiddle = Math.hypot(room.labelAt.x - c.x, room.labelAt.y - c.y) < Math.min(b.w, b.h) * 0.2 && pointInPolygon(c, room.polygon);
  return nearMiddle ? undefined : room.labelAt;
}
