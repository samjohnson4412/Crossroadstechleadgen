"use client";

import { useEffect, useMemo, useState } from "react";
import type { SiteGraph } from "@/lib/core/graph";
import type { LiveState } from "@/lib/core/live";
import { centroid, type Floor } from "@/lib/core/site";
import { lastSighting, type Track } from "@/lib/tracking/tracker";
import { CameraFeed, colorOf } from "./CameraFeed";
import { MapView, type TrackOverlay } from "./MapView";
import { useAction, type SiteIndex } from "./Panels";
import { send } from "./useLive";

export const TRACK_COLORS = ["#ff4d6d", "#ffb703", "#4cc9f0", "#b388ff"];

export function trackColor(tracks: Track[], id: string) {
  const i = tracks.findIndex((t) => t.id === id);
  return TRACK_COLORS[(i < 0 ? 0 : i) % TRACK_COLORS.length];
}

export function ago(iso: string, now: number) {
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

export function buildOverlay(track: Track, floor: Floor, idx: SiteIndex, graph: SiteGraph, color: string): TrackOverlay {
  const pointFor = (s: Track["sightings"][number]) => {
    if (s.doorId && idx.doors.get(s.doorId)?.floorId === floor.id) return idx.doors.get(s.doorId)!.position;
    const zone = idx.zones.get(s.zoneId);
    return zone && zone.floorId === floor.id ? centroid(zone.polygon) : null;
  };
  const trail = track.sightings.map(pointFor).filter((p): p is NonNullable<typeof p> => !!p);
  const last = lastSighting(track);
  const predicted = last ? graph.distancesFrom(last.zoneId) : new Map();
  return {
    color,
    trail,
    lastZoneId: last?.zoneId,
    lastPoint: last ? pointFor(last) ?? undefined : undefined,
    predictedZoneIds: [...predicted].filter(([z, d]) => d.hops === 1 && idx.zones.get(z)?.floorId === floor.id).map(([z]) => z),
  };
}

interface Props {
  track: Track;
  state: LiveState;
  idx: SiteIndex;
  graph: SiteGraph;
  floors: Floor[];
  color: string;
  onExit: () => void;
}

/**
 * Follow mode: the camera they were last on, big — and every camera they could
 * walk into next, ordered by how soon they'd get there. One click moves the track.
 */
export function FollowView({ track, state, idx, graph, color, onExit }: Props) {
  const now = useNow();
  const { busy, error, run } = useAction();
  const last = lastSighting(track);
  const [preview, setPreview] = useState<string | null>(null);

  const primaryId = preview ?? last?.cameraId ?? (last ? graph.camerasInZone(last.zoneId)[0] : undefined);
  const next = useMemo(() => (last ? graph.camerasNear(last.zoneId, 2).filter((c) => c.cameraId !== primaryId) : []), [graph, last, primaryId]);
  const suggestionByCam = new Map(track.suggestions.map((s) => [s.cameraId, s]));
  const zones = useMemo(() => new Map([...idx.zones].map(([k, z]) => [k, z])), [idx]);

  const seenHere = (cameraId: string) => run(async () => {
    await send(`/api/tracks/${track.id}/sightings`, { cameraId });
    setPreview(null);
  });

  const primary = primaryId ? idx.cameras.get(primaryId) : undefined;

  return (
    <div className="follow">
      <div className="follow-head">
        <span className="track-swatch" style={{ background: color }} />
        <h2>{track.label}</h2>
        {track.appearance && (
          <span className="appearance">
            {track.appearance.upperColor && <><i style={{ background: colorOf(track.appearance.upperColor) }} />{track.appearance.upperColor} top</>}
            {track.appearance.lowerColor && <><i style={{ background: colorOf(track.appearance.lowerColor) }} />{track.appearance.lowerColor} bottom</>}
            {track.appearance.tags?.length ? <> · {track.appearance.tags.join(", ")}</> : null}
          </span>
        )}
        <span className="spacer" />
        {last ? (
          <span className="last-seen">Last seen <strong>{idx.zones.get(last.zoneId)?.name}</strong> · {ago(last.at, now)}</span>
        ) : (
          <span className="last-seen">No sightings yet — click "Seen here" on any camera</span>
        )}
        <button onClick={onExit}>Back to map</button>
      </div>
      {error && <p className="error">{error}</p>}

      <div className="follow-body">
        <div className="follow-primary">
          {primary ? (
            <CameraFeed
              camera={primary}
              stream={state.streams[primary.id]}
              zones={zones}
              sim={state.sim}
              emphasis
              badge={preview ? "PREVIEW" : "LAST SEEN"}
              footer={
                preview ? (
                  <>
                    <button className="btn-primary" disabled={busy} onClick={() => seenHere(preview)}>Seen here</button>
                    <button onClick={() => setPreview(null)}>Back to last seen</button>
                  </>
                ) : (
                  <span className="muted small">{primary.name} · watching</span>
                )
              }
            />
          ) : (
            <div className="feed-empty big">No camera covers the last known location.</div>
          )}
        </div>
        <div className="follow-next">
          <div className="section-title">Where they can go next</div>
          <div className="next-grid">
            {next.slice(0, 8).map((n) => {
              const cam = idx.cameras.get(n.cameraId)!;
              const sug = suggestionByCam.get(n.cameraId);
              return (
                <CameraFeed
                  key={n.cameraId}
                  camera={cam}
                  stream={state.streams[cam.id]}
                  zones={zones}
                  sim={state.sim}
                  badge={sug ? `POSSIBLE MATCH ${Math.round(sug.score * 100)}%` : n.hops === 0 ? "same area" : `${n.hops} away · ~${Math.round(n.seconds)}s`}
                  emphasis={!!sug}
                  onClick={() => setPreview(cam.id)}
                  footer={
                    <button className="btn-primary" disabled={busy} onClick={(e) => (e.stopPropagation(), seenHere(cam.id))}>
                      Seen here
                    </button>
                  }
                />
              );
            })}
            {next.length === 0 && <p className="muted">No nearby cameras mapped.</p>}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Side panel while following: map with the trail, analytic suggestions, timeline. */
export function TrackSide({ track, state, idx, graph, floors, color }: Omit<Props, "onExit">) {
  const now = useNow();
  const { busy, error, run } = useAction();
  const last = lastSighting(track);
  const floor = floors.find((f) => f.id === (last ? idx.zones.get(last.zoneId)?.floorId : undefined)) ?? floors[0];
  const overlay = buildOverlay(track, floor, idx, graph, color);
  const [badge, setBadge] = useState("");

  const decide = (sid: string, action: "confirm" | "reject") => run(() => send(`/api/tracks/${track.id}/suggestions/${sid}`, { action }));

  return (
    <div className="track-side">
      <div className="section-title">{floor.name}</div>
      <MapView floor={floor} doors={state.doors} selection={null} onSelect={() => {}} overlay={overlay} compact />

      <div className="section-title">Possible sightings {track.suggestions.length > 0 && <span className="count">{track.suggestions.length}</span>}</div>
      {track.suggestions.length === 0 && <p className="muted small">Camera analytics hits that fit this person and could physically be them show up here.</p>}
      <ul className="suggestions">
        {track.suggestions.map((s) => (
          <li key={s.id}>
            <div>
              <strong>{s.cameraId ? idx.cameras.get(s.cameraId)?.name : idx.zones.get(s.zoneId)?.name}</strong> · {Math.round(s.score * 100)}% · {ago(s.at, now)}
              <div className="muted small">{s.reasons.join(" · ")}</div>
            </div>
            <div className="btn-row">
              <button className="btn-primary" disabled={busy} onClick={() => decide(s.id, "confirm")}>It&apos;s them</button>
              <button disabled={busy} onClick={() => decide(s.id, "reject")}>No</button>
            </div>
          </li>
        ))}
      </ul>

      <div className="section-title">Timeline</div>
      <ol className="timeline">
        {track.sightings.slice().reverse().map((s) => (
          <li key={s.id}>
            <span className="event-time">{new Date(s.at).toLocaleTimeString()}</span>
            <span>
              {idx.zones.get(s.zoneId)?.name}
              {s.cameraId && <span className="muted"> · {idx.cameras.get(s.cameraId)?.name}</span>}
              {s.doorId && <span className="muted"> · {idx.doors.get(s.doorId)?.name}</span>}
            </span>
            <span className={`src src-${s.source}`}>{s.source === "operator" ? s.by ?? "operator" : s.source === "access" ? "badge" : "analytics"}</span>
          </li>
        ))}
      </ol>

      <div className="section-title">Link a badge</div>
      <div className="btn-row">
        <input value={badge} onChange={(e) => setBadge(e.target.value)} placeholder={track.credentialIds.length ? track.credentialIds.join(", ") : "credential id"} />
        <button disabled={busy || !badge.trim()} onClick={() => run(async () => { await send(`/api/tracks/${track.id}`, { credentialIds: [...track.credentialIds, badge.trim()] }, "PATCH"); setBadge(""); })}>Link</button>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="btn-row end">
        <button className="btn-ghost" disabled={busy} onClick={() => run(() => send(`/api/tracks/${track.id}`, { status: "closed" }, "PATCH"))}>Close track</button>
      </div>
    </div>
  );
}
