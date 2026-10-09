import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { sites } from "../../config/sites/index.ts";
import { drivers } from "../integrations/registry.ts";
import { createSimulatedIntegration, simWorldFor } from "../integrations/simulator.ts";
import type { Actor, DisplayMessage, DoorStatus, Integration, IntegrationDriver, IntegrationHealth, StreamInfo } from "../integrations/types.ts";
import { Tracker } from "../tracking/tracker.ts";
import type { Alert, AlertChannel, AlertDelivery, AlertSpec } from "./alerts.ts";
import { newId, type RawEvent, type SecurityEvent } from "./events.ts";
import { SiteGraph } from "./graph.ts";
import type { AuditEntry, IntegrationView, LiveMessage, LiveState } from "./live.ts";
import { loadSettings, resolveIntegrationSettings, saveSettings } from "./settingsStore.ts";
import { fieldInfo } from "../integrations/fields.ts";
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
  return resolveIntegrationSettings(config).values;
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
  readonly alerts: Alert[] = [];
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
      const running = { config, driver, simulated, health: { state: "connecting", checkedAt: new Date().toISOString() } } as RunningIntegration;
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
    // Learn which server has which camera, then keep that current.
    setTimeout(() => this.refreshVendorCameras().then(() => this.broadcast({ type: "site" })).catch(() => {}), 3000);
    this.cameraRefresh = setInterval(() => this.refreshVendorCameras().catch(() => {}), 5 * 60_000);
    if (this.simulating) {
      const world = simWorldFor(this.graph);
      this.simTimer = setInterval(() => this.broadcast({ type: "sim", actors: world.view() }), 1000);
    }
  }

  /** Shut down integrations and timers; open consoles are told to reconnect. */
  async stop() {
    clearInterval(this.simTimer);
    clearInterval(this.cameraRefresh);
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
    this.alerts.push(...old.alerts);
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
      alerts: this.alerts.slice(-20),
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

  /** Which camera server actually has each externalId (refreshed from the servers' camera lists). */
  private vendorCameras = new Map<string, Set<string>>();
  private cameraRefresh?: ReturnType<typeof setInterval>;

  async refreshVendorCameras() {
    for (const [id, r] of this.integrations) {
      if (!r.instance.cameras || r.simulated || r.health.state === "unconfigured") continue;
      try {
        const list = await r.instance.cameras.listCameras();
        this.vendorCameras.set(id, new Set(list.map((c) => c.externalId)));
      } catch {
        // keep the last known list
      }
    }
  }

  /**
   * The integration to use for a map camera: the one it was placed with, unless that server
   * doesn't have it and another camera server does (e.g. servers swapped in .env.local).
   */
  private cameraRoute(cameraId: string) {
    const cam = this.graph.cameras.get(cameraId);
    if (!cam) return undefined;
    const { integration, externalId } = cam.source;
    const declared = this.vendorCameras.get(integration);
    if (!declared?.has(externalId)) {
      for (const [id, ids] of this.vendorCameras) if (ids.has(externalId)) return { cam, integrationId: id, running: this.integrations.get(id)! };
    }
    return { cam, integrationId: integration, running: this.integrations.get(integration) };
  }

  streamInfo(cameraId: string): StreamInfo {
    const route = this.cameraRoute(cameraId);
    if (!route) return { kind: "unavailable", reason: "Unknown camera" };
    const { cam, running, integrationId } = route;
    if (running?.health.state === "unconfigured") return { kind: "unavailable", reason: `${running.config.name} isn't set up yet` };
    const cams = running?.instance.cameras;
    if (!cams) return { kind: "unavailable", reason: `Integration ${integrationId} has no camera capability` };
    return cams.streamInfo(cam.source.externalId, cam.id);
  }

  async proxyStream(cameraId: string, signal: AbortSignal): Promise<Response> {
    const route = this.cameraRoute(cameraId);
    const cams = route?.running?.instance.cameras;
    if (!route || !cams?.proxyStream) return new Response("No stream", { status: 404 });
    return cams.proxyStream(route.cam.source.externalId, signal);
  }

  async cameraSnapshot(cameraId: string, width?: number): Promise<Response> {
    const route = this.cameraRoute(cameraId);
    const cams = route?.running?.instance.cameras;
    if (!route || !cams?.snapshot) return new Response("No snapshot", { status: 404 });
    return cams.snapshot(route.cam.source.externalId, width);
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

  // ---------- mass notification ----------

  /** Send one alert to the chosen areas over every chosen channel at once. */
  async sendAlert(spec: AlertSpec, actor: Actor): Promise<Alert> {
    if (!spec.title?.trim()) throw new Error("The alert needs a title");
    if (!spec.channels?.length) throw new Error("Pick at least one way to send the alert");
    if (spec.zoneIds) for (const z of spec.zoneIds) if (!this.graph.zones.has(z)) throw new Error(`Unknown area ${z}`);
    const alert: Alert = { ...spec, title: spec.title.trim(), id: newId("alr"), at: new Date().toISOString(), by: actor.name, status: "active", deliveries: [] };
    this.alerts.push(alert);
    if (this.alerts.length > 50) this.alerts.splice(0, this.alerts.length - 50);
    this.broadcast({ type: "alert", alert });
    await this.audited(actor, `alert.${spec.presetId}`, `${alert.title} → ${spec.scopeLabel}`, async () => {
      alert.deliveries = await this.deliver(alert, actor, false);
    });
    this.pushEvent({
      id: newId("evt"),
      type: "alert.raised",
      at: alert.at,
      severity: spec.level === "emergency" ? "critical" : spec.level === "warning" ? "warning" : "notice",
      integration: "console",
      summary: `${alert.title} — ${spec.scopeLabel} (sent by ${actor.name})`,
    });
    this.broadcast({ type: "alert", alert });
    return alert;
  }

  /** End an alert: sends "all clear" on the same channels to the same areas. */
  async clearAlert(id: string, actor: Actor, options: { liftLockdown?: boolean } = {}) {
    const alert = this.alerts.find((a) => a.id === id);
    if (!alert) throw new Error("Alert not found");
    if (alert.status === "cleared") return alert;
    await this.audited(actor, "alert.clear", `${alert.title} → ${alert.scopeLabel}`, async () => {
      const clearDeliveries = await this.deliver(alert, actor, true, options.liftLockdown);
      alert.deliveries.push(...clearDeliveries.map((d) => ({ ...d, detail: `All clear: ${d.detail ?? d.status}` })));
    });
    alert.status = "cleared";
    alert.clearedAt = new Date().toISOString();
    alert.clearedBy = actor.name;
    this.pushEvent({
      id: newId("evt"),
      type: "alert.cleared",
      at: alert.clearedAt,
      severity: "notice",
      integration: "console",
      summary: `All clear: ${alert.title} — ${alert.scopeLabel} (by ${actor.name})`,
    });
    this.broadcast({ type: "alert", alert });
    return alert;
  }

  private async deliver(alert: Alert, actor: Actor, allClear: boolean, liftLockdown = false): Promise<AlertDelivery[]> {
    const zones = alert.zoneIds ? new Set(alert.zoneIds) : null;
    const title = allClear ? "ALL CLEAR" : alert.title;
    const message = allClear ? `All clear. ${alert.title} has ended. Resume normal activity.` : alert.message;
    const level = allClear ? "info" : alert.level;
    const tasks: Promise<AlertDelivery>[] = [];
    const attempt = (channel: AlertChannel, r: RunningIntegration, fn: () => Promise<string | void>) =>
      tasks.push(
        fn().then(
          (detail) => ({ channel, system: r.config.name, status: r.simulated ? ("simulated" as const) : ("sent" as const), detail: detail || undefined }),
          (err) => ({ channel, system: r.config.name, status: "failed" as const, detail: (err as Error).message }),
        ),
      );
    const skipped = (channel: AlertChannel, system: string, detail: string) => tasks.push(Promise.resolve({ channel, system, status: "skipped", detail }));
    const live = [...this.integrations.values()].filter((r) => r.health.state !== "unconfigured");

    for (const channel of alert.channels) {
      if (channel === "displays") {
        const systems = live.filter((r) => r.instance.messaging);
        if (!systems.length) skipped(channel, "SMART Boards", "No display system connected");
        for (const r of systems) {
          const mapped = [...this.graph.displays.values()].filter((d) => d.source.integration === r.config.id);
          const targets = zones ? mapped.filter((d) => zones.has(d.zoneId)) : mapped;
          if (zones && !targets.length) {
            skipped(channel, r.config.name, "No SMART Boards are placed in the chosen areas yet");
            continue;
          }
          // Campus-wide with no boards mapped yet: ask the system to show it on all its boards.
          attempt(channel, r, async () => {
            await r.instance.messaging!.send({ title, body: message, level }, targets.map((d) => d.source.externalId), actor);
            return targets.length ? `${targets.length} board(s)` : "all boards";
          });
        }
      } else if (channel === "paging") {
        const systems = live.filter((r) => r.instance.paging);
        if (!systems.length) skipped(channel, "Paging", "No speaker / paging system connected");
        for (const r of systems) attempt(channel, r, () => r.instance.paging!.announce({ title, message, level, presetId: allClear ? "all-clear" : alert.presetId, zoneIds: alert.zoneIds }, actor));
      } else if (channel === "saferwatch") {
        const systems = live.filter((r) => r.instance.alerts);
        if (!systems.length) skipped(channel, "SaferWatch", "SaferWatch not connected");
        for (const r of systems) {
          if (!r.instance.alerts!.raiseAlert) {
            skipped(channel, r.config.name, "Sending to SaferWatch isn't set up (no outbound URL)");
            continue;
          }
          attempt(channel, r, () => r.instance.alerts!.raiseAlert!({ title, detail: `${message} [${alert.scopeLabel}]`, zoneId: alert.zoneIds?.[0] }, actor));
        }
      } else if (channel === "lockdown") {
        if (allClear && !liftLockdown) {
          skipped(channel, "Doors", "Doors left locked — lift the lockdown separately when safe");
          continue;
        }
        tasks.push(
          this.setLockdown(!allClear, actor).then(
            () => ({ channel, system: "Doors", status: "sent" as const, detail: allClear ? "Lockdown lifted" : "All controlled doors held locked" }),
            (err) => ({ channel, system: "Doors", status: "failed" as const, detail: (err as Error).message }),
          ),
        );
      }
    }
    return Promise.all(tasks);
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

  /** Settings page view: every integration's fields, with secrets reduced to "is it set". */
  settingsView() {
    const stored = loadSettings();
    return this.site.integrations.map((config) => {
      const r = this.integrations.get(config.id);
      const { values, sources } = resolveIntegrationSettings(config, stored);
      return {
        id: config.id,
        name: config.name,
        driver: config.driver,
        driverLabel: r?.driver.label ?? config.driver,
        health: r?.health,
        simulated: r?.simulated ?? false,
        optional: !!config.optional,
        required: drivers[config.driver]?.requiredSettings ?? [],
        fields: Object.keys(config.settings).map((key) => {
          const info = fieldInfo(config.driver, key);
          const secret = info.type === "password";
          const value = values[key];
          return {
            key,
            ...info,
            source: sources[key],
            isSet: value !== undefined && value !== "",
            value: secret ? undefined : value === undefined ? "" : String(value),
          };
        }),
      };
    });
  }

  /** Save Settings-page values for one integration and reconnect. "" clears a value (falls back to .env.local/default); omitted keys are unchanged. */
  async saveIntegrationSettings(integrationId: string, values: Record<string, string>, actor: Actor) {
    const config = this.site.integrations.find((c) => c.id === integrationId);
    if (!config) throw new Error("Unknown integration");
    const stored = loadSettings();
    const current = { ...(stored.integrations[integrationId] ?? {}) };
    const changed: string[] = [];
    for (const [key, value] of Object.entries(values)) {
      if (!(key in config.settings)) throw new Error(`Unknown setting "${key}"`);
      const v = String(value).trim();
      if (v) current[key] = v;
      else delete current[key];
      changed.push(key);
    }
    stored.integrations[integrationId] = current;
    await this.audited(actor, "settings.save", `${config.name}: ${changed.join(", ") || "no changes"}`, async () => saveSettings(stored));
    await reloadRuntime();
  }

  /** What a connection check needs: which settings are filled in (never their values), health, and the driver's own test. */
  async checkIntegration(integrationId: string) {
    const r = this.integrations.get(integrationId);
    if (!r) throw new Error("Unknown integration");
    const settings = resolveIntegrationSettings(r.config).sources;
    return {
      integration: r.config.name,
      driver: r.driver.label,
      simulated: r.simulated,
      health: r.health,
      settings,
      test: r.simulated || r.health.state === "unconfigured" ? "skipped" : await r.instance.diagnose?.(),
    };
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
