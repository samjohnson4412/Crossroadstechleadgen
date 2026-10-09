import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { sites } from "../../config/sites/index.ts";
import { drivers } from "../integrations/registry.ts";
import { createSimulatedIntegration, simWorldFor } from "../integrations/simulator.ts";
import type { Actor, DisplayMessage, DoorStatus, Integration, IntegrationDriver, IntegrationHealth, StreamInfo } from "../integrations/types.ts";
import { Tracker } from "../tracking/tracker.ts";
import { newId, type RawEvent, type SecurityEvent } from "./events.ts";
import { SiteGraph } from "./graph.ts";
import type { AuditEntry, IntegrationView, LiveMessage, LiveState } from "./live.ts";
import { loadOverrides, saveOverrides, type NamedKind, type SiteLayout, type SiteOverrides } from "./overrides.ts";
import type { IntegrationConfig, SiteConfig } from "./site.ts";

const MAX_EVENTS = 300;
const MAX_AUDIT = 200;

export type DoorAction = "unlock" | "hold-unlocked" | "hold-locked" | "reset";

interface RunningIntegration {
  config: IntegrationConfig;
  driver: IntegrationDriver;
  instance: Integration;
  simulated: boolean;
  health: IntegrationHealth;
}

function resolveSettings(config: IntegrationConfig) {
  const out: Record<string, string | number | boolean | undefined> = {};
  for (const [key, value] of Object.entries(config.settings)) {
    if (typeof value === "object") out[key] = process.env[value.env] || value.default || undefined;
    else out[key] = value;
  }
  return out;
}

/**
 * The live system: one per server process. Starts every integration (or its
 * simulator), normalizes their events onto the site map, keeps door state,
 * runs the tracker, and fans everything out to connected consoles.
 */
export class Runtime {
  site: SiteConfig;
  readonly graph: SiteGraph;
  readonly tracker: Tracker;
  readonly integrations = new Map<string, RunningIntegration>();
  readonly doors = new Map<string, DoorStatus>();
  readonly events: SecurityEvent[] = [];
  readonly audit: AuditEntry[] = [];
  lockdown = false;
  private readonly listeners = new Set<(msg: LiveMessage) => void>();
  private readonly cameraByExternal = new Map<string, string>();
  private readonly doorByExternal = new Map<string, string>();
  private simulating = false;
  private readonly auditFile = path.join(process.cwd(), "data", "audit.jsonl");
  private readonly overrides: SiteOverrides;

  private simTimer?: ReturnType<typeof setInterval>;

  constructor(site: SiteConfig) {
    this.site = structuredClone(site);
    this.overrides = loadOverrides();
    if (this.overrides.layout) {
      const edited = { ...this.site, ...structuredClone(this.overrides.layout) };
      try {
        validateSite(edited);
        this.site = edited;
      } catch (err) {
        console.error(`Ignoring saved map layout (${(err as Error).message}); using the config file's layout.`);
      }
    }
    for (const [key, name] of Object.entries(this.overrides.names)) {
      const [kind, id] = key.split(":") as [NamedKind, string];
      const item = this.findNamed(kind, id);
      if (item) item.name = name;
    }
    this.graph = new SiteGraph(this.site);
    this.tracker = new Tracker(this.graph);
    for (const c of this.graph.cameras.values()) this.cameraByExternal.set(`${c.source.integration}/${c.source.externalId}`, c.id);
    for (const d of this.graph.doors.values()) if (d.source) this.doorByExternal.set(`${d.source.integration}/${d.source.externalId}`, d.id);
  }

  async start() {
    const forceSim = process.env.SENTINEL_SIMULATE === "1";
    for (const config of this.site.integrations) {
      const driver = drivers[config.driver];
      if (!driver) throw new Error(`Integration ${config.id}: unknown driver "${config.driver}"`);
      const settings = resolveSettings(config);
      const missing = driver.requiredSettings.filter((k) => settings[k] === undefined || settings[k] === "");
      if (config.optional && missing.length > 0 && !forceSim) {
        // Not set up yet: list it (so it's visible in the integrations window) but don't run or simulate it.
        this.integrations.set(config.id, {
          config,
          driver,
          simulated: false,
          instance: { start: async () => {}, stop: async () => {} },
          health: { state: "unconfigured", detail: `Not set up — fill in ${missing.join(", ")}`, checkedAt: new Date().toISOString() },
        });
        continue;
      }
      const simulated = forceSim || missing.length > 0;
      const running = { config, driver, simulated, health: { state: "unconfigured", checkedAt: new Date().toISOString() } } as RunningIntegration;
      const ctx = {
        config,
        graph: this.graph,
        settings,
        emit: (raw: RawEvent) => this.ingest(config.id, raw),
        doorChanged: (externalId: string, status: DoorStatus) => this.doorChanged(config.id, externalId, status),
        setHealth: (state: IntegrationHealth["state"], detail?: string) => {
          running.health = { state, detail, checkedAt: new Date().toISOString() };
          this.broadcast({ type: "integration", integration: this.integrationView(running) });
        },
        log: (message: string) => console.log(`[${config.id}] ${message}`),
      };
      running.instance = simulated ? createSimulatedIntegration(ctx, driver.capabilities) : driver.create(ctx);
      this.integrations.set(config.id, running);
      if (simulated) {
        this.simulating = true;
        console.log(`[${config.id}] ${driver.label}: running simulator${missing.length ? ` (missing ${missing.join(", ")})` : ""}`);
      }
      running.instance.start().catch((err) => ctx.setHealth("offline", (err as Error).message));
    }
    if (this.simulating) {
      const world = simWorldFor(this.graph);
      this.simTimer = setInterval(() => this.broadcast({ type: "sim", actors: world.view() }), 1000);
    }
  }

  /** Shut down integrations and timers; open consoles are told to reconnect. */
  async stop() {
    clearInterval(this.simTimer);
    simWorldFor(this.graph).stop();
    for (const r of this.integrations.values()) await r.instance.stop().catch(() => {});
    this.broadcast({ type: "site" });
    this.listeners.clear();
  }

  /** Carry live state (tracks, events, audit) over from the runtime this one replaces. */
  adopt(old: Runtime) {
    this.events.push(...old.events);
    this.audit.push(...old.audit);
    this.lockdown = old.lockdown;
    for (const track of old.tracker.tracks.values()) {
      track.sightings = track.sightings.filter((s) => this.graph.zones.has(s.zoneId));
      track.suggestions = [];
      this.tracker.tracks.set(track.id, track);
    }
  }

  layout(): SiteLayout {
    return { buildings: this.site.buildings, passages: this.site.passages };
  }

  /** Save a layout drawn in the map editor, then restart on it. */
  async saveLayout(layout: SiteLayout, actor: Actor) {
    const candidate = { ...this.site, buildings: layout.buildings, passages: layout.passages };
    validateSite(candidate);
    await this.audited(actor, "layout.save", this.site.name, async () => {
      this.overrides.layout = structuredClone(layout);
      this.overrides.names = {}; // names are part of the saved layout now
      saveOverrides(this.overrides);
    });
    await reloadRuntime();
  }

  // ---------- live fan-out ----------

  subscribe(fn: (msg: LiveMessage) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private broadcast(msg: LiveMessage) {
    for (const fn of this.listeners) {
      try {
        fn(msg);
      } catch {
        this.listeners.delete(fn);
      }
    }
  }

  private integrationView(r: RunningIntegration): IntegrationView {
    return {
      id: r.config.id,
      name: r.config.name,
      driver: r.config.driver,
      driverLabel: r.driver.label,
      capabilities: r.driver.capabilities,
      simulated: r.simulated,
      health: r.health,
    };
  }

  snapshot(authConfigured: boolean): LiveState {
    const streams: Record<string, StreamInfo> = {};
    for (const cam of this.graph.cameras.values()) streams[cam.id] = this.streamInfo(cam.id);
    return {
      siteName: this.site.name,
      integrations: [...this.integrations.values()].map((r) => this.integrationView(r)),
      doors: Object.fromEntries(this.doors),
      streams,
      events: this.events.slice(-100),
      tracks: [...this.tracker.tracks.values()],
      audit: this.audit.slice(-50),
      lockdown: this.lockdown,
      sim: this.simulating ? simWorldFor(this.graph).view() : null,
      authConfigured,
    };
  }

  // ---------- inbound from integrations ----------

  private ingest(integrationId: string, raw: RawEvent) {
    const cameraId = raw.externalCameraId ? this.cameraByExternal.get(`${integrationId}/${raw.externalCameraId}`) : undefined;
    const doorId = raw.externalDoorId ? this.doorByExternal.get(`${integrationId}/${raw.externalDoorId}`) : undefined;
    let zoneId = raw.zoneId;
    if (!zoneId && cameraId) zoneId = this.graph.cameras.get(cameraId)?.covers[0];
    if (!zoneId && doorId) zoneId = this.graph.doors.get(doorId)?.between[1];
    const where = cameraId ? this.graph.cameras.get(cameraId)!.name : doorId ? this.graph.doors.get(doorId)!.name : undefined;
    const event: SecurityEvent = {
      id: newId("evt"),
      type: raw.type,
      at: raw.at ?? new Date().toISOString(),
      severity: raw.severity ?? "info",
      integration: integrationId,
      summary: where && !raw.summary.includes(where) ? `${where}: ${raw.summary}` : raw.summary,
      cameraId,
      doorId,
      zoneId,
      person: raw.person,
      appearance: raw.appearance,
      raw: raw.raw,
    };
    this.pushEvent(event);
  }

  private pushEvent(event: SecurityEvent) {
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) this.events.splice(0, this.events.length - MAX_EVENTS);
    this.broadcast({ type: "event", event });
    for (const track of this.tracker.ingest(event)) this.broadcast({ type: "track", track });
  }

  private doorChanged(integrationId: string, externalId: string, status: DoorStatus) {
    const doorId = this.doorByExternal.get(`${integrationId}/${externalId}`);
    if (!doorId) return; // a door the vendor knows about that isn't on the map yet
    this.doors.set(doorId, status);
    this.broadcast({ type: "door", doorId, status });
  }

  // ---------- operator actions (all audited) ----------

  private async audited<T>(actor: Actor, action: string, target: string | undefined, fn: () => Promise<T>): Promise<T> {
    const entry: AuditEntry = { at: new Date().toISOString(), actor: actor.name, action, target, ok: true };
    try {
      return await fn();
    } catch (err) {
      entry.ok = false;
      entry.error = (err as Error).message;
      throw err;
    } finally {
      this.audit.push(entry);
      if (this.audit.length > MAX_AUDIT) this.audit.splice(0, this.audit.length - MAX_AUDIT);
      this.broadcast({ type: "audit", entry });
      mkdir(path.dirname(this.auditFile), { recursive: true })
        .then(() => appendFile(this.auditFile, JSON.stringify(entry) + "\n"))
        .catch((err) => console.error("audit write failed", err));
    }
  }

  streamInfo(cameraId: string): StreamInfo {
    const cam = this.graph.cameras.get(cameraId);
    if (!cam) return { kind: "unavailable", reason: "Unknown camera" };
    const cams = this.integrations.get(cam.source.integration)?.instance.cameras;
    if (!cams) return { kind: "unavailable", reason: `Integration ${cam.source.integration} has no camera capability` };
    return cams.streamInfo(cam.source.externalId, cam.id);
  }

  async proxyStream(cameraId: string, signal: AbortSignal): Promise<Response> {
    const cam = this.graph.cameras.get(cameraId);
    const cams = cam && this.integrations.get(cam.source.integration)?.instance.cameras;
    if (!cam || !cams?.proxyStream) return new Response("No stream", { status: 404 });
    return cams.proxyStream(cam.source.externalId, signal);
  }

  async doorAction(doorId: string, action: DoorAction, actor: Actor) {
    const door = this.graph.doors.get(doorId);
    if (!door?.source) throw new Error("Door is not connected to access control");
    const access = this.integrations.get(door.source.integration)?.instance.access;
    if (!access) throw new Error(`Integration ${door.source.integration} cannot control doors`);
    const id = door.source.externalId;
    await this.audited(actor, `door.${action}`, door.name, async () => {
      if (action === "unlock") await access.unlock(id, actor);
      else if (action === "hold-unlocked") await access.holdUnlocked(id, actor);
      else if (action === "hold-locked") await access.holdLocked(id, actor);
      else await access.reset(id, actor);
    });
  }

  async setLockdown(active: boolean, actor: Actor) {
    await this.audited(actor, active ? "lockdown.start" : "lockdown.end", this.site.name, async () => {
      const failures: string[] = [];
      for (const r of this.integrations.values()) {
        const access = r.instance.access;
        if (!access) continue;
        try {
          if (access.setLockdown) await access.setLockdown(active, actor);
          else {
            for (const door of this.graph.doors.values()) {
              if (door.source?.integration !== r.config.id) continue;
              await (active ? access.holdLocked(door.source.externalId, actor) : access.reset(door.source.externalId, actor));
            }
          }
        } catch (err) {
          failures.push(`${r.config.name}: ${(err as Error).message}`);
        }
      }
      this.lockdown = active;
      this.broadcast({ type: "lockdown", active });
      this.pushEvent({
        id: newId("evt"),
        type: active ? "alert.raised" : "alert.cleared",
        at: new Date().toISOString(),
        severity: active ? "critical" : "notice",
        integration: "console",
        summary: `${active ? "LOCKDOWN initiated" : "Lockdown lifted"} by ${actor.name}`,
      });
      if (failures.length) throw new Error(failures.join("; "));
    });
  }

  async sendMessage(message: DisplayMessage, displayIds: string[], actor: Actor) {
    const targets = displayIds.length ? displayIds.map((id) => this.graph.displays.get(id)).filter((d) => !!d) : [...this.graph.displays.values()];
    const byIntegration = new Map<string, string[]>();
    for (const d of targets) byIntegration.set(d.source.integration, [...(byIntegration.get(d.source.integration) ?? []), d.source.externalId]);
    await this.audited(actor, "message.send", `${targets.length} display(s): ${message.title}`, async () => {
      for (const [integrationId, externalIds] of byIntegration) {
        const messaging = this.integrations.get(integrationId)?.instance.messaging;
        if (!messaging) throw new Error(`Integration ${integrationId} cannot send messages`);
        // Empty list = "all displays" for that integration, used when the operator targets everything.
        await messaging.send(message, displayIds.length ? externalIds : [], actor);
      }
      this.pushEvent({
        id: newId("evt"),
        type: "message.sent",
        at: new Date().toISOString(),
        severity: message.level === "emergency" ? "critical" : message.level === "warning" ? "warning" : "notice",
        integration: "console",
        summary: `Message "${message.title}" sent to ${displayIds.length ? `${targets.length} display(s)` : "all displays"} by ${actor.name}`,
      });
    });
  }

  async raiseAlert(alert: { title: string; detail: string; zoneId?: string }, actor: Actor) {
    await this.audited(actor, "alert.raise", alert.title, async () => {
      for (const r of this.integrations.values()) await r.instance.alerts?.raiseAlert?.(alert, actor);
      this.pushEvent({
        id: newId("evt"),
        type: "alert.raised",
        at: new Date().toISOString(),
        severity: "critical",
        integration: "console",
        zoneId: alert.zoneId,
        summary: `${alert.title}${alert.detail ? ` — ${alert.detail}` : ""} (raised by ${actor.name})`,
      });
    });
  }

  async webhook(integrationId: string, request: Request): Promise<Response> {
    const r = this.integrations.get(integrationId);
    if (!r?.instance.handleWebhook) return Response.json({ error: "No webhook for this integration" }, { status: 404 });
    return r.instance.handleWebhook(request);
  }

  private findNamed(kind: NamedKind, id: string): { name: string } | undefined {
    for (const b of this.site.buildings)
      for (const f of b.floors) {
        const list = kind === "zone" ? f.zones : kind === "camera" ? f.cameras : kind === "door" ? f.doors : f.displays;
        const hit = (list as { id: string; name: string }[]).find((x) => x.id === id);
        if (hit) return hit;
      }
    return undefined;
  }

  /** Rename a room, camera, door or display. Saved, and pushed to every open console. */
  async rename(kind: NamedKind, id: string, name: string, actor: Actor) {
    const clean = name.trim().slice(0, 80);
    if (!clean) throw new Error("Name can't be empty");
    const item = this.findNamed(kind, id);
    if (!item) throw new Error(`Unknown ${kind} ${id}`);
    await this.audited(actor, `rename.${kind}`, `${item.name} → ${clean}`, async () => {
      item.name = clean;
      const graphMap = kind === "zone" ? this.graph.zones : kind === "camera" ? this.graph.cameras : kind === "door" ? this.graph.doors : this.graph.displays;
      const indexed = graphMap.get(id);
      if (indexed) indexed.name = clean;
      this.overrides.names[`${kind}:${id}`] = clean;
      saveOverrides(this.overrides);
      this.broadcast({ type: "site" });
    });
  }

  /** Called after any tracker mutation from the API. */
  trackChanged(trackId: string) {
    this.broadcast({ type: "track", track: this.tracker.get(trackId) });
  }

  async listVendorDevices(integrationId: string) {
    const r = this.integrations.get(integrationId);
    if (!r) throw new Error("Unknown integration");
    return {
      cameras: r.instance.cameras ? await r.instance.cameras.listCameras() : undefined,
      doors: r.instance.access ? await r.instance.access.listDoors() : undefined,
    };
  }
}

/** Throws if a layout is unusable: unknown zone references, duplicate ids, empty shapes. */
export function validateSite(site: SiteConfig) {
  const ids = new Set<string>();
  for (const b of site.buildings)
    for (const f of b.floors)
      for (const item of [...f.zones, ...f.cameras, ...f.doors, ...f.displays]) {
        if (!item.id || ids.has(item.id)) throw new Error(`Duplicate or missing id "${item.id}"`);
        ids.add(item.id);
        if (!item.name?.trim()) throw new Error(`"${item.id}" needs a name`);
      }
  for (const b of site.buildings)
    for (const f of b.floors)
      for (const z of f.zones) if (z.polygon.length < 3) throw new Error(`Room "${z.name}" needs at least 3 corners`);
  new SiteGraph(site); // checks every door, passage and camera references real rooms
}

const globalForRuntime = globalThis as unknown as { __sentinel?: Promise<Runtime> };

function baseSite(): SiteConfig {
  const siteId = process.env.SENTINEL_SITE ?? "ccc";
  const site = sites[siteId];
  if (!site) throw new Error(`Unknown SENTINEL_SITE "${siteId}". Known: ${Object.keys(sites).join(", ")}`);
  return site;
}

/** Process-wide runtime (survives dev hot reloads). */
export function getRuntime(): Promise<Runtime> {
  if (!globalForRuntime.__sentinel) {
    const runtime = new Runtime(baseSite());
    globalForRuntime.__sentinel = runtime.start().then(() => runtime);
  }
  return globalForRuntime.__sentinel;
}

/** Rebuild the runtime from the current config + saved overrides, keeping tracks and history. */
export async function reloadRuntime(): Promise<Runtime> {
  const old = await getRuntime();
  const next = new Runtime(baseSite());
  next.adopt(old);
  await old.stop();
  globalForRuntime.__sentinel = next.start().then(() => next);
  return globalForRuntime.__sentinel;
}
