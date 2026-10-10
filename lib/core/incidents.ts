/** Incidents: one record of everything that happened during an emergency. Types only. */

export type IncidentItemKind = "event" | "alert" | "action" | "detection" | "sighting" | "note";

export interface IncidentItem {
  at: string;
  kind: IncidentItemKind;
  text: string;
  severity?: "info" | "notice" | "warning" | "critical";
  by?: string;
  cameraId?: string;
  doorId?: string;
  zoneId?: string;
  detectionId?: string;
  trackId?: string;
}

export interface Incident {
  id: string;
  title: string;
  status: "open" | "closed";
  openedAt: string;
  openedBy: string;
  closedAt?: string;
  closedBy?: string;
  /** Written when closing: what happened, outcome. */
  summary?: string;
  drill?: boolean;
  timeline: IncidentItem[];
  /** Tracks started during the incident (their sightings go into the report). */
  trackIds: string[];
  alertIds: string[];
}

/** Routine noise that doesn't belong in an incident timeline. */
export function isRoutine(type: string) {
  return type === "person.detected" || type === "motion.detected" || type === "door.opened" || type === "door.closed";
}
