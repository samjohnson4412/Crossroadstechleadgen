"use client";

import { useEffect, useState } from "react";
import type { SecurityEvent } from "@/lib/core/events";
import type { LiveState } from "@/lib/core/live";
import type { PublicSite, Zone, CameraPlacement, DoorPlacement, DisplayPlacement } from "@/lib/core/site";
import type { DoorStatus } from "@/lib/integrations/types";
import { COLOR_NAMES } from "./CameraFeed";
import { send } from "./useLive";


export interface SiteIndex {
  zones: Map<string, Zone & { floorId: string }>;
  cameras: Map<string, CameraPlacement & { floorId: string }>;
  doors: Map<string, DoorPlacement & { floorId: string }>;
  displays: Map<string, DisplayPlacement & { floorId: string }>;
}

export function indexSite(site: PublicSite): SiteIndex {
  const idx: SiteIndex = { zones: new Map(), cameras: new Map(), doors: new Map(), displays: new Map() };
  for (const b of site.buildings)
    for (const f of b.floors) {
      f.zones.forEach((z) => idx.zones.set(z.id, { ...z, floorId: f.id }));
      f.cameras.forEach((c) => idx.cameras.set(c.id, { ...c, floorId: f.id }));
      f.doors.forEach((d) => idx.doors.set(d.id, { ...d, floorId: f.id }));
      f.displays.forEach((d) => idx.displays.set(d.id, { ...d, floorId: f.id }));
    }
  return idx;
}

export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return { busy, error, run };
}

export function describeDoor(status?: DoorStatus) {
  if (!status) return "No status";
  const lock = status.mode === "held-locked" ? "Held locked" : status.mode === "held-unlocked" ? "Held unlocked" : status.lock === "locked" ? "Locked" : status.lock === "unlocked" ? "Unlocked" : "Unknown";
  return `${lock} · ${status.position === "open" ? "Open" : status.position === "closed" ? "Closed" : "position unknown"}`;
}

export function DoorControls({ door, status, controllable = true }: { door: DoorPlacement; status?: DoorStatus; controllable?: boolean }) {
  const { busy, error, run } = useAction();
  if (!door.source) return <p className="muted">Not connected to access control (passage only).</p>;
  if (!controllable)
    return (
      <p className="muted small">
        Badge and door events from this door show in Activity and feed tracking. Locking/unlocking from the console isn&apos;t available on this
        access system yet — use its own software.
      </p>
    );
  const act = (action: string) => run(() => send(`/api/doors/${door.id}`, { action }));
  return (
    <div className="door-controls">
      <div className="door-status">{describeDoor(status)}</div>
      <div className="btn-row">
        <button disabled={busy} onClick={() => act("unlock")}>Unlock (momentary)</button>
        <button disabled={busy} className="btn-warn" onClick={() => act("hold-unlocked")}>Hold unlocked</button>
      </div>
      <div className="btn-row">
        <button disabled={busy} className="btn-lock" onClick={() => act("hold-locked")}>Hold locked</button>
        <button disabled={busy} onClick={() => act("reset")}>Return to schedule</button>
      </div>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

const SEVERITY_ICON: Record<string, string> = { critical: "▲", warning: "●", notice: "◆", info: "·" };

export function EventFeed({ events, idx, onLocate, hideDetections }: { events: SecurityEvent[]; idx: SiteIndex; onLocate: (e: SecurityEvent) => void; hideDetections: boolean }) {
  const shown = events.filter((e) => !hideDetections || (e.type !== "person.detected" && e.type !== "motion.detected" && e.type !== "door.opened" && e.type !== "door.closed")).slice(-80).reverse();
  return (
    <ul className="events">
      {shown.length === 0 && <li className="muted">No events yet.</li>}
      {shown.map((e) => (
        <li key={e.id} className={`event sev-${e.severity}`} onClick={() => onLocate(e)} title={e.zoneId ? `Show ${idx.zones.get(e.zoneId)?.name}` : undefined}>
          <span className="sev">{SEVERITY_ICON[e.severity]}</span>
          <span className="event-time">{new Date(e.at).toLocaleTimeString()}</span>
          <span className="event-text">{e.summary}</span>
        </li>
      ))}
    </ul>
  );
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="btn-ghost" onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function BroadcastDialog({ idx, onClose }: { idx: SiteIndex; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [level, setLevel] = useState<"info" | "warning" | "emergency">("warning");
  const [selected, setSelected] = useState<string[]>([]);
  const { busy, error, run } = useAction();
  const displays = [...idx.displays.values()];
  return (
    <Modal title="Message SMART Boards" onClose={onClose}>
      <label>Level
        <select value={level} onChange={(e) => setLevel(e.target.value as typeof level)}>
          <option value="info">Info</option>
          <option value="warning">Warning</option>
          <option value="emergency">Emergency</option>
        </select>
      </label>
      <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Shelter in place" /></label>
      <label>Message<textarea value={body} onChange={(e) => setBody(e.target.value)} rows={3} /></label>
      <div className="chips">
        <button className={selected.length === 0 ? "chip on" : "chip"} onClick={() => setSelected([])}>All displays</button>
        {displays.map((d) => (
          <button key={d.id} className={selected.includes(d.id) ? "chip on" : "chip"} onClick={() => setSelected((s) => (s.includes(d.id) ? s.filter((x) => x !== d.id) : [...s, d.id]))}>
            {d.name}
          </button>
        ))}
      </div>
      {error && <p className="error">{error}</p>}
      <div className="btn-row end">
        <button onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy || !title.trim()} onClick={() => run(async () => { await send("/api/messages", { title, body, level, displayIds: selected }); onClose(); })}>
          Send to {selected.length ? `${selected.length} display(s)` : "all displays"}
        </button>
      </div>
    </Modal>
  );
}

export function LockdownDialog({ active, onClose }: { active: boolean; onClose: () => void }) {
  const { busy, error, run } = useAction();
  return (
    <Modal title={active ? "Lift lockdown?" : "Initiate lockdown?"} onClose={onClose}>
      <p>{active ? "All controlled doors return to their normal schedules." : "Every access-controlled door on campus will be held locked until the lockdown is lifted. Badges will not open them."}</p>
      {error && <p className="error">{error}</p>}
      <div className="btn-row end">
        <button onClick={onClose}>Cancel</button>
        <button className={active ? "btn-primary" : "btn-danger"} disabled={busy} onClick={() => run(async () => { await send("/api/lockdown", { active: !active }); onClose(); })}>
          {active ? "Lift lockdown" : "LOCK DOWN CAMPUS"}
        </button>
      </div>
    </Modal>
  );
}

export function AlertDialog({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [detail, setDetail] = useState("");
  const { busy, error, run } = useAction();
  return (
    <Modal title="Raise alert (SaferWatch)" onClose={onClose}>
      <label>Title<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Intruder reported" /></label>
      <label>Details<textarea value={detail} onChange={(e) => setDetail(e.target.value)} rows={3} /></label>
      {error && <p className="error">{error}</p>}
      <div className="btn-row end">
        <button onClick={onClose}>Cancel</button>
        <button className="btn-danger" disabled={busy || !title.trim()} onClick={() => run(async () => { await send("/api/alerts", { title, detail }); onClose(); })}>Raise alert</button>
      </div>
    </Modal>
  );
}

/** Tag a person of interest — usually straight from the camera they're on. */
export function TagDialog({ camera, onClose, onCreated }: { camera?: CameraPlacement; onClose: () => void; onCreated: (trackId: string) => void }) {
  const [label, setLabel] = useState("");
  const [description, setDescription] = useState("");
  const [upperColor, setUpper] = useState("");
  const [lowerColor, setLower] = useState("");
  const [tags, setTags] = useState("");
  const [credential, setCredential] = useState("");
  const { busy, error, run } = useAction();
  return (
    <Modal title={camera ? `Tag person on ${camera.name}` : "Tag person of interest"} onClose={onClose}>
      <label>Label<input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Suspect A" autoFocus /></label>
      <label>Description<textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} placeholder="Height, build, anything distinctive" /></label>
      <div className="grid2">
        <label>Top color
          <select value={upperColor} onChange={(e) => setUpper(e.target.value)}>
            <option value="">Unknown</option>
            {COLOR_NAMES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label>Bottom color
          <select value={lowerColor} onChange={(e) => setLower(e.target.value)}>
            <option value="">Unknown</option>
            {COLOR_NAMES.map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
      </div>
      <label>Other features<input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="backpack, hat (comma separated)" /></label>
      <label>Badge / credential id (if known)<input value={credential} onChange={(e) => setCredential(e.target.value)} placeholder="Their swipes will auto-update the track" /></label>
      {error && <p className="error">{error}</p>}
      <div className="btn-row end">
        <button onClick={onClose}>Cancel</button>
        <button
          className="btn-primary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const tagList = tags.split(",").map((t) => t.trim()).filter(Boolean);
              const appearance = upperColor || lowerColor || tagList.length ? { upperColor: upperColor || undefined, lowerColor: lowerColor || undefined, tags: tagList } : undefined;
              const track = await send("/api/tracks", { label, description, appearance, credentialIds: credential ? [credential.trim()] : [], cameraId: camera?.id });
              onCreated(track.id);
              onClose();
            })
          }
        >
          Start tracking
        </button>
      </div>
    </Modal>
  );
}

export function IntegrationsDialog({ state, onClose }: { state: LiveState; onClose: () => void }) {
  return (
    <Modal title="Integrations" onClose={onClose}>
      <table className="table">
        <thead><tr><th>System</th><th>Provides</th><th>Status</th></tr></thead>
        <tbody>
          {state.integrations.map((i) => (
            <tr key={i.id}>
              <td><strong>{i.name}</strong><div className="muted small">{i.driverLabel}{i.simulated ? " · simulator" : ""}</div></td>
              <td className="small">{i.capabilities.join(", ")}</td>
              <td><span className={`health health-${i.health.state}`}>{i.health.state}</span><div className="muted small">{i.health.detail}</div></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted small">Integrations without credentials run on the building simulator. Set the environment variables in <code>.env.example</code> to connect the real systems.</p>
      <h4>Recent operator actions</h4>
      <ul className="audit">
        {state.audit.slice().reverse().map((a, i) => (
          <li key={i} className={a.ok ? "" : "error"}>{new Date(a.at).toLocaleTimeString()} — {a.actor}: {a.action} {a.target}{a.error ? ` (failed: ${a.error})` : ""}</li>
        ))}
        {state.audit.length === 0 && <li className="muted">None yet.</li>}
      </ul>
    </Modal>
  );
}

/** Panel heading that can be renamed in place. Saved on the server for everyone. */
export function EditableName({ kind, id, name, placeholder }: { kind: "zone" | "camera" | "door" | "display"; id: string; name: string; placeholder?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const { busy, error, run } = useAction();
  const save = () =>
    run(async () => {
      await send("/api/site", { kind, id, name: value }, "PATCH");
      setEditing(false);
    });
  if (!editing)
    return (
      <h3>
        {name}
        {placeholder && <span className="tag-placeholder" title="Location guessed; replace with the real device">PLACEHOLDER</span>}
        <button className="btn-ghost rename" title="Rename" onClick={() => (setValue(name), setEditing(true))}>✎ Rename</button>
      </h3>
    );
  return (
    <>
      <div className="name-edit">
        <input
          value={value}
          autoFocus
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") setEditing(false);
          }}
        />
        <button className="btn-primary" disabled={busy || !value.trim()} onClick={save}>Save</button>
        <button onClick={() => setEditing(false)}>Cancel</button>
      </div>
      {error && <p className="error">{error}</p>}
    </>
  );
}

/** Browse every camera the camera systems report — including ones not on the map — and watch one live. */
export function AllCamerasDialog({ state, idx, onClose, onShowOnMap }: { state: LiveState; idx: SiteIndex; onClose: () => void; onShowOnMap: (cameraId: string) => void }) {
  const systems = state.integrations.filter((i) => i.capabilities.includes("cameras") && i.health.state !== "unconfigured");
  type Cam = { integration: string; externalId: string; name: string; online: boolean };
  const [cams, setCams] = useState<Cam[] | null>(null);
  const [filter, setFilter] = useState("");
  const [watching, setWatching] = useState<Cam | null>(null);
  const [loadErrors, setLoadErrors] = useState<string[]>([]);
  const systemKey = systems.map((s) => s.id).join(",");

  useEffect(() => {
    const errors: string[] = [];
    Promise.all(
      systems.map((sys) =>
        fetch(`/api/integrations/${sys.id}/devices`)
          .then((r) => r.json())
          .then((d) => {
            if (d.error) errors.push(`${sys.name}: ${d.error}`);
            return ((d.cameras ?? []) as Omit<Cam, "integration">[]).map((c) => ({ ...c, integration: sys.id }));
          })
          .catch((e) => (errors.push(`${sys.name}: ${e}`), [] as Cam[])),
      ),
    ).then((lists) => {
      setCams(lists.flat());
      setLoadErrors(errors);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemKey]);

  const sysOf = (id: string) => systems.find((s) => s.id === id);
  const onMap = new Map([...idx.cameras.values()].map((c) => [`${c.source.integration}/${c.source.externalId}`, c.id]));
  const keyOf = (c: Cam) => `${c.integration}/${c.externalId}`;
  const shown = (cams ?? []).filter((c) => !filter || `${c.name} ${c.externalId}`.toLowerCase().includes(filter.toLowerCase()));

  return (
    <Modal title={`All cameras${cams ? ` (${cams.length})` : ""}`} onClose={onClose}>
      {systems.length === 0 && <p className="muted">No camera system configured.</p>}
      {loadErrors.map((e) => <p key={e} className="error">{e}</p>)}
      {watching && (
        <div className="feed feed-emphasis all-cams-live">
          <div className="feed-video">
            {sysOf(watching.integration)?.simulated ? (
              <div className="feed-empty">Simulator — connect Blue Iris to see live video.</div>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={`/api/integrations/${watching.integration}/cameras/${encodeURIComponent(watching.externalId)}/stream`} alt={watching.name} />
            )}
            <div className="feed-label"><span className="live-dot" /> {watching.name}</div>
          </div>
          <div className="feed-footer">
            {onMap.has(keyOf(watching)) ? (
              <button onClick={() => (onShowOnMap(onMap.get(keyOf(watching))!), onClose())}>Show on map</button>
            ) : (
              <span className="muted small">Not on the map yet — place it in ✎ Edit map.</span>
            )}
            <button onClick={() => setWatching(null)}>Close video</button>
          </div>
        </div>
      )}
      <input placeholder="Search cameras…" value={filter} onChange={(e) => setFilter(e.target.value)} autoFocus />
      {!cams && systems.length > 0 && <p className="muted small">Loading…</p>}
      <ul className="all-cams">
        {shown.map((c) => (
          <li key={keyOf(c)}>
            <button className={watching && keyOf(watching) === keyOf(c) ? "on" : ""} onClick={() => setWatching(c)}>
              <span className={`dot ${c.online ? "up" : ""}`} />
              {c.name}
              {systems.length > 1 && <span className="muted small"> · {sysOf(c.integration)?.name}</span>}
              {onMap.has(keyOf(c)) ? <span className="muted small"> · on map</span> : null}
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
