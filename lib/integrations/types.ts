import type { RawEvent } from "../core/events.ts";
import type { SiteGraph } from "../core/graph.ts";
import type { IntegrationConfig } from "../core/site.ts";

/**
 * The integration contract. Any system — cameras, access control, alerting,
 * displays, sensors — plugs in by implementing a driver that exposes one or
 * more capabilities. The rest of the platform only ever talks to capabilities.
 *
 * Adding a vendor = writing one driver file and registering it in registry.ts.
 */

export type Capability = "cameras" | "access-control" | "alerts" | "messaging";

export type HealthState = "ok" | "degraded" | "offline" | "simulated" | "unconfigured";

export interface IntegrationHealth {
  state: HealthState;
  detail?: string;
  checkedAt: string;
}

// ---------- cameras ----------

/** How the browser should play a camera. The server proxies anything needing credentials. */
export type StreamInfo =
  | { kind: "mjpeg"; url: string }
  | { kind: "hls"; url: string }
  | { kind: "webrtc"; url: string }
  | { kind: "simulated" }
  | { kind: "unavailable"; reason: string };

export interface CameraCapability {
  /** Cameras the vendor system knows about (used to help map them onto the floor plan). */
  listCameras(): Promise<{ externalId: string; name: string; online: boolean }[]>;
  streamInfo(externalId: string, cameraId: string): StreamInfo;
  /** Server-side proxy for MJPEG/snapshots so vendor credentials never reach the browser. */
  proxyStream?(externalId: string, signal: AbortSignal): Promise<Response>;
  snapshot?(externalId: string): Promise<Response>;
}

// ---------- access control ----------

export type LockState = "locked" | "unlocked" | "unknown";
export type DoorPosition = "open" | "closed" | "unknown";
export type LockMode = "normal" | "held-unlocked" | "held-locked";

export interface DoorStatus {
  lock: LockState;
  position: DoorPosition;
  mode: LockMode;
  updatedAt: string;
}

export interface Actor {
  /** Operator display name, recorded in the vendor's own audit log where supported. */
  name: string;
}

export interface AccessControlCapability {
  listDoors(): Promise<{ externalId: string; name: string }[]>;
  doorStatus(externalId: string): Promise<DoorStatus>;
  /** Momentary unlock (the vendor's normal unlock duration). */
  unlock(externalId: string, actor: Actor): Promise<void>;
  /** Keep unlocked until reset. */
  holdUnlocked(externalId: string, actor: Actor): Promise<void>;
  /** Keep locked until reset (overrides schedules). */
  holdLocked(externalId: string, actor: Actor): Promise<void>;
  /** Return to normal schedule. */
  reset(externalId: string, actor: Actor): Promise<void>;
  /** Site-wide lockdown, if the vendor supports it natively. Otherwise the runtime holds each door locked. */
  setLockdown?(active: boolean, actor: Actor): Promise<void>;
}

// ---------- alerts (SaferWatch, panic buttons, ...) ----------

export interface AlertCapability {
  /** Push an alert outward (e.g. notify SaferWatch / law enforcement), if supported. */
  raiseAlert?(alert: { title: string; detail: string; zoneId?: string }, actor: Actor): Promise<void>;
}

// ---------- messaging (SMART boards, PA, signage, ...) ----------

export interface DisplayMessage {
  title: string;
  body: string;
  level: "info" | "warning" | "emergency";
}

export interface MessagingCapability {
  /** Send to specific displays (vendor ids) or all displays when `externalIds` is empty. */
  send(message: DisplayMessage, externalIds: string[], actor: Actor): Promise<void>;
  clear?(externalIds: string[], actor: Actor): Promise<void>;
}

// ---------- the integration itself ----------

export interface IntegrationContext {
  config: IntegrationConfig;
  graph: SiteGraph;
  /** Resolved settings (env references already substituted). */
  settings: Record<string, string | number | boolean | undefined>;
  emit(event: RawEvent): void;
  /** Report a door state change pushed by the vendor. */
  doorChanged(externalDoorId: string, status: DoorStatus): void;
  setHealth(state: HealthState, detail?: string): void;
  log(message: string): void;
}

export interface Integration {
  start(): Promise<void>;
  stop(): Promise<void>;
  cameras?: CameraCapability;
  access?: AccessControlCapability;
  alerts?: AlertCapability;
  messaging?: MessagingCapability;
  /** Step-by-step connection test for troubleshooting (GET /api/integrations/:id/check). */
  diagnose?(): Promise<Record<string, unknown>>;
  /** Inbound webhooks from the vendor land here (POST /api/integrations/:id/webhook). */
  handleWebhook?(request: Request): Promise<Response>;
}

export interface IntegrationDriver {
  /** Matches IntegrationConfig.driver. */
  id: string;
  label: string;
  capabilities: Capability[];
  /** Settings that must be present; if any is missing the runtime falls back to the simulator. */
  requiredSettings: string[];
  create(ctx: IntegrationContext): Integration;
}
