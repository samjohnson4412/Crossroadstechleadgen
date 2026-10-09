/**
 * Shapes shared between server and browser for the live console state.
 * (Types only — safe to import from client components.)
 */
import type { SecurityEvent } from "./events.ts";
import type { DoorStatus, IntegrationHealth, StreamInfo } from "../integrations/types.ts";
import type { SimActorView } from "../integrations/simulator.ts";
import type { Track } from "../tracking/tracker.ts";

export interface IntegrationView {
  id: string;
  name: string;
  driver: string;
  driverLabel: string;
  capabilities: string[];
  simulated: boolean;
  health: IntegrationHealth;
}

export interface AuditEntry {
  at: string;
  actor: string;
  action: string;
  target?: string;
  ok: boolean;
  error?: string;
}

export interface LiveState {
  siteName: string;
  integrations: IntegrationView[];
  doors: Record<string, DoorStatus>;
  streams: Record<string, StreamInfo>;
  events: SecurityEvent[];
  tracks: Track[];
  audit: AuditEntry[];
  lockdown: boolean;
  sim: SimActorView[] | null;
  authConfigured: boolean;
}

export type LiveMessage =
  | { type: "event"; event: SecurityEvent }
  | { type: "door"; doorId: string; status: DoorStatus }
  | { type: "track"; track: Track }
  | { type: "integration"; integration: IntegrationView }
  | { type: "audit"; entry: AuditEntry }
  | { type: "lockdown"; active: boolean }
  | { type: "sim"; actors: SimActorView[] }
  /** Site layout or names changed; reload /api/site. */
  | { type: "site" };
