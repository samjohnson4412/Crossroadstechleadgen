import type { CameraPlacement, DisplayPlacement, DoorPlacement, Floor, SiteConfig, Zone } from "./site.ts";

/** Default walking time between adjacent zones when a passage doesn't say. */
export const DEFAULT_HOP_SECONDS = 15;

export interface IndexedZone extends Zone {
  floorId: string;
  buildingId: string;
}
export interface IndexedCamera extends CameraPlacement {
  floorId: string;
}
export interface IndexedDoor extends DoorPlacement {
  floorId: string;
}
export interface IndexedDisplay extends DisplayPlacement {
  floorId: string;
}

interface Edge {
  to: string;
  seconds: number;
  doorId?: string;
}

/**
 * The building as a graph: zones are nodes, doors and passages are edges.
 * Everything location-aware (which cameras to show next, whether a sighting is
 * physically plausible) is answered here.
 */
export class SiteGraph {
  readonly zones = new Map<string, IndexedZone>();
  readonly cameras = new Map<string, IndexedCamera>();
  readonly doors = new Map<string, IndexedDoor>();
  readonly displays = new Map<string, IndexedDisplay>();
  readonly floors = new Map<string, Floor>();
  private readonly edges = new Map<string, Edge[]>();
  private readonly camerasByZone = new Map<string, string[]>();

  constructor(site: SiteConfig) {
    for (const building of site.buildings) {
      for (const floor of building.floors) {
        this.floors.set(floor.id, floor);
        for (const z of floor.zones) this.zones.set(z.id, { ...z, floorId: floor.id, buildingId: building.id });
        for (const c of floor.cameras) this.cameras.set(c.id, { ...c, floorId: floor.id });
        for (const d of floor.doors) this.doors.set(d.id, { ...d, floorId: floor.id });
        for (const d of floor.displays) this.displays.set(d.id, { ...d, floorId: floor.id });
      }
    }
    for (const zoneId of this.zones.keys()) this.edges.set(zoneId, []);
    for (const door of this.doors.values()) this.link(door.between[0], door.between[1], DEFAULT_HOP_SECONDS, door.id);
    for (const p of site.passages) this.link(p.between[0], p.between[1], p.seconds ?? DEFAULT_HOP_SECONDS);
    for (const cam of this.cameras.values()) {
      for (const zoneId of cam.covers) {
        if (!this.zones.has(zoneId)) throw new Error(`Camera ${cam.id} covers unknown zone ${zoneId}`);
        const list = this.camerasByZone.get(zoneId) ?? [];
        list.push(cam.id);
        this.camerasByZone.set(zoneId, list);
      }
    }
  }

  private link(a: string, b: string, seconds: number, doorId?: string) {
    if (!this.zones.has(a) || !this.zones.has(b)) throw new Error(`Connection references unknown zone: ${a} <-> ${b}`);
    this.edges.get(a)!.push({ to: b, seconds, doorId });
    this.edges.get(b)!.push({ to: a, seconds, doorId });
  }

  neighbors(zoneId: string): string[] {
    return [...new Set((this.edges.get(zoneId) ?? []).map((e) => e.to))];
  }

  camerasInZone(zoneId: string): string[] {
    return this.camerasByZone.get(zoneId) ?? [];
  }

  /**
   * Shortest walking time (seconds) from one zone to every reachable zone,
   * along with hop counts. Dijkstra over a small graph.
   */
  distancesFrom(zoneId: string): Map<string, { seconds: number; hops: number }> {
    const dist = new Map<string, { seconds: number; hops: number }>([[zoneId, { seconds: 0, hops: 0 }]]);
    const queue: string[] = [zoneId];
    while (queue.length) {
      queue.sort((a, b) => dist.get(a)!.seconds - dist.get(b)!.seconds);
      const current = queue.shift()!;
      const here = dist.get(current)!;
      for (const edge of this.edges.get(current) ?? []) {
        const next = { seconds: here.seconds + edge.seconds, hops: here.hops + 1 };
        const known = dist.get(edge.to);
        if (!known || next.seconds < known.seconds) {
          dist.set(edge.to, next);
          queue.push(edge.to);
        }
      }
    }
    return dist;
  }

  /**
   * Cameras ordered by how soon someone leaving `zoneId` could appear on them.
   * This is the "where will they show up next" list the follow view is built on.
   */
  camerasNear(zoneId: string, maxHops = 2): { cameraId: string; hops: number; seconds: number }[] {
    const result = new Map<string, { cameraId: string; hops: number; seconds: number }>();
    for (const [zone, d] of this.distancesFrom(zoneId)) {
      if (d.hops > maxHops) continue;
      for (const cameraId of this.camerasInZone(zone)) {
        const prev = result.get(cameraId);
        if (!prev || d.seconds < prev.seconds) result.set(cameraId, { cameraId, ...d });
      }
    }
    return [...result.values()].sort((a, b) => a.seconds - b.seconds || a.cameraId.localeCompare(b.cameraId));
  }

  /** Zones where a camera or door event places a person. */
  zonesForCamera(cameraId: string): string[] {
    return this.cameras.get(cameraId)?.covers ?? [];
  }
}
