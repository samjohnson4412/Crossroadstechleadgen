"use client";

import { useMemo, useState } from "react";
import { SiteGraph } from "@/lib/core/graph";
import type { LiveState } from "@/lib/core/live";
import type { PublicSite, SiteConfig } from "@/lib/core/site";
import { lastSighting } from "@/lib/tracking/tracker";
import { ActiveAlerts, AlertCenter } from "./AlertCenter";
import { CameraFeed } from "./CameraFeed";
import { CriticalDetections, DetectionsPanel, needsReview } from "./Detections";
import { AllCamerasDialog, EventFeed, indexSite, LockdownDialog, TagDialog, useAction } from "./Panels";
import { PeoplePanel } from "./People";
import { ago, FollowView, trackColor, useNow } from "./TrackView";
import { send, useLive } from "./useLive";
import { WatchHits } from "./WatchList";

type Tab = "home" | "cameras" | "track" | "activity";
type Sheet = { kind: "alert"; presetId?: string } | { kind: "lockdown" } | { kind: "detections" } | { kind: "people" } | { kind: "allcams" } | { kind: "tag"; cameraId?: string } | null;

/** Phone view: the few things people need on the move, big and thumb-friendly. */
export function MobileApp() {
  const { site, state, connected } = useLive();
  if (!site || !state) return <div className="loading">Connecting…</div>;
  return <MobileLoaded site={site} state={state} connected={connected} />;
}

function MobileLoaded({ site, state, connected }: { site: PublicSite; state: LiveState; connected: boolean }) {
  const idx = useMemo(() => indexSite(site), [site]);
  const graph = useMemo(() => new SiteGraph({ ...site, integrations: [] } as SiteConfig), [site]);
  const floors = site.buildings.flatMap((b) => b.floors);
  const [tab, setTab] = useState<Tab>("home");
  const [sheet, setSheet] = useState<Sheet>(null);
  const [cameraId, setCameraId] = useState<string | null>(null);
  const [trackId, setTrackId] = useState<string | null>(null);
  const [hideRoutine, setHideRoutine] = useState(true);
  const now = useNow(5000);

  const active = state.tracks.filter((t) => t.status === "active");
  const review = state.detections.filter(needsReview).length;
  const following = active.find((t) => t.id === trackId) ?? null;

  const desktop = () => {
    try {
      localStorage.setItem("sentinel.desktop", "1");
    } catch {}
    window.location.href = "/";
  };

  return (
    <div className={`m-app${state.lockdown ? " in-lockdown" : ""}`}>
      <header className="m-head">
        <span className="brand"><span className="logo">◆</span> {state.siteName}</span>
        <span className="spacer" />
        <span className={`conn${connected ? " up" : ""}`} title={connected ? "Live" : "Reconnecting…"} />
        <button className="btn-ghost small-btn" onClick={desktop}>Full console</button>
      </header>
      {state.lockdown && <div className="banner danger">LOCKDOWN ACTIVE</div>}
      <ActiveAlerts state={state} />
      <WatchHits state={state} idx={idx} onShowDoor={() => setTab("cameras")} onFollow={(id) => (setTrackId(id), setTab("track"))} />
      <CriticalDetections state={state} idx={idx} onReview={() => setSheet({ kind: "detections" })} onLockdown={() => setSheet({ kind: "alert", presetId: "lockdown" })} />

      <main className="m-main">
        {tab === "home" && (
          <div className="m-home">
            <button className="m-big btn-alert" onClick={() => setSheet({ kind: "alert" })}>🚨 Send alert</button>
            <button className={`m-big ${state.lockdown ? "btn-primary" : "btn-danger"}`} onClick={() => setSheet({ kind: "lockdown" })}>
              {state.lockdown ? "Lift lockdown" : "🔒 Lockdown campus"}
            </button>
            <div className="m-grid">
              <button className="m-tile" onClick={() => setSheet({ kind: "detections" })}>
                <strong>{review}</strong>
                <span>detections to review</span>
              </button>
              <button className="m-tile" onClick={() => setTab("track")}>
                <strong>{active.length}</strong>
                <span>people being tracked</span>
              </button>
              <button className="m-tile" onClick={() => setSheet({ kind: "people" })}>
                <strong>👤</strong>
                <span>find a person (badges)</span>
              </button>
              <button className="m-tile" onClick={() => setSheet({ kind: "tag" })}>
                <strong>＋</strong>
                <span>tag a person</span>
              </button>
            </div>
          </div>
        )}

        {tab === "cameras" &&
          (cameraId && idx.cameras.get(cameraId) ? (
            <MobileCamera cameraId={cameraId} state={state} idx={idx} onBack={() => setCameraId(null)} onTag={(id) => setSheet({ kind: "tag", cameraId: id })} onFollow={(id) => (setTrackId(id), setTab("track"))} />
          ) : (
            <CameraList idx={idx} onPick={setCameraId} onAll={() => setSheet({ kind: "allcams" })} />
          ))}

        {tab === "track" &&
          (following ? (
            <div className="m-follow">
              <FollowView track={following} state={state} idx={idx} graph={graph} floors={floors} color={trackColor(state.tracks, following.id)} onExit={() => setTrackId(null)} />
            </div>
          ) : (
            <div>
              <h3>Tracking</h3>
              {active.length === 0 && <p className="muted">Nobody is being tracked. Tag a person from any camera to start.</p>}
              <ul className="m-list">
                {active.map((t) => {
                  const last = lastSighting(t);
                  return (
                    <li key={t.id} onClick={() => setTrackId(t.id)}>
                      <span className="track-swatch" style={{ background: trackColor(state.tracks, t.id) }} />
                      <div className="grow">
                        <strong>{t.label}</strong> {t.lostAt && <span className="lost-chip">LOST</span>}
                        <div className="muted small">{last ? `${idx.zones.get(last.zoneId)?.name} · ${ago(last.at, now)}` : "no sightings yet"}</div>
                      </div>
                      <span className="chev">›</span>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}

        {tab === "activity" && (
          <div>
            <div className="section-title">
              Activity
              <label className="toggle small"><input type="checkbox" checked={hideRoutine} onChange={(e) => setHideRoutine(e.target.checked)} /> hide routine</label>
            </div>
            <EventFeed
              events={state.events}
              idx={idx}
              hideDetections={hideRoutine}
              onLocate={(e) => {
                if (e.cameraId) {
                  setCameraId(e.cameraId);
                  setTab("cameras");
                }
              }}
            />
          </div>
        )}
      </main>

      <nav className="m-tabs">
        {(
          [
            ["home", "⌂", "Home"],
            ["cameras", "◉", "Cameras"],
            ["track", "◎", `Track${active.length ? ` (${active.length})` : ""}`],
            ["activity", "≡", "Activity"],
          ] as const
        ).map(([id, icon, label]) => (
          <button key={id} className={tab === id ? "on" : ""} onClick={() => setTab(id)}>
            <span className="m-tab-icon">{icon}</span>
            {label}
          </button>
        ))}
      </nav>

      {sheet?.kind === "alert" && <AlertCenter site={site} state={state} initialPresetId={sheet.presetId} onClose={() => setSheet(null)} />}
      {sheet?.kind === "lockdown" && <LockdownDialog active={state.lockdown} onClose={() => setSheet(null)} />}
      {sheet?.kind === "detections" && (
        <DetectionsPanel
          state={state}
          idx={idx}
          onClose={() => setSheet(null)}
          onShowCamera={(id) => (setSheet(null), setCameraId(id), setTab("cameras"))}
          onTrack={(id) => setSheet({ kind: "tag", cameraId: id })}
          onLockdown={() => setSheet({ kind: "alert", presetId: "lockdown" })}
        />
      )}
      {sheet?.kind === "people" && <PeoplePanel idx={idx} onClose={() => setSheet(null)} onShowPath={() => setSheet(null)} onFollow={(id) => (setSheet(null), setTrackId(id), setTab("track"))} />}
      {sheet?.kind === "allcams" && <AllCamerasDialog state={state} idx={idx} onClose={() => setSheet(null)} onShowOnMap={(id) => (setSheet(null), setCameraId(id), setTab("cameras"))} />}
      {sheet?.kind === "tag" && (
        <TagDialog camera={sheet.cameraId ? idx.cameras.get(sheet.cameraId) : undefined} onClose={() => setSheet(null)} onCreated={(id) => (setSheet(null), setTrackId(id), setTab("track"))} />
      )}
    </div>
  );
}

function CameraList({ idx, onPick, onAll }: { idx: ReturnType<typeof indexSite>; onPick: (id: string) => void; onAll: () => void }) {
  const [q, setQ] = useState("");
  const cams = [...idx.cameras.values()]
    .filter((c) => !q || `${c.name} ${idx.zones.get(c.covers[0])?.name ?? ""}`.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div>
      <input placeholder="Search cameras or rooms…" value={q} onChange={(e) => setQ(e.target.value)} />
      <ul className="m-list">
        {cams.map((c) => (
          <li key={c.id} onClick={() => onPick(c.id)}>
            <span className="cam-mini">◉</span>
            <div className="grow">
              <strong>{c.name}</strong>
              <div className="muted small">{c.covers.map((z) => idx.zones.get(z)?.name).filter(Boolean).join(", ")}</div>
            </div>
            <span className="chev">›</span>
          </li>
        ))}
      </ul>
      {cams.length === 0 && <p className="muted">{idx.cameras.size === 0 ? "No cameras placed on the map yet." : "No match."}</p>}
      <button className="m-wide" onClick={onAll}>All cameras (including ones not on the map)</button>
    </div>
  );
}

function MobileCamera({ cameraId, state, idx, onBack, onTag, onFollow }: { cameraId: string; state: LiveState; idx: ReturnType<typeof indexSite>; onBack: () => void; onTag: (id: string) => void; onFollow: (trackId: string) => void }) {
  const cam = idx.cameras.get(cameraId)!;
  const { busy, error, run } = useAction();
  const active = state.tracks.filter((t) => t.status === "active");
  return (
    <div>
      <button className="btn-ghost small-btn" onClick={onBack}>‹ Cameras</button>
      <CameraFeed camera={cam} stream={state.streams[cam.id]} zones={idx.zones} sim={state.sim} emphasis live />
      <div className="m-actions">
        <button className="m-wide" onClick={() => onTag(cam.id)}>Tag a person here</button>
        {active.map((t) => (
          <button key={t.id} className="m-wide btn-primary" disabled={busy} onClick={() => run(async () => { await send(`/api/tracks/${t.id}/sightings`, { cameraId: cam.id }); onFollow(t.id); })}>
            {t.label} is here
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
