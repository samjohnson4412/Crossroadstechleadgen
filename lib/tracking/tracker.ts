import { newId, type Appearance, type SecurityEvent } from "../core/events.ts";
import type { SiteGraph } from "../core/graph.ts";

/**
 * Suspect tracking.
 *
 * A Track is a person of interest the operator has tagged. Its timeline is
 * built from three kinds of evidence:
 *
 *   operator   — "seen here" clicks on a camera (always trusted)
 *   access     — a badge swipe by a credential linked to the track (trusted)
 *   detection  — a camera analytics hit that *might* be them; becomes a
 *                Suggestion the operator confirms or rejects with one click
 *
 * Suggestions are scored on (a) whether the person could physically have got
 * there given the building graph and elapsed time, and (b) how well their
 * appearance matches. The building graph also drives the "next cameras" list,
 * so the operator is always looking where the person can turn up next.
 */

export type SightingSource = "operator" | "access" | "detection";

export interface Sighting {
  id: string;
  at: string;
  zoneId: string;
  cameraId?: string;
  doorId?: string;
  source: SightingSource;
  by?: string;
  note?: string;
}

export interface Suggestion {
  id: string;
  at: string;
  zoneId: string;
  cameraId?: string;
  eventId: string;
  score: number;
  reasons: string[];
}

export interface Track {
  id: string;
  label: string;
  description?: string;
  createdAt: string;
  createdBy: string;
  status: "active" | "closed";
  appearance?: Appearance;
  /** Badge/credential ids known to belong to this person; their swipes auto-add sightings. */
  credentialIds: string[];
  sightings: Sighting[];
  suggestions: Suggestion[];
  /** Set when the operator loses sight of them; cleared by the next sighting. */
  lostAt?: string;
}

export const SUGGESTION_THRESHOLD = 0.45;
/** People can move faster than a stroll; allow running at ~2.5× walking pace. */
const MAX_SPEEDUP = 2.5;
const SUGGESTION_TTL_MS = 5 * 60_000;
const MAX_SUGGESTIONS = 12;

/**
 * Compare two appearance descriptions. Returns null when there's nothing to compare.
 * A clothing color mismatch is strong evidence against; a match is moderate evidence for.
 */
export function appearanceScore(target?: Appearance, seen?: Appearance): number | null {
  if (!target || !seen) return null;
  let compared = 0;
  let matched = 0;
  for (const key of ["upperColor", "lowerColor"] as const) {
    if (target[key] && seen[key]) {
      compared++;
      if (target[key]!.toLowerCase() === seen[key]!.toLowerCase()) matched++;
    }
  }
  const tagsT = new Set((target.tags ?? []).map((t) => t.toLowerCase()));
  const tagsS = (seen.tags ?? []).map((t) => t.toLowerCase());
  const tagHits = tagsS.filter((t) => tagsT.has(t)).length;
  if (compared === 0 && tagsT.size === 0) return null;
  if (compared > 0 && matched < compared) return matched === 0 ? 0 : 0.3;
  return Math.min(1, (compared ? 0.8 : 0.5) + tagHits * 0.1);
}

/** Could someone last seen in `fromZone` at `fromAt` be in `toZone` at `toAt`? */
export function reachability(graph: SiteGraph, fromZone: string, fromAt: number, toZone: string, toAt: number) {
  const d = graph.distancesFrom(fromZone).get(toZone);
  const elapsed = (toAt - fromAt) / 1000;
  if (!d) return { possible: false, hops: Infinity, elapsed, walkSeconds: Infinity };
  return { possible: d.seconds / MAX_SPEEDUP <= elapsed + 2, hops: d.hops, elapsed, walkSeconds: d.seconds };
}

/**
 * Cameras someone last seen in `zoneId` at `since` could have reached by `now` (allowing for
 * running), nearest first. Used when the operator has lost them.
 */
export function searchArea(graph: SiteGraph, zoneId: string, since: string, now = Date.now(), limit = 12) {
  const elapsed = Math.max(0, (now - Date.parse(since)) / 1000);
  const reach = elapsed * MAX_SPEEDUP + 15;
  const out = new Map<string, { cameraId: string; hops: number; seconds: number }>();
  for (const [zone, d] of graph.distancesFrom(zoneId)) {
    if (d.seconds > reach) continue;
    for (const cameraId of graph.camerasInZone(zone)) {
      const prev = out.get(cameraId);
      if (!prev || d.seconds < prev.seconds) out.set(cameraId, { cameraId, ...d });
    }
  }
  return [...out.values()].sort((a, b) => a.seconds - b.seconds).slice(0, limit);
}

export function lastSighting(track: Track): Sighting | undefined {
  return track.sightings[track.sightings.length - 1];
}

export class Tracker {
  readonly tracks = new Map<string, Track>();
  private readonly graph: SiteGraph;

  constructor(graph: SiteGraph) {
    this.graph = graph;
  }

  create(input: { label: string; description?: string; appearance?: Appearance; credentialIds?: string[]; by: string; cameraId?: string; zoneId?: string; doorId?: string }): Track {
    const track: Track = {
      id: newId("trk"),
      label: input.label,
      description: input.description,
      createdAt: new Date().toISOString(),
      createdBy: input.by,
      status: "active",
      appearance: input.appearance,
      credentialIds: input.credentialIds ?? [],
      sightings: [],
      suggestions: [],
    };
    this.tracks.set(track.id, track);
    if (input.cameraId || input.zoneId || input.doorId) this.addSighting(track.id, { cameraId: input.cameraId, zoneId: input.zoneId, doorId: input.doorId }, input.doorId ? "access" : "operator", input.by);
    return track;
  }

  get(id: string): Track {
    const track = this.tracks.get(id);
    if (!track) throw new Error(`No track ${id}`);
    return track;
  }

  update(id: string, patch: Partial<Pick<Track, "label" | "description" | "appearance" | "credentialIds" | "status" | "lostAt">>): Track {
    const track = this.get(id);
    Object.assign(track, patch);
    if (patch.lostAt === null || patch.lostAt === "") delete track.lostAt;
    if (track.status === "closed") track.suggestions = [];
    return track;
  }

  /** Resolve a location given as camera, door, or zone into a zone id. */
  private resolveZone(loc: { cameraId?: string; doorId?: string; zoneId?: string }, nearZone?: string): string {
    if (loc.zoneId) return loc.zoneId;
    let candidates: string[] = [];
    if (loc.cameraId) candidates = this.graph.zonesForCamera(loc.cameraId);
    else if (loc.doorId) candidates = [...(this.graph.doors.get(loc.doorId)?.between ?? [])];
    if (!candidates.length) throw new Error("Location must reference a known camera, door, or zone");
    if (nearZone && candidates.length > 1) {
      // A camera seeing two zones / a door between two: pick the one beyond where they were.
      const dist = this.graph.distancesFrom(nearZone);
      const farther = candidates.filter((z) => z !== nearZone);
      if (loc.doorId && farther.length) return farther[0];
      return candidates.sort((a, b) => (dist.get(a)?.seconds ?? 1e9) - (dist.get(b)?.seconds ?? 1e9))[0];
    }
    return candidates[0];
  }

  addSighting(
    trackId: string,
    loc: { cameraId?: string; doorId?: string; zoneId?: string },
    source: SightingSource,
    by?: string,
    at = new Date().toISOString(),
  ): Sighting {
    const track = this.get(trackId);
    const sighting: Sighting = {
      id: newId("sgt"),
      at,
      zoneId: this.resolveZone(loc, lastSighting(track)?.zoneId),
      cameraId: loc.cameraId,
      doorId: loc.doorId,
      source,
      by,
    };
    track.sightings.push(sighting);
    track.sightings.sort((a, b) => a.at.localeCompare(b.at));
    // Older suggestions are superseded by a confirmed position.
    track.suggestions = track.suggestions.filter((s) => s.at > at);
    delete track.lostAt;
    return sighting;
  }

  /** Remove the most recent sighting (e.g. clicked the wrong camera); the track goes back to the one before. */
  undoLastSighting(trackId: string): Sighting | undefined {
    const track = this.get(trackId);
    const removed = track.sightings.pop();
    track.suggestions = [];
    return removed;
  }

  /**
   * Cameras they could have reached since they were last seen, nearest first — the
   * search area once the operator has lost them. Grows with the time elapsed.
   */
  searchCameras(track: Track, now = Date.now(), limit = 12) {
    const last = lastSighting(track);
    return last ? searchArea(this.graph, last.zoneId, last.at, now, limit) : [];
  }

  confirmSuggestion(trackId: string, suggestionId: string, by: string): Sighting {
    const track = this.get(trackId);
    const s = track.suggestions.find((x) => x.id === suggestionId);
    if (!s) throw new Error("Suggestion no longer available");
    track.suggestions = track.suggestions.filter((x) => x.id !== suggestionId);
    return this.addSighting(trackId, { cameraId: s.cameraId, zoneId: s.zoneId }, "detection", by, s.at);
  }

  rejectSuggestion(trackId: string, suggestionId: string) {
    const track = this.get(trackId);
    track.suggestions = track.suggestions.filter((x) => x.id !== suggestionId);
  }

  /** Cameras to watch next for this track, nearest first. */
  nextCameras(track: Track, maxHops = 2) {
    const last = lastSighting(track);
    return last ? this.graph.camerasNear(last.zoneId, maxHops) : [];
  }

  /**
   * Feed every normalized event through here. Returns the tracks that changed.
   */
  ingest(event: SecurityEvent): Track[] {
    const changed: Track[] = [];
    const now = Date.parse(event.at);
    for (const track of this.tracks.values()) {
      if (track.status !== "active") continue;
      const before = track.suggestions.length;
      track.suggestions = track.suggestions.filter((s) => now - Date.parse(s.at) < SUGGESTION_TTL_MS);
      let didChange = track.suggestions.length !== before;

      if ((event.type === "access.granted" || event.type === "access.denied") && event.person && track.credentialIds.includes(event.person.id) && event.doorId) {
        this.addSighting(track.id, { doorId: event.doorId }, "access", event.person.name, event.at);
        didChange = true;
      } else if (event.type === "person.detected" && event.cameraId) {
        const suggestion = this.score(track, event);
        if (suggestion) {
          track.suggestions = [suggestion, ...track.suggestions].slice(0, MAX_SUGGESTIONS);
          didChange = true;
        }
      }
      if (didChange) changed.push(track);
    }
    return changed;
  }

  private score(track: Track, event: SecurityEvent): Suggestion | null {
    const last = lastSighting(track);
    if (!last || !event.cameraId) return null;
    const zones = event.zoneId ? [event.zoneId] : this.graph.zonesForCamera(event.cameraId);
    const at = Date.parse(event.at);
    if (at <= Date.parse(last.at)) return null;

    let best: { zoneId: string; reach: ReturnType<typeof reachability> } | null = null;
    for (const zoneId of zones) {
      const reach = reachability(this.graph, last.zoneId, Date.parse(last.at), zoneId, at);
      if (reach.possible && (!best || reach.hops < best.reach.hops)) best = { zoneId, reach };
    }
    if (!best || best.reach.hops > 4) return null;

    const reasons: string[] = [];
    const looks = appearanceScore(track.appearance, event.appearance);
    let score: number;
    if (looks === null) {
      // No appearance data (e.g. a plain "person" alert). Only useful close by and soon after.
      if (best.reach.hops > 2 || best.reach.elapsed > 180) return null;
      score = 0.5 - best.reach.hops * 0.05;
      reasons.push("person detected; no appearance data");
    } else {
      score = looks * (1 - best.reach.hops * 0.08);
      reasons.push(looks >= 0.8 ? "appearance matches" : looks > 0 ? "partial appearance match" : "appearance differs");
    }
    reasons.push(best.reach.hops === 0 ? "same area as last sighting" : `${best.reach.hops} ${best.reach.hops === 1 ? "area" : "areas"} from last sighting, ${Math.round(best.reach.elapsed)}s later`);
    if (score < SUGGESTION_THRESHOLD) return null;
    return { id: newId("sug"), at: event.at, zoneId: best.zoneId, cameraId: event.cameraId, eventId: event.id, score: Math.round(score * 100) / 100, reasons };
  }
}
