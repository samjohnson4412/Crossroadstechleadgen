/**
 * Normalized security events. Every integration translates its vendor's events
 * into these shapes, so the console, the tracker, and future rules/automations
 * never need to know which product an event came from.
 */

/** What a camera or analytics engine could tell us about a person's look. */
export interface Appearance {
  upperColor?: string;
  lowerColor?: string;
  /** Free-form tags from analytics: "backpack", "hat", "glasses", ... */
  tags?: string[];
  /** Re-identification embedding, when a model provides one (future). */
  embedding?: number[];
}

export type EventType =
  | "access.granted"
  | "access.denied"
  | "access.other"
  | "door.opened"
  | "door.closed"
  | "door.forced"
  | "door.held"
  | "person.detected"
  | "object.detected"
  | "motion.detected"
  | "alert.raised"
  | "alert.cleared"
  | "message.sent"
  | "integration.status";

export type Severity = "info" | "notice" | "warning" | "critical";

export interface SecurityEvent {
  id: string;
  type: EventType;
  at: string; // ISO timestamp
  severity: Severity;
  /** Integration that produced it. */
  integration: string;
  summary: string;
  /** Resolved site locations (filled in by the runtime from device refs). */
  cameraId?: string;
  doorId?: string;
  zoneId?: string;
  /** Who: a credential/person id from access control, when known. */
  person?: { id: string; name?: string };
  appearance?: Appearance;
  /** AI labels, e.g. [{label: "person", confidence: 87}]. */
  labels?: { label: string; confidence?: number }[];
  /** Vendor payload, kept for audit and debugging. */
  raw?: unknown;
}

/** An event as an integration reports it, before site resolution. */
export interface RawEvent {
  type: EventType;
  severity?: Severity;
  summary: string;
  at?: string;
  /** Vendor-side device id; resolved against DeviceRefs into cameraId/doorId. */
  externalCameraId?: string;
  externalDoorId?: string;
  zoneId?: string;
  person?: { id: string; name?: string };
  appearance?: Appearance;
  labels?: { label: string; confidence?: number }[];
  raw?: unknown;
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}
