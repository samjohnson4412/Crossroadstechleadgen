/** Flagged badges: any use raises an immediate alert. Types only — safe in the browser. */

export interface WatchEntry {
  cardId: string;
  name?: string;
  reason: string;
  addedBy: string;
  addedAt: string;
}

export interface WatchHit {
  id: string;
  at: string;
  cardId: string;
  name?: string;
  reason: string;
  doorId?: string;
  doorName?: string;
  zoneId?: string;
  granted: boolean;
  acknowledgedBy?: string;
}
