import { closestOnSegment, distanceToOutline, pointInPolygon } from "../core/geometry.ts";
import type { SiteLayout } from "../core/overrides.ts";
import type { CameraPlacement, DoorPlacement, Floor, Point, Zone, ZoneKind } from "../core/site.ts";
import { findRooms, signedArea, type PlanRoom } from "./rooms.ts";
import { parsePlanSvg } from "./svg.ts";

/**
 * Replaces one building on one level with a floor plan drawn in Inkscape:
 * - the plan is fitted onto the map by matching room names it shares with the
 *   rooms already there (E105 ↔ E105…), so it lands on the right spot, at the right angle;
 * - matched rooms keep their ids, so history, rules and tracks still point at them;
 * - cameras, doors and stairs that pointed at the old rooms are moved to the new ones;
 * - access-controlled doors snap onto the matching door in the plan;
 * - cameras not on the map yet are placed in the room their name mentions.
 */

export interface CameraInfo {
  integration: string;
  externalId: string;
  name: string;
}

export interface ImportOptions {
  layout: SiteLayout;
  floorId: string;
  /** Building name as used on its rooms, e.g. "Education". */
  building: string;
  svg: string;
  /** Cameras from the camera systems, for placing the ones not on the map yet. */
  cameras?: CameraInfo[];
  /** Only auto-place cameras whose name starts with this (e.g. "EB1"); others only on an exact room-name match. */
  cameraPrefix?: string;
}

export interface ImportReport {
  fit: "matched rooms" | "old outline" | "centered";
  matched: string[];
  /** How far matched rooms landed from where they were, on average (map units). */
  fitError?: number;
  rooms: number;
  doors: number;
  exteriorDoors: number;
  removedRooms: string[];
  camerasMoved: string[];
  camerasPlaced: string[];
  controlledDoors: string[];
  links: string[];
  warnings: string[];
}

type Affine = [number, number, number, number, number, number]; // x' = a x + b y + c ; y' = d x + e y + f
const applyA = (t: Affine, p: Point): Point => ({ x: t[0] * p.x + t[1] * p.y + t[2], y: t[3] * p.x + t[4] * p.y + t[5] });

/**
 * Best fit of src → dst that keeps walls square: a quarter turn and/or mirror,
 * then separate width/height stretch and a shift (plans are rarely drawn to scale).
 */
function fitSquare(src: Point[], dst: Point[]): { t: Affine; error: number } | null {
  let best: { t: Affine; error: number } | null = null;
  // Orientation as [u from x, u from y, v from x, v from y].
  const orientations: [number, number, number, number][] = [
    [1, 0, 0, 1], [0, -1, 1, 0], [-1, 0, 0, -1], [0, 1, -1, 0],
    [-1, 0, 0, 1], [0, 1, 1, 0], [1, 0, 0, -1], [0, -1, -1, 0],
  ];
  const line = (u: number[], w: number[]) => {
    const n = u.length;
    const mu = u.reduce((a, b) => a + b, 0) / n, mw = w.reduce((a, b) => a + b, 0) / n;
    let num = 0, den = 0;
    for (let i = 0; i < n; i++) (num += (u[i] - mu) * (w[i] - mw)), (den += (u[i] - mu) ** 2);
    if (den < 1e-9) return null;
    const s = num / den;
    return { s, c: mw - s * mu };
  };
  for (const [a, b, c, d] of orientations) {
    const u = src.map((p) => a * p.x + b * p.y);
    const v = src.map((p) => c * p.x + d * p.y);
    const fx = line(u, dst.map((p) => p.x));
    const fy = line(v, dst.map((p) => p.y));
    if (!fx || !fy || fx.s <= 0 || fy.s <= 0) continue;
    const t: Affine = [fx.s * a, fx.s * b, fx.c, fy.s * c, fy.s * d, fy.c];
    const error = Math.sqrt(src.reduce((sum, p, i) => sum + dist(applyA(t, p), dst[i]) ** 2, 0) / src.length);
    if (!best || error < best.error) best = { t, error };
  }
  return best;
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

const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "room";
const round = (n: number) => Math.round(n * 10) / 10;
const pathOf = (lines: Point[][], close: boolean) => lines.map((l) => `M${l.map((p) => `${round(p.x)} ${round(p.y)}`).join("L")}${close ? "Z" : ""}`).join("");

export function roomName(room: PlanRoom) {
  return room.lines.length ? room.lines.join(" ").replace(/\s+/g, " ").trim() : "Unlabeled room";
}

export function kindFor(name: string): ZoneKind {
  const n = name.toLowerCase();
  if (/elevator|stair/.test(n)) return "stair";
  if (/hall|corridor|breezeway|walkway|vestibule/.test(n)) return "hall";
  if (/lobby|entry|entrance|foyer/.test(n)) return "entry";
  if (/gym|sanctuary|cafe|caf[eé]|cafeteria|auditorium|library|chapel|multipurpose|commons|aftercare/.test(n)) return "common";
  if (/office|counsel|account|reception|lounge|facilities|print|resource|conference/.test(n)) return "office";
  return "room";
}

/** Words that say little about which room a camera is in. */
const STOP = new Set(["cam", "camera", "the", "and", "of", "to", "room", "rm", "area", "ptz", "ceiling", "corner", "facing", "view", "inside", "interior"]);
const GENERIC = new Set(["closet", "restroom", "restrooms", "hallway", "hall", "office", "storage", "unlabeled"]);
const OUTDOOR = /parking|\blot\b|outside|drive|exterior|playground|playscape|field|street|sign/;
const tokens = (s: string) =>
  s
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    // Drop numbers and building codes ("eb", "eb1", "wc2"); keep room numbers like "e105".
    .filter((t) => t && !STOP.has(t) && !/^\d+$/.test(t) && !/^[a-z]{1,2}$/.test(t) && !/^[a-z]{1,3}\d$/.test(t))
    .map((t) => t.replace(/(?<=[a-z]{3})s$/, ""));

export function importFloorPlan(opts: ImportOptions): { layout: SiteLayout; report: ImportReport } {
  const layout: SiteLayout = structuredClone(opts.layout);
  const floors = layout.buildings.flatMap((b) => b.floors);
  const floor = floors.find((f) => f.id === opts.floorId);
  if (!floor) throw new Error(`No level "${opts.floorId}"`);
  const building = opts.building.trim();
  if (!building) throw new Error("Which building is this plan?");
  const sameBuilding = (z: Zone) => (z.building ?? "").toLowerCase() === building.toLowerCase();

  const plan = parsePlanSvg(opts.svg);
  if (!plan.walls.length) throw new Error("No walls found. Draw them on the Walls layer of the template.");
  const found = findRooms(plan);
  if (!found.rooms.length) throw new Error("No closed rooms found: walls need to meet so they enclose each room.");
  const report: ImportReport = {
    fit: "matched rooms",
    matched: [],
    rooms: found.rooms.length,
    doors: 0,
    exteriorDoors: 0,
    removedRooms: [],
    camerasMoved: [],
    camerasPlaced: [],
    controlledDoors: [],
    links: [],
    warnings: [...found.warnings],
  };

  // ---------- 1. Fit the drawing onto the map ----------
  const old = floor.zones.filter(sameBuilding);
  const planNames = found.rooms.map(roomName);
  const count = <T,>(xs: T[]) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<T, number>());
  const planKeyCount = count(found.rooms.flatMap((r) => [...new Set([key(r.lines[0] ?? ""), key(roomName(r))])]));
  const oldKeyCount = count(old.map((z) => key(z.name)));
  const pairs: { room: PlanRoom; zone: Zone }[] = [];
  for (const room of found.rooms) {
    if (!room.lines.length) continue;
    for (const k of new Set([key(room.lines[0]), key(roomName(room))])) {
      if (k.length < 2 || planKeyCount.get(k) !== 1 || oldKeyCount.get(k) !== 1) continue;
      const zone = old.find((z) => key(z.name) === k)!;
      if (pairs.some((p) => p.zone === zone || p.room === room)) continue;
      pairs.push({ room, zone });
    }
  }
  let T: Affine | null = null;
  if (pairs.length >= 3) T = fitSquare(pairs.map((p) => areaCentroid(p.room.polygon)), pairs.map((p) => areaCentroid(p.zone.polygon)))?.t ?? null;
  const planBounds = bboxOf(found.footprint.length ? found.footprint : found.rooms.flatMap((r) => r.polygon));
  if (T) {
    const errs = pairs.map((p) => dist(applyA(T!, areaCentroid(p.room.polygon)), areaCentroid(p.zone.polygon)));
    report.fitError = round(Math.sqrt(errs.reduce((s, e) => s + e * e, 0) / errs.length));
    report.matched = pairs.map((p) => p.zone.name);
    const size = Math.hypot(planBounds.w * Math.hypot(T[0], T[3]), planBounds.h * Math.hypot(T[1], T[4]));
    if (report.fitError > size * 0.15) {
      report.warnings.push(`Matched rooms didn't line up well (off by ~${report.fitError} on average): check that room numbers on the plan match the map, or fix positions in Edit map.`);
    }
  } else if (old.length) {
    // Stretch the drawing over the old rooms' outline.
    const ob = bboxOf(old.flatMap((z) => z.polygon));
    const sx = ob.w / planBounds.w, sy = ob.h / planBounds.h;
    T = [sx, 0, ob.minX - planBounds.minX * sx, 0, sy, ob.minY - planBounds.minY * sy];
    report.fit = "old outline";
    report.warnings.push(`Fewer than 3 room names matched the map, so the plan was stretched over the old ${building} rooms (no rotation). If it's turned the wrong way, rotate the drawing in Inkscape and import again.`);
  } else {
    const s = Math.min((floor.width * 0.5) / planBounds.w, (floor.height * 0.5) / planBounds.h);
    T = [s, 0, floor.width / 2 - (planBounds.minX + planBounds.w / 2) * s, 0, s, floor.height / 2 - (planBounds.minY + planBounds.h / 2) * s];
    report.fit = "centered";
    report.warnings.push(`No ${building} rooms on this level yet, so the plan was put in the middle of the map. Move or redraw it as needed.`);
  }
  const tp = (p: Point) => {
    const q = applyA(T!, p);
    return { x: round(q.x), y: round(q.y) };
  };
  // A flipped fit (mirror image) would reverse every shape; that's fine for drawing.

  // ---------- 2. New rooms ----------
  const allIds = new Set(floors.flatMap((f) => [...f.zones, ...f.cameras, ...f.doors, ...f.displays].map((x) => x.id)));
  const prefix = `${slug(building).split("-").map((w) => w[0]).join("")}${floor.id.replace(/[^a-z0-9]/gi, "")}`.toLowerCase();
  const newId = (base: string) => {
    let id = base;
    for (let n = 2; allIds.has(id); n++) id = `${base}-${n}`;
    allIds.add(id);
    return id;
  };
  const matchedZone = new Map(pairs.map((p) => [p.room.index, p.zone]));
  const replaced = new Set(old.map((z) => z.id));
  for (const z of old) allIds.delete(z.id);
  const roomZone = new Map<number, Zone>();
  const labelOf = new Map(plan.labels.map((l) => [l.lines.join(" "), l.at]));
  for (const room of found.rooms) {
    const keep = matchedZone.get(room.index);
    const name = keep && keep.name.length > roomName(room).length ? keep.name : roomName(room);
    const labelAt = room.lines.length ? labelOf.get(room.lines.join(" ")) : undefined;
    const zone: Zone = {
      id: keep ? keep.id : newId(`${prefix}-${slug(name)}`),
      name,
      kind: keep && keep.kind !== "room" ? keep.kind : kindFor(name),
      building,
      polygon: room.polygon.map(tp),
    };
    if (keep) allIds.add(keep.id);
    if (labelAt && !pointNearCentroid(labelAt, room.polygon)) zone.labelAt = tp(labelAt);
    roomZone.set(room.index, zone);
  }
  const newZones = [...roomZone.values()];
  report.removedRooms = old.filter((z) => !newZones.some((n) => n.id === z.id)).map((z) => z.name);

  // Old rooms that went away → the new room in the same spot (stairs prefer the nearest stairs).
  const remap = new Map<string, string>();
  for (const n of newZones) remap.set(n.id, n.id);
  for (const z of old) {
    if (remap.has(z.id)) continue;
    const c = areaCentroid(z.polygon);
    const sameKind = z.kind === "stair" ? newZones.filter((n) => n.kind === "stair") : [];
    const target =
      sameKind.sort((a, b) => dist(areaCentroid(a.polygon), c) - dist(areaCentroid(b.polygon), c))[0] ??
      smallestContaining(newZones, c) ??
      newZones.slice().sort((a, b) => distanceToOutline(c, a.polygon).distance - distanceToOutline(c, b.polygon).distance)[0];
    remap.set(z.id, target.id);
  }
  const re = (id: string) => (replaced.has(id) ? remap.get(id)! : id);
  const nameOf = (id: string) => [...newZones, ...floors.flatMap((f) => f.zones)].find((z) => z.id === id)?.name ?? id;

  floor.zones = [...floor.zones.filter((z) => !replaced.has(z.id)), ...newZones];
  const footprint = found.footprint.map(tp);

  // ---------- 3. Passages (stairs, open archways) into other buildings / levels ----------
  const seen = new Set<string>();
  layout.passages = layout.passages.flatMap((p) => {
    const a = replaced.has(p.between[0]), b = replaced.has(p.between[1]);
    if (a && b) return [];
    const between: [string, string] = [re(p.between[0]), re(p.between[1])];
    const k = [...between].sort().join("|");
    if (between[0] === between[1] || seen.has(k)) return [];
    seen.add(k);
    if (a || b) report.links.push(`${nameOf(between[0])} ↔ ${nameOf(between[1])}${p.seconds ? " (stairs/elevator)" : ""}`);
    return [{ ...p, between }];
  });

  // ---------- 4. Doors ----------
  const planDoors = found.doors.map((d) => ({ ...d, at: tp(d.position), used: false }));
  const bb = bboxOf(footprint.length ? footprint : newZones.flatMap((z) => z.polygon));
  const snapRadius = Math.max(bb.w, bb.h) * 0.12;
  for (const f of floors) {
    f.doors = f.doors.flatMap((door) => {
      const hits = door.between.map((z) => replaced.has(z));
      if (!hits[0] && !hits[1]) return [door];
      if (hits[0] && hits[1] && !door.source) return []; // an old inside door: the plan has its own
      if (f.id !== floor.id) return [{ ...door, between: [re(door.between[0]), re(door.between[1])] as [string, string] }];
      const keepSide = hits[0] && hits[1] ? null : hits[0] ? door.between[1] : door.between[0];
      // Snap onto the nearest plan door that leads out of the building (or any, for inside doors).
      // A door named after a room ("EB/YC Breezeway") prefers that room's doors.
      const named = new Set(tokens(door.name));
      const cands = planDoors
        .filter((d) => !d.used && (keepSide ? d.between[0] < 0 : true))
        .map((d) => {
          const room = roomZone.get(d.between[1])!;
          const nameHit = tokens(room.name).some((w) => named.has(w) && !GENERIC.has(w));
          // How close the door comes to whatever it leads to (the lobby of the next building, the drive…).
          const other = keepSide ? floor.zones.find((z) => z.id === keepSide) : undefined;
          const reach = other ? (pointInPolygon(d.at, other.polygon) ? 0 : distanceToOutline(d.at, other.polygon).distance) : 0;
          return { d, dist: dist(d.at, door.position), nameHit, reach };
        })
        .filter((c) => c.dist <= snapRadius * (c.nameHit ? 2.5 : 1.5))
        .sort((x, y) => Number(y.nameHit) - Number(x.nameHit) || x.reach + x.dist * 0.5 - (y.reach + y.dist * 0.5));
      const hit = cands[0]?.d;
      let between: [string, string];
      let position = door.position;
      if (hit) {
        hit.used = true;
        position = hit.at;
        const inside = roomZone.get(hit.between[1])!.id;
        between = keepSide ? (hits[0] ? [inside, keepSide] : [keepSide, inside]) : [hit.between[0] < 0 ? inside : roomZone.get(hit.between[0])!.id, inside];
        if (between[0] === between[1]) between = [re(door.between[0]), re(door.between[1])];
      } else {
        between = [re(door.between[0]), re(door.between[1])];
        report.warnings.push(`Couldn't find "${door.name}" on the plan — kept where it was. Drag it onto the right door in Edit map.`);
      }
      if (door.source) report.controlledDoors.push(`${door.name} → ${nameOf(between[0])} ↔ ${nameOf(between[1])}`);
      return [{ ...door, position, between }];
    });
  }
  let doorNo = 0;
  for (const d of planDoors) {
    if (d.used) continue;
    const inside = roomZone.get(d.between[1])!;
    let outside: Zone | undefined;
    if (d.between[0] < 0) {
      // Whatever is drawn outside this door on the map: an outdoor area or another building.
      const others = floor.zones.filter((z) => !newZones.includes(z));
      outside = others
        .map((z) => ({ z, d: pointInPolygon(d.at, z.polygon) ? 0 : distanceToOutline(d.at, z.polygon).distance }))
        .filter((c) => c.d <= snapRadius * (c.z.kind === "outdoor" ? 2 : 0.6))
        .sort((a, b) => a.d - b.d)[0]?.z;
      if (!outside) {
        report.warnings.push(`Outside door from ${inside.name} leads to nothing drawn on the map — skipped. Draw the outdoor area, then import again.`);
        continue;
      }
      report.exteriorDoors++;
    }
    const other = outside ?? roomZone.get(d.between[0])!;
    const door: DoorPlacement = {
      id: newId(`${prefix}-door-${++doorNo}`),
      name: outside ? `${inside.name} outside door` : `${other.name} – ${inside.name}`,
      position: d.at,
      between: [other.id, inside.id],
      ...(outside ? { exterior: true } : {}),
      ...(d.type ? { lockType: d.type } : {}),
    };
    floor.doors.push(door);
    report.doors++;
  }

  // ---------- 5. Cameras and displays ----------
  for (const f of floors)
    for (const cam of f.cameras) {
      const touches = cam.covers.some((z) => replaced.has(z));
      const inside = f.id === floor.id && footprint.length && pointInPolygon(cam.position, footprint);
      if (!touches && !inside) continue;
      const covers = new Set(cam.covers.map(re));
      const here = f.id === floor.id ? smallestContaining(newZones, cam.position) : undefined;
      if (here) covers.add(here.id);
      cam.covers = [...covers];
      report.camerasMoved.push(`${cam.name} → ${cam.covers.map(nameOf).join(", ")}`);
    }
  for (const f of floors) for (const d of f.displays) d.zoneId = re(d.zoneId);

  placeCameras(opts, floor, floors, newZones, footprint, report);

  // ---------- 6. The drawing itself ----------
  floor.drawings = [
    ...(floor.drawings ?? []).filter((d) => d.building.toLowerCase() !== building.toLowerCase()),
    { building, outline: footprint.length ? pathOf([footprint], true) : "", walls: pathOf(plan.wallLines.map((l) => l.map(tp)), false) },
  ];
  return { layout, report };
}

function placeCameras(opts: ImportOptions, floor: Floor, floors: Floor[], newZones: Zone[], footprint: Point[], report: ImportReport) {
  if (!opts.cameras?.length) return;
  const onMap = new Set(floors.flatMap((f) => f.cameras.map((c) => `${c.source.integration}/${c.source.externalId}`)));
  const prefix = opts.cameraPrefix?.trim().toLowerCase();
  const outdoorZones = floor.zones.filter((z) => z.kind === "outdoor");
  const controlled = floor.doors.filter((d) => d.source && d.between.some((z) => newZones.some((n) => n.id === z)));
  type Target = { kind: "zone"; zone: Zone; words: string[] } | { kind: "door"; door: DoorPlacement; words: string[] };
  const targets: Target[] = [
    ...newZones.map((zone) => ({ kind: "zone" as const, zone, words: tokens(zone.name) })),
    ...outdoorZones.map((zone) => ({ kind: "zone" as const, zone, words: tokens(zone.name) })),
    ...controlled.map((door) => ({ kind: "door" as const, door, words: tokens(door.name).filter((w) => !/^(door|entrance|entry|exit)$/.test(w)) })),
  ].filter((t) => t.words.length);
  const perZone = new Map<string, number>();

  for (const cam of opts.cameras) {
    if (onMap.has(`${cam.integration}/${cam.externalId}`)) continue;
    const name = cam.name.toLowerCase();
    const hasPrefix = !!prefix && (name.startsWith(prefix) || cam.externalId.toLowerCase().startsWith(prefix));
    const words = new Set(tokens(cam.name));
    const outdoorCam = OUTDOOR.test(name);
    const scored = targets
      .filter((t) => t.words.every((w) => words.has(w)))
      // Outdoor cameras go outside (or by a door), indoor ones inside.
      .filter((t) => t.kind === "door" || (t.zone.kind === "outdoor") === outdoorCam)
      .filter((t) => hasPrefix || (t.words.length >= 2 && t.words.length === words.size) || key(t.kind === "zone" ? t.zone.name : t.door.name) === key(cam.name))
      .filter((t) => !(t.words.length === 1 && GENERIC.has(t.words[0])))
      .map((t) => ({ t, score: t.words.length }))
      .sort((a, b) => b.score - a.score);
    if (!scored.length) continue;
    const top = scored.filter((s) => s.score === scored[0].score);
    const label = (t: Target) => (t.kind === "zone" ? t.zone.name : t.door.name);
    if (new Set(top.map((s) => key(label(s.t)))).size > 1) continue; // ambiguous
    const best = top.map((s) => s.t).sort((a, b) => (a.kind === "zone" && b.kind === "zone" ? Math.abs(signedArea(b.zone.polygon)) - Math.abs(signedArea(a.zone.polygon)) : 0))[0];

    let position: Point, heading: number, covers: string[];
    if (best.kind === "door") {
      const d = best.door;
      const inside = newZones.find((z) => d.between.includes(z.id))!;
      const c = areaCentroid(inside.polygon);
      const v = norm({ x: c.x - d.position.x, y: c.y - d.position.y });
      const step = Math.min(8, Math.sqrt(Math.abs(signedArea(inside.polygon))) * 0.3);
      position = { x: round(d.position.x + v.x * step), y: round(d.position.y + v.y * step) };
      heading = headingTo(position, d.position);
      covers = [...d.between];
    } else if (best.zone.kind === "outdoor" && footprint.length) {
      const c = areaCentroid(best.zone.polygon);
      const zoneId = best.zone.id;
      // "… Doors" cameras watch the door out to that area.
      const door = /door|entr/.test(name) ? floor.doors.find((d) => d.exterior && d.between[0] === zoneId && !d.source) : undefined;
      position = door ? { ...door.position } : nearestOnOutline(c, footprint);
      heading = headingTo(position, c);
      covers = door ? [...door.between] : [zoneId];
    } else {
      const z = best.zone;
      const n = perZone.get(z.id) ?? 0;
      perZone.set(z.id, n + 1);
      const c = areaCentroid(z.polygon);
      const corner = z.polygon[(n * Math.max(1, Math.floor(z.polygon.length / 2))) % z.polygon.length];
      position = { x: round(corner.x + (c.x - corner.x) * 0.18), y: round(corner.y + (c.y - corner.y) * 0.18) };
      heading = headingTo(position, c);
      covers = [z.id];
    }
    const placed: CameraPlacement = {
      id: uniqueCamId(floors, cam),
      name: cam.name,
      position,
      heading: Math.round(heading),
      fov: 80,
      covers,
      source: { integration: cam.integration, externalId: cam.externalId },
      placeholder: true,
    };
    floor.cameras.push(placed);
    onMap.add(`${cam.integration}/${cam.externalId}`);
    report.camerasPlaced.push(`${cam.name} → ${best.kind === "zone" ? best.zone.name : `by ${best.door.name}`}`);
  }
}

function uniqueCamId(floors: Floor[], cam: CameraInfo) {
  const ids = new Set(floors.flatMap((f) => [...f.zones, ...f.cameras, ...f.doors, ...f.displays].map((x) => x.id)));
  const base = `cam-${cam.integration}-${slug(cam.externalId)}`;
  let id = base;
  for (let n = 2; ids.has(id); n++) id = `${base}-${n}`;
  return id;
}

function bboxOf(points: Point[]) {
  const xs = points.map((p) => p.x), ys = points.map((p) => p.y);
  const minX = Math.min(...xs), minY = Math.min(...ys);
  return { minX, minY, w: Math.max(1e-6, Math.max(...xs) - minX), h: Math.max(1e-6, Math.max(...ys) - minY) };
}
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const norm = (v: Point) => {
  const l = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / l, y: v.y / l };
};
/** Degrees clockwise from "up", as the map draws camera headings. */
const headingTo = (from: Point, to: Point) => ((Math.atan2(to.x - from.x, -(to.y - from.y)) * 180) / Math.PI + 360) % 360;
function smallestContaining(zones: Zone[], p: Point) {
  return zones.filter((z) => pointInPolygon(p, z.polygon)).sort((a, b) => Math.abs(signedArea(a.polygon)) - Math.abs(signedArea(b.polygon)))[0];
}
function nearestOnOutline(p: Point, poly: Point[]) {
  let best = poly[0], bd = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const hit = closestOnSegment(p, poly[i], poly[(i + 1) % poly.length]);
    if (hit.distance < bd) (bd = hit.distance), (best = hit.point);
  }
  return { x: round(best.x), y: round(best.y) };
}
/** Is the label roughly where the map would put the name anyway? */
function pointNearCentroid(p: Point, poly: Point[]) {
  const c = areaCentroid(poly);
  const b = bboxOf(poly);
  return dist(p, c) < Math.min(b.w, b.h) * 0.2 && pointInPolygon(c, poly);
}
