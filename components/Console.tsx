"use client";

import { useEffect, useMemo, useState } from "react";
import { SiteGraph } from "@/lib/core/graph";
import type { SecurityEvent } from "@/lib/core/events";
import type { LiveState } from "@/lib/core/live";
import type { PublicSite, SiteConfig } from "@/lib/core/site";
import { lastSighting } from "@/lib/tracking/tracker";
import { CameraFeed } from "./CameraFeed";
import { MapEditor } from "./MapEditor";
import { MapView, type Selection } from "./MapView";
import { AlertDialog, AllCamerasDialog, BroadcastDialog, describeDoor, DoorControls, EditableName, EventFeed, indexSite, IntegrationsDialog, LockdownDialog, TagDialog, useAction, type SiteIndex } from "./Panels";
import { ago, buildOverlay, FollowView, trackColor, TrackSide, useNow } from "./TrackView";
import { send, useLive } from "./useLive";

type ModalKind = { kind: "cameras" } | { kind: "broadcast" } | { kind: "lockdown" } | { kind: "alert" } | { kind: "integrations" } | { kind: "tag"; cameraId?: string } | null;

export function Console() {
  const { site, state, connected } = useLive();
  if (!site || !state) return <div className="loading">Connecting to campus…</div>;
  return <Loaded site={site} state={state} connected={connected} />;
}

function Loaded({ site, state, connected }: { site: PublicSite; state: LiveState; connected: boolean }) {
  const idx = useMemo(() => indexSite(site), [site]);
  const graph = useMemo(() => new SiteGraph({ ...site, integrations: [] } as SiteConfig), [site]);
  const floors = site.buildings.flatMap((b) => b.floors);
  const [floorId, setFloorId] = useState(floors[0].id);
  const [selection, setSelection] = useState<Selection>(null);
  const [followId, setFollowId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [modal, setModal] = useState<ModalKind>(null);
  const [showSim, setShowSim] = useState(false);
  const [hideDetections, setHideDetections] = useState(true);
  const [editing, setEditing] = useState(false);
  const [showBackground, setShowBackground] = useState(true);

  // Background preference is per-viewer.
  useEffect(() => {
    try {
      if (localStorage.getItem("sentinel.showBackground") === "0") setShowBackground(false);
    } catch {}
  }, []);
  const toggleBackground = () =>
    setShowBackground((v) => {
      try {
        localStorage.setItem("sentinel.showBackground", v ? "0" : "1");
      } catch {}
      return !v;
    });

  const activeTracks = state.tracks.filter((t) => t.status === "active");
  const following = activeTracks.find((t) => t.id === followId) ?? null;
  const highlighted = activeTracks.find((t) => t.id === highlightId) ?? activeTracks.at(-1) ?? null;
  const floor = floors.find((f) => f.id === floorId)!;
  const overlay = highlighted ? buildOverlay(highlighted, floor, idx, graph, trackColor(state.tracks, highlighted.id)) : null;

  const select = (s: Selection) => {
    setSelection(s);
    if (!s) return;
    const fid = s.kind === "zone" ? idx.zones.get(s.id)?.floorId : s.kind === "camera" ? idx.cameras.get(s.id)?.floorId : s.kind === "door" ? idx.doors.get(s.id)?.floorId : idx.displays.get(s.id)?.floorId;
    if (fid) setFloorId(fid);
  };
  const locate = (e: SecurityEvent) => {
    setFollowId(null);
    if (e.cameraId) select({ kind: "camera", id: e.cameraId });
    else if (e.doorId) select({ kind: "door", id: e.doorId });
    else if (e.zoneId) select({ kind: "zone", id: e.zoneId });
  };

  const sims = state.integrations.filter((i) => i.simulated).length;
  const unhealthy = state.integrations.filter((i) => i.health.state === "offline" || i.health.state === "degraded").length;
  const activeAlerts = latestOpenAlerts(state.events);

  return (
    <div className={`app${state.lockdown ? " in-lockdown" : ""}`}>
      <header className="topbar">
        <div className="brand">
          <span className="logo">◆</span> {state.siteName}
        </div>
        <nav className="floors">
          {floors.map((f) => (
            <button key={f.id} className={f.id === floorId && !following ? "on" : ""} onClick={() => (setFloorId(f.id), setFollowId(null))}>
              {f.name}
            </button>
          ))}
        </nav>
        {floors.some((f) => f.background) && (
          <button className={showBackground ? "" : "on-muted"} onClick={toggleBackground} title="Show or hide the floor plan / aerial image">
            {showBackground ? "Hide background" : "Show background"}
          </button>
        )}
        <button className={editing ? "btn-primary" : ""} onClick={() => (setEditing((v) => !v), setFollowId(null), setSelection(null))}>
          {editing ? "Editing map…" : "✎ Edit map"}
        </button>
        <span className="spacer" />
        <button className={`status-pill${unhealthy ? " bad" : ""}`} onClick={() => setModal({ kind: "integrations" })}>
          <span className={`conn${connected ? " up" : ""}`} />
          {unhealthy ? `${unhealthy} integration(s) offline` : sims ? `${sims} simulated` : "All systems OK"}
        </button>
        <button onClick={() => setModal({ kind: "cameras" })}>All cameras</button>
        <button onClick={() => setModal({ kind: "tag" })}>Tag person</button>
        <button onClick={() => setModal({ kind: "broadcast" })}>Message boards</button>
        <button className="btn-warn" onClick={() => setModal({ kind: "alert" })}>Raise alert</button>
        <button className={state.lockdown ? "btn-primary" : "btn-danger"} onClick={() => setModal({ kind: "lockdown" })}>
          {state.lockdown ? "Lift lockdown" : "Lockdown"}
        </button>
      </header>

      {state.lockdown && <div className="banner danger">CAMPUS LOCKDOWN ACTIVE — all controlled doors held locked</div>}
      {activeAlerts.map((a) => (
        <div key={a.id} className="banner warn">⚠ {a.summary} · {new Date(a.at).toLocaleTimeString()}</div>
      ))}
      {!state.authConfigured && <div className="banner subtle">Development mode: no operator logins configured (set CONSOLE_USERS).</div>}

      {editing ? (
        <main className="main">
          <MapEditor
            initial={{ buildings: site.buildings, passages: site.passages }}
            floorId={floorId}
            showBackground={showBackground}
            cameraIntegrations={state.integrations.filter((i) => i.capabilities.includes("cameras") && i.health.state !== "unconfigured").map((i) => ({ id: i.id, name: i.name }))}
            doorIntegration={state.integrations.find((i) => i.capabilities.includes("access-control"))?.id}
            onDone={() => setEditing(false)}
          />
        </main>
      ) : (
      <main className="main">
        <section className="stage">
          {following ? (
            <FollowView track={following} state={state} idx={idx} graph={graph} floors={floors} color={trackColor(state.tracks, following.id)} onExit={() => setFollowId(null)} />
          ) : (
            <>
              <MapView floor={floor} doors={state.doors} selection={selection} onSelect={select} overlay={overlay} simActors={showSim ? state.sim : null} showBackground={showBackground} />
              <div className="legend">
                <span><i className="lg ok" />Locked</span>
                <span><i className="lg warn" />Unlocked</span>
                <span><i className="lg lockdown" />Held locked</span>
                <span><i className="lg danger" />Forced / open while locked</span>
                <span><i className="lg cam" />Camera</span>
                <span><i className="lg disp" />SMART Board</span>
                {state.sim && (
                  <label className="toggle">
                    <input type="checkbox" checked={showSim} onChange={(e) => setShowSim(e.target.checked)} /> Show simulated people
                  </label>
                )}
              </div>
            </>
          )}
        </section>

        <aside className="side">
          {following ? (
            <TrackSide track={following} state={state} idx={idx} graph={graph} floors={floors} color={trackColor(state.tracks, following.id)} />
          ) : (
            <SelectionPanel selection={selection} state={state} idx={idx} graph={graph} onSelect={select} onTag={(cameraId) => setModal({ kind: "tag", cameraId })} onFollow={setFollowId} />
          )}

          <TracksList state={state} idx={idx} followId={followId} highlightId={highlighted?.id ?? null} onFollow={setFollowId} onHighlight={setHighlightId} />

          <div className="section-title">
            Activity
            <label className="toggle small">
              <input type="checkbox" checked={hideDetections} onChange={(e) => setHideDetections(e.target.checked)} /> hide routine
            </label>
          </div>
          <EventFeed events={state.events} idx={idx} onLocate={locate} hideDetections={hideDetections} />
        </aside>
      </main>
      )}

      {modal?.kind === "cameras" && <AllCamerasDialog state={state} idx={idx} onClose={() => setModal(null)} onShowOnMap={(id) => (setEditing(false), setFollowId(null), select({ kind: "camera", id }))} />}
      {modal?.kind === "broadcast" && <BroadcastDialog idx={idx} onClose={() => setModal(null)} />}
      {modal?.kind === "lockdown" && <LockdownDialog active={state.lockdown} onClose={() => setModal(null)} />}
      {modal?.kind === "alert" && <AlertDialog onClose={() => setModal(null)} />}
      {modal?.kind === "integrations" && <IntegrationsDialog state={state} onClose={() => setModal(null)} />}
      {modal?.kind === "tag" && (
        <TagDialog camera={modal.cameraId ? idx.cameras.get(modal.cameraId) : undefined} onClose={() => setModal(null)} onCreated={(id) => setFollowId(id)} />
      )}
    </div>
  );
}

/** Alerts raised and not yet cleared (most recent few). */
function latestOpenAlerts(events: SecurityEvent[]) {
  const open: SecurityEvent[] = [];
  for (const e of events) {
    if (e.type === "alert.raised" && !e.summary.startsWith("LOCKDOWN")) open.push(e);
    if (e.type === "alert.cleared") open.length = 0;
  }
  return open.slice(-2);
}

function TracksList({ state, idx, followId, highlightId, onFollow, onHighlight }: { state: LiveState; idx: SiteIndex; followId: string | null; highlightId: string | null; onFollow: (id: string | null) => void; onHighlight: (id: string) => void }) {
  const now = useNow();
  const active = state.tracks.filter((t) => t.status === "active");
  if (!active.length) return null;
  return (
    <>
      <div className="section-title">Tracking</div>
      <ul className="tracks">
        {active.map((t) => {
          const last = lastSighting(t);
          return (
            <li key={t.id} className={t.id === highlightId ? "on" : ""} onClick={() => onHighlight(t.id)}>
              <span className="track-swatch" style={{ background: trackColor(state.tracks, t.id) }} />
              <div className="grow">
                <strong>{t.label}</strong>
                {t.suggestions.length > 0 && <span className="count">{t.suggestions.length}</span>}
                <div className="muted small">{last ? `${idx.zones.get(last.zoneId)?.name} · ${ago(last.at, now)}` : "no sightings"}</div>
              </div>
              {followId === t.id ? (
                <button onClick={(e) => (e.stopPropagation(), onFollow(null))}>Map</button>
              ) : (
                <button className="btn-primary" onClick={(e) => (e.stopPropagation(), onFollow(t.id))}>Follow</button>
              )}
            </li>
          );
        })}
      </ul>
    </>
  );
}

function SelectionPanel({ selection, state, idx, graph, onSelect, onTag, onFollow }: {
  selection: Selection;
  state: LiveState;
  idx: SiteIndex;
  graph: SiteGraph;
  onSelect: (s: Selection) => void;
  onTag: (cameraId: string) => void;
  onFollow: (trackId: string) => void;
}) {
  const { busy, error, run } = useAction();
  const active = state.tracks.filter((t) => t.status === "active");

  const camTile = (cameraId: string, big = false) => {
    const cam = idx.cameras.get(cameraId)!;
    return (
      <CameraFeed
        key={cameraId}
        camera={cam}
        stream={state.streams[cameraId]}
        zones={idx.zones}
        sim={state.sim}
        emphasis={big}
        onClick={big ? undefined : () => onSelect({ kind: "camera", id: cameraId })}
        footer={
          <>
            <button onClick={(e) => (e.stopPropagation(), onTag(cameraId))}>Tag person</button>
            {active.map((t) => (
              <button key={t.id} disabled={busy} onClick={(e) => (e.stopPropagation(), run(async () => { await send(`/api/tracks/${t.id}/sightings`, { cameraId }); onFollow(t.id); }))}>
                {t.label} here
              </button>
            ))}
          </>
        }
      />
    );
  };

  if (!selection) {
    const controlled = [...idx.doors.values()].filter((d) => d.source);
    const unlocked = controlled.filter((d) => state.doors[d.id]?.lock === "unlocked").length;
    const open = controlled.filter((d) => state.doors[d.id]?.position === "open").length;
    return (
      <div className="panel">
        <h3>Campus overview</h3>
        <div className="stats">
          <div><strong>{idx.cameras.size}</strong><span>cameras</span></div>
          <div><strong>{controlled.length}</strong><span>controlled doors</span></div>
          <div className={unlocked ? "warn" : ""}><strong>{unlocked}</strong><span>unlocked</span></div>
          <div><strong>{open}</strong><span>open now</span></div>
        </div>
        <p className="muted small">Click an area to see its cameras, a door to lock or unlock it, or a camera to watch it. Tag a person from any camera to start tracking them.</p>
      </div>
    );
  }

  if (selection.kind === "camera") {
    const cam = idx.cameras.get(selection.id)!;
    return (
      <div className="panel">
        <EditableName key={`name-${cam.id}`} kind="camera" id={cam.id} name={cam.name} placeholder={cam.placeholder} />
        {camTile(cam.id, true)}
        {error && <p className="error">{error}</p>}
        <div className="section-title">Nearby cameras</div>
        <div className="mini-grid">{graph.camerasNear(cam.covers[0], 1).filter((c) => c.cameraId !== cam.id).slice(0, 4).map((c) => camTile(c.cameraId))}</div>
      </div>
    );
  }

  if (selection.kind === "door") {
    const door = idx.doors.get(selection.id)!;
    const cams = [...new Set(door.between.flatMap((z) => graph.camerasInZone(z)))];
    return (
      <div className="panel">
        <EditableName key={`name-${door.id}`} kind="door" id={door.id} name={door.name} placeholder={door.placeholder} />
        <p className="muted small">{door.between.map((z) => idx.zones.get(z)?.name).join(" ↔ ")}{door.exterior ? " · exterior" : ""}</p>
        <DoorControls door={door} status={state.doors[door.id]} />
        <div className="section-title">Cameras on this door</div>
        <div className="mini-grid">{cams.map((c) => camTile(c))}</div>
      </div>
    );
  }

  if (selection.kind === "display") {
    const d = idx.displays.get(selection.id)!;
    return (
      <div className="panel">
        <EditableName key={`name-${d.id}`} kind="display" id={d.id} name={d.name} />
        <p className="muted small">SMART Board in {idx.zones.get(d.zoneId)?.name}. Use “Message boards” to send to it.</p>
      </div>
    );
  }

  const zone = idx.zones.get(selection.id)!;
  const cams = graph.camerasInZone(zone.id);
  const doors = [...idx.doors.values()].filter((d) => d.between.includes(zone.id) && d.source);
  return (
    <div className="panel">
      <EditableName key={`name-${zone.id}`} kind="zone" id={zone.id} name={zone.name} />
      {zone.building && <div className="building">{zone.building}</div>}
      {cams.length ? <div className="mini-grid single">{cams.map((c) => camTile(c))}</div> : <p className="muted small">No camera covers this area.</p>}
      {cams.length === 0 && (
        <>
          <div className="section-title">Closest cameras</div>
          <div className="mini-grid">{graph.camerasNear(zone.id, 1).slice(0, 4).map((c) => camTile(c.cameraId))}</div>
        </>
      )}
      {error && <p className="error">{error}</p>}
      {doors.length > 0 && <div className="section-title">Doors</div>}
      {doors.map((d) => (
        <div key={d.id} className="door-row" onClick={() => onSelect({ kind: "door", id: d.id })}>
          <strong>{d.name}</strong> <span className="muted small">{describeDoor(state.doors[d.id])}</span>
        </div>
      ))}
    </div>
  );
}
