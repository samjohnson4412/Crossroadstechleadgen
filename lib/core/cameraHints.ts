import { pointInPolygon } from "./geometry.ts";
import type { SiteLayout } from "./overrides.ts";
import type { CameraHint, Floor, Point, Zone } from "./site.ts";

export interface UnplacedCamera {
  integration: string;
  externalId: string;
  name: string;
}

/**
 * Put cameras that aren't on the map yet into their suggested rooms (dashed until
 * confirmed). Several cameras in one room are spread along its walls, facing in.
 */
export function placeSuggestedCameras(input: SiteLayout, cameras: UnplacedCamera[], hints: Record<string, CameraHint>) {
  const layout: SiteLayout = structuredClone(input);
  const floors = layout.buildings.flatMap((b) => b.floors);
  const onMap = new Set(floors.flatMap((f) => f.cameras.map((c) => `${c.source.integration}/${c.source.externalId}`)));
  const ids = new Set(floors.flatMap((f) => [...f.zones, ...f.cameras, ...f.doors, ...f.displays].map((x) => x.id)));
  const findZone = (ref: string): { zone: Zone; floor: Floor } | undefined => {
    for (const floor of floors) {
      const zone = floor.zones.find((z) => z.id === ref) ?? floor.zones.find((z) => z.name.trim().toLowerCase() === ref.trim().toLowerCase());
      if (zone) return { zone, floor };
    }
  };
  const perZone = new Map<string, number>();
  for (const f of floors) for (const c of f.cameras) for (const z of c.covers.slice(0, 1)) perZone.set(z, (perZone.get(z) ?? 0) + 1);
  const placed: { name: string; room: string; sure: boolean }[] = [];
  const noRoom: string[] = [];

  for (const cam of cameras) {
    if (onMap.has(`${cam.integration}/${cam.externalId}`)) continue;
    const hint = hints[cam.externalId];
    if (!hint) continue;
    const hit = hint.rooms.map(findZone).find(Boolean);
    if (!hit) {
      noRoom.push(cam.name);
      continue;
    }
    const n = perZone.get(hit.zone.id) ?? 0;
    perZone.set(hit.zone.id, n + 1);
    const position = spot(hit.zone.polygon, n);
    const c = middle(hit.zone.polygon);
    let id = `cam-${cam.integration}-${cam.externalId}`.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
    for (let k = 2; ids.has(id); k++) id = `${id}-${k}`;
    ids.add(id);
    hit.floor.cameras.push({
      id,
      name: cam.name,
      position,
      heading: Math.round(((Math.atan2(c.x - position.x, -(c.y - position.y)) * 180) / Math.PI + 360) % 360),
      fov: 80,
      covers: [hit.zone.id],
      source: { integration: cam.integration, externalId: cam.externalId },
      placeholder: true,
    });
    onMap.add(`${cam.integration}/${cam.externalId}`);
    placed.push({ name: cam.name, room: hit.zone.name, sure: hint.sure });
  }
  return { layout, placed, noRoom };
}

function middle(poly: Point[]): Point {
  return { x: poly.reduce((s, p) => s + p.x, 0) / poly.length, y: poly.reduce((s, p) => s + p.y, 0) / poly.length };
}

/** n-th mounting spot in a room: corners first, then mid-walls, then further in. */
function spot(poly: Point[], n: number): Point {
  const xs = poly.map((p) => p.x), ys = poly.map((p) => p.y);
  const minX = Math.min(...xs), minY = Math.min(...ys), w = Math.max(...xs) - minX, h = Math.max(...ys) - minY;
  const fractions: [number, number][] = [
    [0.15, 0.15], [0.85, 0.85], [0.85, 0.15], [0.15, 0.85],
    [0.5, 0.12], [0.88, 0.5], [0.5, 0.88], [0.12, 0.5],
    [0.32, 0.32], [0.68, 0.68], [0.68, 0.32], [0.32, 0.68], [0.5, 0.5],
  ];
  const inside = fractions.map(([fx, fy]) => ({ x: minX + w * fx, y: minY + h * fy })).filter((p) => pointInPolygon(p, poly));
  const pts = inside.length ? inside : [middle(poly)];
  const p = pts[n % pts.length];
  // Past the list, nudge so markers don't sit exactly on top of each other.
  const ring = Math.floor(n / pts.length);
  return { x: Math.round((p.x + ring * w * 0.04) * 10) / 10, y: Math.round((p.y + ring * h * 0.04) * 10) / 10 };
}
