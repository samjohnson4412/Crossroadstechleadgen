import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { sites } from "../../config/sites/index.ts";
import { drivers } from "../integrations/registry.ts";
import { createSimulatedIntegration, simWorldFor } from "../integrations/simulator.ts";
import type { Actor, DisplayMessage, DoorStatus, Integration, IntegrationDriver, IntegrationHealth, StreamInfo } from "../integrations/types.ts";
import { Tracker } from "../tracking/tracker.ts";
import type { Alert, AlertChannel, AlertDelivery, AlertSpec } from "./alerts.ts";
import type { WatchEntry, WatchHit } from "./watchlist.ts";
import { isRoutine, type Incident, type IncidentItem } from "./incidents.ts";
import { normalizePhone, type Contact, type NotifyTopic } from "./contacts.ts";
import { DEFAULT_RULES, evaluateRules, topSeverity, type Detection, type DetectionRule } from "./detections.ts";
import { appendLine, dataDir, pruneFolder, readJson, readJsonLines, siteFile, writeJsonSoon } from "./files.ts";
import { newId, type RawEvent, type SecurityEvent } from "./events.ts";
import { SiteGraph } from "./graph.ts";
import type { AuditEntry, IntegrationView, LiveMessage, LiveState } from "./live.ts";
import { loadSettings, resolveIntegrationSettings, saveSettings } from "./settingsStore.ts";
import { fieldInfo } from "../integrations/fields.ts";
import { loadOverrides, saveOverrides, type NamedKind, type SiteLayout, type SiteOverrides } from "./overrides.ts";
import type { IntegrationConfig, SiteConfig } from "./site.ts";

const MAX_EVENTS = 300;
const MAX_AUDIT = 200;
const MAX_DETECTIONS = 500;
const MAX_BADGES = 50_000;

export interface BadgeEvent {
  at: string;
  cardId: string;
  name?: string;
  doorId?: string;
  doorName?: string;
  zoneId?: string;
  granted: boolean;
  action: string;
}

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
  readonly detections: Detection[] = readJson<Detection[]>(siteFile("detections"), []);
  rules: DetectionRule[] = readJson<DetectionRule[]>(siteFile("rules"), DEFAULT_RULES);
  contacts: Contact[] = readJson<Contact[]>(siteFile("contacts"), []);
  watchlist: WatchEntry[] = readJson<WatchEntry[]>(siteFile("watchlist"), []);
  readonly watchHits: WatchHit[] = [];
  readonly incidents: Incident[] = readJson<Incident[]>(siteFile("incidents"), []);
  private recentTexts = new Map<string, number>();
  /** Badge swipes (granted and denied) — kept on disk so "where has this person been" survives restarts. */
  readonly badges: BadgeEvent[] = readJsonLines<BadgeEvent>(siteFile("badges", "jsonl"), MAX_BADGES);
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
          const was = running.health?.state;
          running.health = { state, detail, checkedAt: new Date().toISOString() };
          if (state === "offline" && was && was !== "offline" && !running.simulated) {
            this.notify("system", `${config.name} went OFFLINE${detail ? `: ${detail}` : ""}`, `offline:${config.id}`);
          } else if (state === "ok" && was === "offline" && !running.simulated) {
            this.notify("system", `${config.name} is back online`, `online:${config.id}`);
          }
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
    this.watchHits.push(...old.watchHits);
    this.incidents.splice(0, this.incidents.length, ...old.incidents);
    this.detections.splice(0, this.detections.length, ...old.detections);
    this.badges.splice(0, this.badges.length, ...old.badges);
    this.rules = old.rules;
    for (const track of old.tracker.tracks.values()) {
      track.sightings = track.sightings.filter((s) => this.graph.zones.has(s.zoneId));
      track.suggestions = [];
      this.tracker.tracks.set(track.id, track);
    }
  }

  layout(): SiteLayout {
    return { buildings: this.site.buildings, passages: this.site.passages, parked: this.site.parked };
  }

  /** Save a layout drawn in the map editor, then restart on it. */
  async saveLayout(layout: SiteLayout, actor: Actor) {
    const candidate = { ...this.site, buildings: layout.buildings, passages: layout.passages, parked: layout.parked };
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
      detections: this.detections.slice(-100),
      watchHits: this.watchHits.slice(-20),
      incident: this.openIncident() ?? null,
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
      labels: raw.labels,
      raw: raw.raw,
    };
    this.pushEvent(event);
    if (raw.labels?.length && raw.externalCameraId) this.recordDetection(integrationId, raw.externalCameraId, event);
    if (raw.person && (event.type === "access.granted" || event.type === "access.denied")) this.recordBadge(event, raw);
  }

  // ---------- text messages ----------

  /**
   * Text everyone subscribed to `topic`. `dedupeKey` stops the same thing being texted
   * more than once in 2 minutes (e.g. a door that keeps reporting forced).
   */
  async notify(topic: NotifyTopic, text: string, dedupeKey = text): Promise<{ sent: number; failed: string[]; simulated: boolean; system?: string }> {
    const key = `${topic}:${dedupeKey}`;
    const last = this.recentTexts.get(key);
    if (last && Date.now() - last < 120_000) return { sent: 0, failed: [], simulated: false };
    this.recentTexts.set(key, Date.now());
    const to = this.contacts.filter((c) => c.enabled && c.topics.includes(topic)).map((c) => c.phone);
    const r = [...this.integrations.values()].find((x) => x.instance.sms && x.health.state !== "unconfigured");
    if (!r || !to.length) return { sent: 0, failed: [], simulated: false, system: r?.config.name };
    const body = `[${this.site.name}] ${text}`;
    try {
      const out = await r.instance.sms!.send(to, body);
      return { ...out, simulated: r.simulated, system: r.config.name };
    } catch (err) {
      console.error("SMS failed", err);
      return { sent: 0, failed: [(err as Error).message], simulated: r.simulated, system: r.config.name };
    }
  }

  async saveContacts(contacts: Contact[], actor: Actor) {
    const clean = contacts.map((c) => {
      const phone = normalizePhone(c.phone);
      if (!c.name?.trim()) throw new Error("Every contact needs a name");
      if (!phone) throw new Error(`"${c.phone}" doesn't look like a phone number`);
      return { id: c.id || newId("con"), name: c.name.trim(), phone, topics: c.topics, enabled: c.enabled !== false };
    });
    await this.audited(actor, "contacts.save", `${clean.length} contact(s)`, async () => {
      this.contacts = clean;
      writeJsonSoon(siteFile("contacts"), () => this.contacts);
    });
    return this.contacts;
  }

  async testText(contactId: string, actor: Actor) {
    const c = this.contacts.find((x) => x.id === contactId);
    if (!c) throw new Error("Save the contact first");
    const r = [...this.integrations.values()].find((x) => x.instance.sms && x.health.state !== "unconfigured");
    if (!r) throw new Error("No text-message system set up (Settings → Text messages)");
    const out = await r.instance.sms!.send([c.phone], `[${this.site.name}] Test message from the security console, sent by ${actor.name}.`);
    return { ...out, simulated: r.simulated };
  }

  // ---------- detections ----------

  private recordDetection(integrationId: string, externalCameraId: string, event: SecurityEvent) {
    const cam = event.cameraId ? this.graph.cameras.get(event.cameraId) : undefined;
    const det: Detection = {
      id: newId("det"),
      at: event.at,
      integration: integrationId,
      externalCameraId,
      cameraId: event.cameraId,
      zoneId: event.zoneId,
      labels: event.labels ?? [],
      summary: `${cam?.name ?? externalCameraId}: ${(event.labels ?? []).map((l) => `${l.label}${l.confidence !== undefined ? ` ${Math.round(l.confidence)}%` : ""}`).join(", ")}`,
      hasSnapshot: false,
      ruleHits: [],
      severity: "info",
      status: "new",
    };
    det.ruleHits = evaluateRules(this.rules, det, this.detections.slice(-200), cam?.covers ?? []);
    det.severity = det.ruleHits.length ? topSeverity(det.ruleHits) : "info";
    this.detections.push(det);
    if (this.detections.length > MAX_DETECTIONS) this.detections.splice(0, this.detections.length - MAX_DETECTIONS);
    this.saveDetections();
    this.broadcast({ type: "detection", detection: det });
    if (det.ruleHits.length) {
      this.addToIncident({ at: det.at, kind: "detection", text: `${det.ruleHits.map((h) => h.name).join(", ")} — ${det.summary}`, severity: det.severity, cameraId: det.cameraId, detectionId: det.id });
    }
    if (det.severity === "critical") {
      this.notify("critical", `${det.ruleHits.map((h) => h.name).join(", ")} — ${det.summary}. Open the console to review.`, det.id);
    }
    if (det.ruleHits.length) {
      this.pushEvent({
        id: newId("evt"),
        type: "object.detected",
        at: det.at,
        severity: det.severity === "critical" ? "critical" : "warning",
        integration: "detections",
        cameraId: det.cameraId,
        zoneId: det.zoneId,
        summary: `${det.ruleHits.map((h) => h.name).join(", ")} — ${det.summary}`,
      });
    }
    // Save a still for review (best effort, doesn't hold anything up).
    const cams = this.integrations.get(integrationId)?.instance.cameras;
    if (cams?.snapshot) {
      cams
        .snapshot(externalCameraId, 960)
        .then(async (res) => {
          if (!res.ok) return;
          const dir = dataDir("detections");
          await mkdir(dir, { recursive: true });
          await writeFile(`${dir}/${det.id}.jpg`, Buffer.from(await res.arrayBuffer()));
          det.hasSnapshot = true;
          this.saveDetections();
          this.broadcast({ type: "detection", detection: det });
          await pruneFolder(dir, MAX_DETECTIONS);
        })
        .catch(() => {});
    }
  }

  private saveDetections() {
    writeJsonSoon(siteFile("detections"), () => this.detections);
  }

  async detectionSnapshot(id: string): Promise<Buffer | null> {
    if (!/^det_[a-z0-9]+$/.test(id)) return null;
    return readFile(dataDir("detections", `${id}.jpg`)).catch(() => null);
  }

  async reviewDetection(id: string, status: "real" | "false" | "new", actor: Actor) {
    const det = this.detections.find((d) => d.id === id);
    if (!det) throw new Error("Detection not found");
    det.status = status;
    det.reviewedBy = status === "new" ? undefined : actor.name;
    det.reviewedAt = status === "new" ? undefined : new Date().toISOString();
    this.saveDetections();
    this.broadcast({ type: "detection", detection: det });
    if (status !== "new") this.audit.push({ at: det.reviewedAt!, actor: actor.name, action: `detection.${status}`, target: det.summary, ok: true });
    return det;
  }

  async saveRules(rules: DetectionRule[], actor: Actor) {
    for (const r of rules) {
      if (!r.id || !r.name?.trim()) throw new Error("Every rule needs a name");
      if (!["info", "warning", "critical"].includes(r.severity)) throw new Error(`Rule "${r.name}": bad severity`);
      for (const z of r.zoneIds ?? []) if (!this.graph.zones.has(z)) throw new Error(`Rule "${r.name}": unknown area ${z}`);
    }
    await this.audited(actor, "rules.save", `${rules.length} rule(s)`, async () => {
      this.rules = rules.map((r) => ({ ...r, labels: r.labels.map((l) => l.trim().toLowerCase()).filter(Boolean), count: Math.max(1, r.count || 1), minutes: Math.max(1, r.minutes || 1) }));
      writeJsonSoon(siteFile("rules"), () => this.rules);
    });
  }

  /** Feed a made-up detection through the real pipeline (for checking rules and alerts). */
  testDetection(cameraId: string, labels: { label: string; confidence?: number }[]) {
    const cam = this.graph.cameras.get(cameraId);
    if (!cam) throw new Error("Pick a camera on the map");
    this.ingest(cam.source.integration, {
      type: labels.some((l) => l.label === "person") ? "person.detected" : "object.detected",
      severity: "info",
      summary: `TEST detection: ${labels.map((l) => l.label).join(", ")}`,
      externalCameraId: cam.source.externalId,
      labels,
    });
  }

  // ---------- badges ----------

  private recordBadge(event: SecurityEvent, raw: RawEvent) {
    const b: BadgeEvent = {
      at: event.at,
      cardId: raw.person!.id,
      name: raw.person!.name,
      doorId: event.doorId,
      doorName: event.doorId ? this.graph.doors.get(event.doorId)?.name : raw.externalDoorId,
      zoneId: event.zoneId,
      granted: event.type === "access.granted",
      action: raw.summary,
    };
    this.badges.push(b);
    this.checkWatchlist(b);
    if (this.badges.length > MAX_BADGES) this.badges.splice(0, this.badges.length - MAX_BADGES);
    appendLine(siteFile("badges", "jsonl"), b).catch(() => {});
  }

  /** Drill log: each drill with when it started, when all clear was sent, and by whom. */
  drillLog() {
    const rows = new Map<string, { id: string; at: string; presetId: string; title: string; scope: string; by: string; channels: string[]; clearedAt?: string; clearedBy?: string }>();
    for (const line of readJsonLines<Record<string, unknown>>(siteFile("drills", "jsonl"), 5000)) {
      const id = String(line.id);
      if (line.at) rows.set(id, { ...(rows.get(id) ?? {}), ...(line as object) } as never);
      else if (rows.has(id)) Object.assign(rows.get(id)!, { clearedAt: line.clearedAt, clearedBy: line.clearedBy });
    }
    return [...rows.values()].sort((a, b) => b.at.localeCompare(a.at));
  }

  // ---------- incidents ----------

  openIncident(): Incident | undefined {
    return this.incidents.find((i) => i.status === "open");
  }

  private saveIncidents() {
    writeJsonSoon(siteFile("incidents"), () => this.incidents.slice(-200));
  }

  private addToIncident(item: IncidentItem) {
    const inc = this.openIncident();
    if (!inc) return;
    inc.timeline.push(item);
    this.saveIncidents();
    this.broadcast({ type: "incident", incident: inc });
  }

  openIncidentNow(title: string, actor: Actor, drill = false) {
    if (this.openIncident()) throw new Error("An incident is already open — close it first");
    const at = new Date().toISOString();
    const inc: Incident = { id: newId("inc"), title: title.trim() || "Incident", status: "open", openedAt: at, openedBy: actor.name, drill, timeline: [], trackIds: [], alertIds: [] };
    // Include the 10 minutes before it was opened: what led up to it.
    const since = Date.now() - 10 * 60_000;
    for (const e of this.events) {
      if (Date.parse(e.at) >= since && !isRoutine(e.type)) inc.timeline.push({ at: e.at, kind: "event", text: e.summary, severity: e.severity, cameraId: e.cameraId, doorId: e.doorId, zoneId: e.zoneId });
    }
    for (const t of this.tracker.tracks.values()) if (t.status === "active") inc.trackIds.push(t.id);
    inc.timeline.push({ at, kind: "note", text: `Incident opened: ${inc.title}`, by: actor.name });
    this.incidents.push(inc);
    this.saveIncidents();
    this.broadcast({ type: "incident", incident: inc });
    return inc;
  }

  addIncidentNote(id: string, text: string, actor: Actor) {
    const inc = this.incidents.find((i) => i.id === id);
    if (!inc) throw new Error("Incident not found");
    if (!text.trim()) throw new Error("Note is empty");
    inc.timeline.push({ at: new Date().toISOString(), kind: "note", text: text.trim(), by: actor.name });
    this.saveIncidents();
    this.broadcast({ type: "incident", incident: inc });
    return inc;
  }

  closeIncident(id: string, summary: string, actor: Actor) {
    const inc = this.incidents.find((i) => i.id === id);
    if (!inc) throw new Error("Incident not found");
    inc.status = "closed";
    inc.closedAt = new Date().toISOString();
    inc.closedBy = actor.name;
    inc.summary = summary.trim() || undefined;
    inc.timeline.push({ at: inc.closedAt, kind: "note", text: "Incident closed", by: actor.name });
    this.saveIncidents();
    this.broadcast({ type: "incident", incident: inc });
    return inc;
  }

  /** Everything the report needs: the incident plus copies of its alerts, tracks and detections. */
  incidentReport(id: string) {
    const inc = this.incidents.find((i) => i.id === id);
    if (!inc) throw new Error("Incident not found");
    const from = Date.parse(inc.openedAt) - 10 * 60_000;
    const to = inc.closedAt ? Date.parse(inc.closedAt) : Date.now();
    return {
      incident: inc,
      siteName: this.site.name,
      alerts: this.alerts.filter((a) => inc.alertIds.includes(a.id)),
      tracks: [...this.tracker.tracks.values()].filter((t) => inc.trackIds.includes(t.id)),
      detections: this.detections.filter((d) => d.ruleHits.length && Date.parse(d.at) >= from && Date.parse(d.at) <= to),
      names: {
        zones: Object.fromEntries([...this.graph.zones.values()].map((z) => [z.id, z.name])),
        cameras: Object.fromEntries([...this.graph.cameras.values()].map((c) => [c.id, c.name])),
        doors: Object.fromEntries([...this.graph.doors.values()].map((d) => [d.id, d.name])),
      },
    };
  }

  // ---------- watch list ----------

  private checkWatchlist(b: BadgeEvent) {
    const entry = this.watchlist.find((w) => w.cardId === b.cardId);
    if (!entry) return;
    const hit: WatchHit = {
      id: newId("wh"),
      at: b.at,
      cardId: b.cardId,
      name: b.name ?? entry.name,
      reason: entry.reason,
      doorId: b.doorId,
      doorName: b.doorName,
      zoneId: b.zoneId,
      granted: b.granted,
    };
    this.watchHits.push(hit);
    if (this.watchHits.length > 50) this.watchHits.shift();
    this.broadcast({ type: "watchhit", hit });
    const who = `${hit.name ?? "Card"} (card ${hit.cardId})`;
    const where = hit.doorName ?? "unknown door";
    this.pushEvent({
      id: newId("evt"),
      type: "alert.raised",
      at: hit.at,
      severity: "critical",
      integration: "watchlist",
      doorId: hit.doorId,
      zoneId: hit.zoneId,
      summary: `WATCH LIST: ${who} at ${where} — ${hit.granted ? "access granted" : "access denied"} · ${entry.reason}`,
    });
    this.notify("watchlist", `WATCH LIST: ${who} badged at ${where} (${hit.granted ? "granted" : "denied"}). Reason: ${entry.reason}`, hit.id);
  }

  async setWatchlist(entries: WatchEntry[], actor: Actor) {
    const clean = entries.map((e) => {
      if (!e.cardId?.trim()) throw new Error("Each entry needs a card number");
      if (!e.reason?.trim()) throw new Error(`Card ${e.cardId}: give a reason`);
      return { cardId: e.cardId.trim(), name: e.name?.trim() || undefined, reason: e.reason.trim(), addedBy: e.addedBy || actor.name, addedAt: e.addedAt || new Date().toISOString() };
    });
    await this.audited(actor, "watchlist.save", `${clean.length} card(s)`, async () => {
      this.watchlist = clean;
      writeJsonSoon(siteFile("watchlist"), () => this.watchlist);
    });
    return this.watchlist;
  }

  acknowledgeWatchHit(id: string, actor: Actor) {
    const hit = this.watchHits.find((h) => h.id === id);
    if (!hit) throw new Error("Not found");
    hit.acknowledgedBy = actor.name;
    this.broadcast({ type: "watchhit", hit });
    return hit;
  }

  /** People who badged, most recent first; `q` matches name or card number. */
  searchPeople(q: string) {
    const needle = q.trim().toLowerCase();
    const today = new Date().toDateString();
    const people = new Map<string, { cardId: string; name?: string; lastAt: string; lastDoor?: string; lastZoneId?: string; todayCount: number; denied: number }>();
    for (let i = this.badges.length - 1; i >= 0; i--) {
      const b = this.badges[i];
      if (needle && !b.cardId.toLowerCase().includes(needle) && !(b.name ?? "").toLowerCase().includes(needle)) continue;
      let p = people.get(b.cardId);
      if (!p) {
        if (people.size >= 50) continue;
        p = { cardId: b.cardId, name: b.name, lastAt: b.at, lastDoor: b.doorName, lastZoneId: b.zoneId, todayCount: 0, denied: 0 };
        people.set(b.cardId, p);
      }
      if (!p.name && b.name) p.name = b.name;
      if (new Date(b.at).toDateString() === today) {
        p.todayCount++;
        if (!b.granted) p.denied++;
      }
    }
    return [...people.values()];
  }

  /** One card's swipes on a day (local date "YYYY-MM-DD"; default today), oldest first. */
  personHistory(cardId: string, date?: string) {
    const day = date ? new Date(`${date}T00:00:00`) : new Date();
    const key = day.toDateString();
    return this.badges.filter((b) => b.cardId === cardId && new Date(b.at).toDateString() === key);
  }


  private eventDoorTimers = new Map<string, ReturnType<typeof setTimeout>>();

  /**
   * Doors on event-only systems (no live lock/position status) still show forced/held alarms
   * on the map: red until a "closed/restored" event, or for 2 minutes.
   */
  private doorStatusFromEvent(event: SecurityEvent) {
    if (!event.doorId) return;
    const door = this.graph.doors.get(event.doorId);
    const integ = door?.source && this.integrations.get(door.source.integration);
    if (!integ || integ.instance.access) return;
    const set = (position: DoorStatus["position"]) => {
      const status: DoorStatus = { lock: "locked", position, mode: "normal", updatedAt: event.at };
      this.doors.set(event.doorId!, status);
      this.broadcast({ type: "door", doorId: event.doorId!, status });
    };
    clearTimeout(this.eventDoorTimers.get(event.doorId));
    if (event.type === "door.forced" || event.type === "door.held") {
      set("open");
      this.eventDoorTimers.set(event.doorId, setTimeout(() => set("closed"), 120_000));
    } else if (event.type === "door.closed") set("closed");
  }

  private pushEvent(event: SecurityEvent) {
    this.doorStatusFromEvent(event);
    if (!isRoutine(event.type)) {
      this.addToIncident({ at: event.at, kind: "event", text: event.summary, severity: event.severity, cameraId: event.cameraId, doorId: event.doorId, zoneId: event.zoneId });
    }
    if ((event.type === "door.forced" || event.type === "door.held") && event.doorId) {
      this.notify("doors", event.summary, `${event.type}:${event.doorId}`);
    }
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
      if (!entry.action.startsWith("settings") && !entry.action.startsWith("rename") && !entry.action.startsWith("layout")) {
        this.addToIncident({ at: entry.at, kind: "action", text: `${entry.action} ${entry.target ?? ""}${entry.ok ? "" : ` — FAILED: ${entry.error}`}`.trim(), by: entry.actor });
      }
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

  /** Last known status of every camera each server reports: integration → externalId → info. */
  private cameraStatus = new Map<string, Map<string, { name: string; online: boolean; since: string }>>();

  async refreshVendorCameras() {
    for (const [id, r] of this.integrations) {
      if (!r.instance.cameras || r.health.state === "unconfigured") continue;
      try {
        const list = await r.instance.cameras.listCameras();
        this.vendorCameras.set(id, new Set(list.map((c) => c.externalId)));
        const prev = this.cameraStatus.get(id);
        const next = new Map<string, { name: string; online: boolean; since: string }>();
        const now = new Date().toISOString();
        const wentOffline: string[] = [];
        for (const c of list) {
          const before = prev?.get(c.externalId);
          next.set(c.externalId, { name: c.name, online: c.online, since: before && before.online === c.online ? before.since : now });
          if (prev && before?.online && !c.online) wentOffline.push(c.name);
        }
        this.cameraStatus.set(id, next);
        if (wentOffline.length) this.notify("system", `Camera${wentOffline.length > 1 ? "s" : ""} offline on ${r.config.name}: ${wentOffline.join(", ")}`, `cams-off:${id}:${wentOffline.join(",")}`);
      } catch {
        // keep the last known list
      }
    }
  }

  /** Admin camera health: every camera from every server, with map placement and AI stats. */
  cameraHealth() {
    const weekAgo = Date.now() - 7 * 24 * 3600_000;
    const placed = new Map([...this.graph.cameras.values()].map((c) => [`${c.source.integration}/${c.source.externalId}`, c]));
    const rows: {
      integration: string;
      server: string;
      externalId: string;
      name: string;
      online: boolean | null;
      since?: string;
      onMap: boolean;
      mapName?: string;
      room?: string;
      detections7d: number;
      real: number;
      falseAlarms: number;
      lastDetection?: string;
    }[] = [];
    const seen = new Set<string>();
    const stats = (integration: string, externalId: string) => {
      const ds = this.detections.filter((d) => d.integration === integration && d.externalCameraId === externalId);
      return {
        detections7d: ds.filter((d) => Date.parse(d.at) >= weekAgo).length,
        real: ds.filter((d) => d.status === "real").length,
        falseAlarms: ds.filter((d) => d.status === "false").length,
        lastDetection: ds.at(-1)?.at,
      };
    };
    for (const [integration, cams] of this.cameraStatus) {
      const server = this.integrations.get(integration)?.config.name ?? integration;
      for (const [externalId, st] of cams) {
        const key = `${integration}/${externalId}`;
        seen.add(key);
        const cam = placed.get(key);
        rows.push({ integration, server, externalId, name: st.name, online: st.online, since: st.since, onMap: !!cam, mapName: cam?.name, room: cam ? this.graph.zones.get(cam.covers[0])?.name : undefined, ...stats(integration, externalId) });
      }
    }
    // Cameras on the map that no server reports (renamed or removed in Blue Iris?).
    for (const [key, cam] of placed) {
      if (seen.has(key)) continue;
      rows.push({ integration: cam.source.integration, server: this.integrations.get(cam.source.integration)?.config.name ?? cam.source.integration, externalId: cam.source.externalId, name: cam.name, online: null, onMap: true, mapName: cam.name, room: this.graph.zones.get(cam.covers[0])?.name, ...stats(cam.source.integration, cam.source.externalId) });
    }
    const servers = [...this.integrations.values()].filter((r) => r.driver.capabilities.includes("cameras")).map((r) => ({ id: r.config.id, name: r.config.name, health: r.health, simulated: r.simulated }));
    return { servers, cameras: rows, checkedAt: new Date().toISOString() };
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
    const title = spec.drill && !/^drill\b/i.test(spec.title.trim()) ? `DRILL: ${spec.title.trim()}` : spec.title.trim();
    const message = spec.drill && !/this is a drill/i.test(spec.message) ? `${spec.message} This is a drill.`.trim() : spec.message;
    const alert: Alert = { ...spec, title, message, id: newId("alr"), at: new Date().toISOString(), by: actor.name, status: "active", deliveries: [] };
    if (spec.drill) appendLine(siteFile("drills", "jsonl"), { id: alert.id, at: alert.at, presetId: spec.presetId, title, scope: spec.scopeLabel, by: actor.name, channels: spec.channels }).catch(() => {});
    this.alerts.push(alert);
    if (this.alerts.length > 50) this.alerts.splice(0, this.alerts.length - 50);
    if (spec.level === "emergency" && !this.openIncident()) this.openIncidentNow(alert.title, actor, !!spec.drill);
    const inc = this.openIncident();
    if (inc) inc.alertIds.push(alert.id);
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
    if (alert.drill) appendLine(siteFile("drills", "jsonl"), { id: alert.id, clearedAt: alert.clearedAt, clearedBy: actor.name }).catch(() => {});
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
      } else if (channel === "sms") {
        const subscribers = this.contacts.filter((c) => c.enabled && c.topics.includes("alerts")).length;
        const r = live.find((x) => x.instance.sms);
        if (!r) skipped(channel, "Text messages", "Text messages not set up (Settings → Text messages)");
        else if (!subscribers) skipped(channel, r.config.name, "No contacts get Alert Center texts (Settings → Text-message contacts)");
        else
          attempt(channel, r, async () => {
            const out = await this.notify("alerts", `${title}: ${message} (${alert.scopeLabel})`, `${alert.id}:${allClear ? "clear" : "send"}`);
            if (!out.sent && out.failed.length) throw new Error(out.failed.join("; "));
            return `${out.sent} text(s)${out.failed.length ? `, ${out.failed.length} failed` : ""}`;
          });
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
    const inc = this.openIncident();
    if (inc && !inc.trackIds.includes(trackId)) {
      inc.trackIds.push(trackId);
      this.saveIncidents();
    }
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
