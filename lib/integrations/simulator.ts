import type { Appearance } from "../core/events.ts";
import type { IndexedDoor, SiteGraph } from "../core/graph.ts";
import { bounds, type Point } from "../core/site.ts";
import type { DoorStatus, Integration, IntegrationContext, IntegrationDriver } from "./types.ts";

/**
 * Building simulator. Stands in for any integration whose real system isn't
 * configured (or when SENTINEL_SIMULATE=1), so the whole console — map, live
 * feeds, doors, tracking — can be demoed and developed without hardware.
 *
 * A handful of simulated people walk the zone graph. Simulated cameras "see"
 * whoever is in the zones they cover and emit person.detected events with
 * appearance attributes, like UniFi Protect / CodeProject.AI analytics would.
 * Simulated doors lock, unlock, open, and log badge swipes.
 */

export interface SimActor {
  id: string;
  name: string;
  credential?: { id: string; name: string };
  appearance: Appearance;
  zoneId: string;
  floorId: string;
  position: Point;
  nextMoveAt: number;
  previousZone?: string;
}

export interface SimActorView {
  id: string;
  name: string;
  zoneId: string;
  floorId: string;
  x: number;
  y: number;
  upperColor?: string;
  lowerColor?: string;
}

type ZoneEnterListener = (actor: SimActor, zoneId: string, door?: IndexedDoor) => void;
type DoorListener = (doorId: string, status: DoorStatus, event?: { kind: "granted" | "opened" | "closed"; actor?: SimActor }) => void;

const UNLOCK_SECONDS = 5;

function randomIn<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

export class SimWorld {
  readonly actors: SimActor[] = [];
  readonly doors = new Map<string, DoorStatus>();
  private readonly relockTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private zoneListeners = new Set<ZoneEnterListener>();
  private doorListeners = new Set<DoorListener>();
  private timer?: ReturnType<typeof setInterval>;
  lockdown = false;
  private readonly graph: SiteGraph;

  constructor(graph: SiteGraph) {
    this.graph = graph;
    for (const door of graph.doors.values()) {
      if (door.source) this.doors.set(door.id, { lock: "locked", position: "closed", mode: "normal", updatedAt: new Date().toISOString() });
    }
    const interior = [...graph.zones.values()].filter((z) => z.kind !== "outdoor").map((z) => z.id);
    const people: Omit<SimActor, "zoneId" | "floorId" | "position" | "nextMoveAt">[] = [
      { id: "sim-visitor", name: "Unidentified visitor", appearance: { upperColor: "red", lowerColor: "black", tags: ["backpack"] } },
      { id: "sim-1", name: "J. Alvarez (staff)", credential: { id: "cred-1001", name: "J. Alvarez" }, appearance: { upperColor: "blue", lowerColor: "khaki" } },
      { id: "sim-2", name: "M. Chen (staff)", credential: { id: "cred-1002", name: "M. Chen" }, appearance: { upperColor: "red", lowerColor: "blue" } },
      { id: "sim-3", name: "R. Okafor (staff)", credential: { id: "cred-1003", name: "R. Okafor" }, appearance: { upperColor: "green", lowerColor: "black" } },
      { id: "sim-4", name: "Student", appearance: { upperColor: "gray", lowerColor: "blue", tags: ["backpack"] } },
      { id: "sim-5", name: "Student", appearance: { upperColor: "white", lowerColor: "black" } },
    ];
    // The unidentified visitor walks in through an entry area; everyone else starts somewhere inside.
    const entry = [...graph.zones.values()].find((z) => z.kind === "entry")?.id;
    for (const p of people) {
      const zoneId = p.id === "sim-visitor" && entry ? entry : randomIn(interior);
      this.actors.push({ ...p, zoneId, floorId: graph.zones.get(zoneId)!.floorId, position: this.pointIn(zoneId), nextMoveAt: Date.now() + 4000 + Math.random() * 12000 });
    }
  }

  start() {
    if (!this.timer) this.timer = setInterval(() => this.tick(), 500);
  }

  stop() {
    clearInterval(this.timer);
    this.timer = undefined;
    for (const t of this.relockTimers.values()) clearTimeout(t);
    this.zoneListeners.clear();
    this.doorListeners.clear();
  }

  onZoneEnter(fn: ZoneEnterListener) {
    this.zoneListeners.add(fn);
    return () => this.zoneListeners.delete(fn);
  }

  onDoor(fn: DoorListener) {
    this.doorListeners.add(fn);
    return () => this.doorListeners.delete(fn);
  }

  view(): SimActorView[] {
    return this.actors.map((a) => ({
      id: a.id,
      name: a.name,
      zoneId: a.zoneId,
      floorId: a.floorId,
      x: Math.round(a.position.x),
      y: Math.round(a.position.y),
      upperColor: a.appearance.upperColor,
      lowerColor: a.appearance.lowerColor,
    }));
  }

  private pointIn(zoneId: string): Point {
    const b = bounds(this.graph.zones.get(zoneId)!.polygon);
    const mx = Math.min(20, b.w / 4);
    const my = Math.min(20, b.h / 4);
    return { x: b.minX + mx + Math.random() * (b.w - 2 * mx), y: b.minY + my + Math.random() * (b.h - 2 * my) };
  }

  private setDoor(doorId: string, patch: Partial<DoorStatus>, event?: { kind: "granted" | "opened" | "closed"; actor?: SimActor }) {
    const current = this.doors.get(doorId);
    if (!current) return;
    const next = { ...current, ...patch, updatedAt: new Date().toISOString() };
    this.doors.set(doorId, next);
    for (const fn of this.doorListeners) fn(doorId, next, event);
  }

  // ----- door control (used by simulated access-control integrations) -----

  unlockMomentary(doorId: string) {
    const door = this.doors.get(doorId);
    if (!door || door.mode !== "normal") return;
    this.setDoor(doorId, { lock: "unlocked" });
    clearTimeout(this.relockTimers.get(doorId));
    this.relockTimers.set(
      doorId,
      setTimeout(() => {
        if (this.doors.get(doorId)?.mode === "normal") this.setDoor(doorId, { lock: "locked" });
      }, UNLOCK_SECONDS * 1000),
    );
  }

  setMode(doorId: string, mode: DoorStatus["mode"]) {
    clearTimeout(this.relockTimers.get(doorId));
    this.setDoor(doorId, { mode, lock: mode === "held-unlocked" ? "unlocked" : "locked" });
  }

  setLockdown(active: boolean) {
    this.lockdown = active;
    for (const doorId of this.doors.keys()) this.setMode(doorId, active ? "held-locked" : "normal");
  }

  // ----- movement -----

  private tick() {
    const now = Date.now();
    for (const actor of this.actors) {
      if (now < actor.nextMoveAt) {
        // Mill about inside the current zone.
        if (Math.random() < 0.15) {
          const target = this.pointIn(actor.zoneId);
          actor.position = { x: actor.position.x + (target.x - actor.position.x) * 0.3, y: actor.position.y + (target.y - actor.position.y) * 0.3 };
        }
        continue;
      }
      this.move(actor, now);
    }
  }

  private doorBetween(a: string, b: string): IndexedDoor | undefined {
    for (const d of this.graph.doors.values()) {
      if ((d.between[0] === a && d.between[1] === b) || (d.between[0] === b && d.between[1] === a)) return d;
    }
    return undefined;
  }

  private move(actor: SimActor, now: number) {
    const options = this.graph.neighbors(actor.zoneId).filter((z) => {
      const zone = this.graph.zones.get(z)!;
      if (zone.kind === "outdoor" && actor.id !== "sim-visitor" && Math.random() < 0.8) return false;
      const door = this.doorBetween(actor.zoneId, z);
      if (!door?.source) return true;
      const status = this.doors.get(door.id)!;
      if (status.lock === "unlocked") return true;
      // Locked controlled door: only people with a badge get through, and not during lockdown.
      return !!actor.credential && status.mode !== "held-locked";
    });
    const preferred = options.filter((z) => z !== actor.previousZone);
    const next = randomIn(preferred.length ? preferred : options);
    actor.nextMoveAt = now + 8000 + Math.random() * 16000;
    if (!next) return;

    const door = this.doorBetween(actor.zoneId, next);
    if (door?.source) {
      const badged = this.doors.get(door.id)!.lock === "locked";
      if (badged) this.setDoor(door.id, { lock: "unlocked" }, { kind: "granted", actor });
      this.setDoor(door.id, { position: "open" }, { kind: "opened", actor });
      setTimeout(() => {
        const s = this.doors.get(door.id);
        if (!s) return;
        const relock = badged && s.mode === "normal";
        this.setDoor(door.id, relock ? { position: "closed", lock: "locked" } : { position: "closed" }, { kind: "closed" });
      }, 2500);
    }

    actor.previousZone = actor.zoneId;
    actor.zoneId = next;
    actor.floorId = this.graph.zones.get(next)!.floorId;
    actor.position = door && door.floorId === actor.floorId ? { ...door.position } : this.pointIn(next);
    setTimeout(() => {
      if (actor.zoneId === next) actor.position = this.pointIn(next);
    }, 1200);
    for (const fn of this.zoneListeners) fn(actor, next, door);
  }
}

const worlds = new WeakMap<SiteGraph, SimWorld>();

export function simWorldFor(graph: SiteGraph): SimWorld {
  let world = worlds.get(graph);
  if (!world) {
    world = new SimWorld(graph);
    worlds.set(graph, world);
  }
  return world;
}

/**
 * Simulated stand-in for any integration. It offers whichever capabilities the
 * real driver would have, scoped to the devices on the map that reference this
 * integration id.
 */
export function createSimulatedIntegration(ctx: IntegrationContext, capabilities: string[]): Integration {
  const world = simWorldFor(ctx.graph);
  const id = ctx.config.id;
  const cameras = [...ctx.graph.cameras.values()].filter((c) => c.source.integration === id);
  const doors = [...ctx.graph.doors.values()].filter((d) => d.source?.integration === id);
  const doorByExternal = new Map(doors.map((d) => [d.source!.externalId, d]));
  const unsubscribers: (() => void)[] = [];

  function doorFor(externalId: string) {
    const door = doorByExternal.get(externalId);
    if (!door) throw new Error(`Unknown simulated door ${externalId}`);
    return door;
  }

  const integration: Integration = {
    async start() {
      ctx.setHealth("simulated", "Simulator — no real system configured");
      if (capabilities.includes("cameras") && cameras.length) {
        unsubscribers.push(
          world.onZoneEnter((actor, zoneId) => {
            for (const cam of cameras) {
              if (!cam.covers.includes(zoneId)) continue;
              ctx.emit({
                type: "person.detected",
                severity: "info",
                summary: `Person detected (${actor.appearance.upperColor} top, ${actor.appearance.lowerColor} bottom)`,
                externalCameraId: cam.source.externalId,
                zoneId,
                appearance: actor.appearance,
              });
            }
          }),
        );
      }
      if (capabilities.includes("access-control") && doors.length) {
        unsubscribers.push(
          world.onDoor((doorId, status, event) => {
            const door = ctx.graph.doors.get(doorId);
            if (!door || door.source?.integration !== id) return;
            ctx.doorChanged(door.source.externalId, status);
            if (event?.kind === "granted" && event.actor?.credential) {
              ctx.emit({
                type: "access.granted",
                severity: "info",
                summary: `Access granted — ${event.actor.credential.name}`,
                externalDoorId: door.source.externalId,
                person: event.actor.credential,
              });
            } else if (event?.kind === "opened" || event?.kind === "closed") {
              ctx.emit({ type: event.kind === "opened" ? "door.opened" : "door.closed", severity: "info", summary: `${door.name} ${event.kind}`, externalDoorId: door.source.externalId });
            }
          }),
        );
        for (const door of doors) ctx.doorChanged(door.source!.externalId, world.doors.get(door.id)!);
      }
      world.start();
    },
    async stop() {
      for (const u of unsubscribers) u();
    },
  };

  if (capabilities.includes("cameras")) {
    integration.cameras = {
      async listCameras() {
        return cameras.map((c) => ({ externalId: c.source.externalId, name: c.name, online: true }));
      },
      streamInfo: () => ({ kind: "simulated" }),
    };
  }
  if (capabilities.includes("access-control")) {
    integration.access = {
      async listDoors() {
        return doors.map((d) => ({ externalId: d.source!.externalId, name: d.name }));
      },
      async doorStatus(externalId) {
        return world.doors.get(doorFor(externalId).id)!;
      },
      async unlock(externalId) {
        world.unlockMomentary(doorFor(externalId).id);
      },
      async holdUnlocked(externalId) {
        world.setMode(doorFor(externalId).id, "held-unlocked");
      },
      async holdLocked(externalId) {
        world.setMode(doorFor(externalId).id, "held-locked");
      },
      async reset(externalId) {
        world.setMode(doorFor(externalId).id, "normal");
      },
      async setLockdown(active) {
        for (const door of doors) world.setMode(door.id, active ? "held-locked" : "normal");
      },
    };
  }
  if (capabilities.includes("alerts")) {
    integration.alerts = {
      async raiseAlert(alert, actor) {
        ctx.log(`[sim] alert sent by ${actor.name}: ${alert.title}`);
      },
    };
    integration.handleWebhook = async (request) => {
      const body = (await request.json().catch(() => ({}))) as { title?: string; message?: string };
      ctx.emit({ type: "alert.raised", severity: "critical", summary: `${body.title ?? "Simulated alert"}${body.message ? ` — ${body.message}` : ""}`, raw: body });
      return Response.json({ ok: true });
    };
  }
  if (capabilities.includes("paging")) {
    integration.paging = {
      async announce(a, actor) {
        ctx.log(`[sim] paging (${a.level}) by ${actor.name}: ${a.title} — ${a.message}`);
      },
      async stop() {},
    };
  }
  if (capabilities.includes("messaging")) {
    integration.messaging = {
      async send(message, displays, actor) {
        ctx.log(`[sim] message to ${displays.length ? displays.join(", ") : "all displays"} by ${actor.name}: ${message.title}`);
      },
      async clear() {},
    };
  }
  return integration;
}

export const simulatorDriver: IntegrationDriver = {
  id: "simulator",
  label: "Simulator",
  capabilities: ["cameras", "access-control", "alerts", "messaging", "paging"],
  requiredSettings: [],
  create: (ctx) => createSimulatedIntegration(ctx, ["cameras", "access-control", "alerts", "messaging", "paging"]),
};
