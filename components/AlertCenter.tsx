"use client";

import { useMemo, useState } from "react";
import { ALERT_PRESETS, CHANNEL_LABELS, type Alert, type AlertChannel, type AlertPreset } from "@/lib/core/alerts";
import type { LiveState } from "@/lib/core/live";
import { bounds, centroid, type Floor, type PublicSite } from "@/lib/core/site";
import { useAction } from "./Panels";
import { send } from "./useLive";
import { useZoomPan, ZoomButtons } from "./useZoomPan";

const CHANNEL_CAPABILITY: Record<AlertChannel, string> = {
  displays: "messaging",
  paging: "paging",
  sms: "sms",
  saferwatch: "alerts",
  lockdown: "access-control",
};

/** Which systems back each channel, and whether they're real, simulated or missing. */
function channelStatus(state: LiveState, channel: AlertChannel) {
  const systems = state.integrations.filter((i) => i.capabilities.includes(CHANNEL_CAPABILITY[channel]) && i.health.state !== "unconfigured");
  if (!systems.length) return { label: "not connected", tone: "bad" };
  if (systems.every((s) => s.simulated)) return { label: "simulated", tone: "sim" };
  if (systems.some((s) => s.health.state === "offline")) return { label: "offline", tone: "bad" };
  return { label: systems.map((s) => s.name).join(", "), tone: "ok" };
}

export function scopeLabelFor(site: PublicSite, zoneIds: string[] | null) {
  if (!zoneIds) return "Entire campus";
  const all = site.buildings.flatMap((b) => b.floors.flatMap((f) => f.zones));
  const chosen = all.filter((z) => zoneIds.includes(z.id));
  const parts: string[] = [];
  const byBuilding = new Map<string, typeof chosen>();
  for (const z of chosen) byBuilding.set(z.building ?? "Other", [...(byBuilding.get(z.building ?? "Other") ?? []), z]);
  for (const [b, zs] of byBuilding) {
    const total = all.filter((z) => (z.building ?? "Other") === b).length;
    if (zs.length === total && b !== "Other") parts.push(`All of ${b}`);
    else parts.push(...zs.map((z) => z.name));
  }
  return parts.length > 4 ? `${parts.slice(0, 3).join(", ")} +${parts.length - 3} more` : parts.join(", ");
}

export function AlertCenter({ site, state, onClose, initialPresetId }: { site: PublicSite; state: LiveState; onClose: () => void; initialPresetId?: string }) {
  const floors = site.buildings.flatMap((b) => b.floors);
  const allZones = useMemo(() => floors.flatMap((f) => f.zones.map((z) => ({ ...z, floorId: f.id }))), [floors]);
  const buildings = [...new Set(allZones.map((z) => z.building).filter((b): b is string => !!b))];

  const [drill, setDrill] = useState(false);
  const [preset, setPreset] = useState<AlertPreset>(ALERT_PRESETS.find((p) => p.id === initialPresetId) ?? ALERT_PRESETS[0]);
  const [title, setTitle] = useState(preset.title);
  const [message, setMessage] = useState(preset.message);
  const [everywhere, setEverywhere] = useState(true);
  const [zones, setZones] = useState<string[]>([]);
  const [channels, setChannels] = useState<AlertChannel[]>(preset.channels);
  const [floorId, setFloorId] = useState(floors[0].id);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<Alert | null>(null);
  const { busy, error, run } = useAction();

  const pickPreset = (p: AlertPreset) => {
    setPreset(p);
    setTitle(p.title);
    setMessage(p.message);
    // In drill mode SaferWatch stays off unless someone ticks it on purpose.
    setChannels(drill ? p.channels.filter((c) => c !== "saferwatch") : p.channels);
    setConfirming(false);
  };
  const toggleZone = (id: string) => setZones((z) => (z.includes(id) ? z.filter((x) => x !== id) : [...z, id]));
  const toggleGroup = (ids: string[]) => setZones((z) => (ids.every((id) => z.includes(id)) ? z.filter((x) => !ids.includes(x)) : [...new Set([...z, ...ids])]));
  const toggleChannel = (c: AlertChannel) => setChannels((cs) => (cs.includes(c) ? cs.filter((x) => x !== c) : [...cs, c]));

  const zoneIds = everywhere ? null : zones;
  const scope = scopeLabelFor(site, zoneIds);
  const ready = title.trim() && channels.length && (everywhere || zones.length);

  const submit = () => {
    if (preset.level !== "info" && !confirming) return setConfirming(true);
    run(async () => {
      const alert = (await send("/api/alerts", { presetId: preset.id, level: preset.level, title, message, zoneIds, scopeLabel: scope, channels, drill })) as Alert;
      setResult(alert);
    });
  };

  if (result) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal alert-center" onClick={(e) => e.stopPropagation()}>
          <div className="modal-head">
            <h3>{preset.icon} {result.title} sent</h3>
            <button className="btn-ghost" onClick={onClose}>✕</button>
          </div>
          <p className="muted">{result.scopeLabel} · {new Date(result.at).toLocaleTimeString()}</p>
          <DeliveryList alert={result} />
          <div className="btn-row end"><button className="btn-primary" onClick={onClose}>Done</button></div>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal alert-center" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>🚨 Send alert</h3>
          <button className="btn-ghost" onClick={onClose}>✕</button>
        </div>

        <label className={`drill-toggle${drill ? " on" : ""}`}>
          <input
            type="checkbox"
            checked={drill}
            onChange={(e) => {
              setDrill(e.target.checked);
              setConfirming(false);
              // Don't notify SaferWatch (and through it, police) about a drill.
              if (e.target.checked) setChannels((cs) => cs.filter((c) => c !== "saferwatch"));
            }}
          />
          <span><strong>This is a drill</strong> — marked “DRILL” on every channel, SaferWatch left off, and logged in the drill log</span>
        </label>

        <div className="ac-section">1 · What</div>
        <div className="preset-grid">
          {ALERT_PRESETS.map((p) => (
            <button key={p.id} className={`preset${p.id === preset.id ? " on" : ""}`} style={{ "--preset": p.color } as React.CSSProperties} onClick={() => pickPreset(p)}>
              <span className="preset-icon">{p.icon}</span>
              {p.label}
            </button>
          ))}
        </div>
        <div className="grid2">
          <label>Title<input value={title} onChange={(e) => (setTitle(e.target.value), setConfirming(false))} placeholder="Shown large on boards" /></label>
          <label>Message<textarea rows={2} value={message} onChange={(e) => (setMessage(e.target.value), setConfirming(false))} /></label>
        </div>

        <div className="ac-section">2 · Where</div>
        <div className="chips">
          <button className={everywhere ? "chip on" : "chip"} onClick={() => (setEverywhere(true), setConfirming(false))}>Entire campus</button>
          <button className={!everywhere ? "chip on" : "chip"} onClick={() => (setEverywhere(false), setConfirming(false))}>Choose buildings / rooms</button>
        </div>
        {!everywhere && (
          <div className="ac-where">
            <div className="chips">
              {buildings.map((b) => {
                const ids = allZones.filter((z) => z.building === b).map((z) => z.id);
                const on = ids.every((id) => zones.includes(id));
                return <button key={b} className={on ? "chip on" : "chip"} onClick={() => toggleGroup(ids)}>All of {b}</button>;
              })}
              {floors.map((f) => {
                const ids = f.zones.filter((z) => z.kind !== "outdoor").map((z) => z.id);
                return <button key={f.id} className={ids.every((id) => zones.includes(id)) ? "chip on" : "chip"} onClick={() => toggleGroup(ids)}>All of {f.name}</button>;
              })}
              {zones.length > 0 && <button className="chip" onClick={() => setZones([])}>Clear</button>}
            </div>
            <div className="chips">
              {floors.map((f) => (
                <button key={f.id} className={f.id === floorId ? "chip on" : "chip"} onClick={() => setFloorId(f.id)}>{f.name}</button>
              ))}
              <span className="muted small">Click rooms on the map to add or remove them · {zones.length} selected</span>
            </div>
            <ZonePicker floor={floors.find((f) => f.id === floorId)!} selected={zones} onToggle={toggleZone} />
          </div>
        )}

        <div className="ac-section">3 · How</div>
        <div className="channel-list">
          {(Object.keys(CHANNEL_LABELS) as AlertChannel[]).map((c) => {
            const st = channelStatus(state, c);
            return (
              <label key={c} className={`channel${channels.includes(c) ? " on" : ""}`}>
                <input type="checkbox" checked={channels.includes(c)} onChange={() => (toggleChannel(c), setConfirming(false))} />
                <span className="grow">{CHANNEL_LABELS[c]}{c === "lockdown" && <span className="muted small"> (campus-wide)</span>}</span>
                <span className={`ch-status ${st.tone}`}>{st.label}</span>
              </label>
            );
          })}
        </div>

        {error && <p className="error">{error}</p>}
        <div className="ac-summary" style={{ borderColor: preset.color }}>
          <div>
            <strong>{drill ? "DRILL: " : ""}{title || "(no title)"}</strong> → {scope || "no areas chosen"}
            <div className="muted small">via {channels.map((c) => CHANNEL_LABELS[c]).join(", ") || "nothing selected"}</div>
          </div>
          <button className={preset.level === "info" ? "btn-primary" : "btn-danger"} disabled={busy || !ready} onClick={submit}>
            {busy ? "Sending…" : confirming ? `Confirm: send ${drill ? "DRILL " : ""}${preset.label.toUpperCase()}` : preset.level === "info" ? "Send" : `Send ${drill ? "drill: " : ""}${preset.label}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Small clickable map for picking rooms. */
function ZonePicker({ floor, selected, onToggle }: { floor: Floor; selected: string[]; onToggle: (id: string) => void }) {
  const zp = useZoomPan(floor);
  const k = floor.width / 1000;
  return (
    <div className="map-wrap ac-map">
      <svg ref={zp.svgRef} className="map map-compact" viewBox={`${zp.vb.x} ${zp.vb.y} ${zp.vb.w} ${zp.vb.h}`} {...zp.panHandlers}>
        {floor.background && <image href={floor.background} x={0} y={0} width={floor.width} height={floor.height} className="map-bg" opacity={0.45} />}
        {floor.zones.map((z) => {
          const c = centroid(z.polygon);
          const b = bounds(z.polygon);
          const on = selected.includes(z.id);
          const fontSize = Math.min(13 * k, (b.w * 0.9) / Math.max(4, z.name.length * 0.58), b.h * 0.45);
          return (
            <g key={z.id} onClick={(e) => (e.stopPropagation(), !zp.suppressClick.current && onToggle(z.id))} className="zone">
              <polygon points={z.polygon.map((p) => `${p.x},${p.y}`).join(" ")} className={`zone-shape zone-${z.kind}${on ? " alert-on" : ""}`} strokeWidth={2 * k} />
              {fontSize >= 3.5 && <text x={c.x} y={c.y} className="zone-label" fontSize={fontSize}>{z.name}</text>}
            </g>
          );
        })}
      </svg>
      <ZoomButtons zoomAt={zp.zoomAt} zoomed={zp.zoomed} reset={() => zp.setVb(zp.full)} />
    </div>
  );
}

export function DeliveryList({ alert }: { alert: Alert }) {
  if (!alert.deliveries.length) return <p className="muted small">Sending…</p>;
  return (
    <ul className="deliveries">
      {alert.deliveries.map((d, i) => (
        <li key={i} className={`dl-${d.status}`}>
          <span className="dl-icon">{d.status === "sent" ? "✓" : d.status === "simulated" ? "◌" : d.status === "skipped" ? "–" : "✕"}</span>
          <span className="grow">
            <strong>{CHANNEL_LABELS[d.channel]}</strong> · {d.system}
            {d.detail && <span className="muted small"> — {d.detail}</span>}
          </span>
          <span className="dl-status">{d.status}</span>
        </li>
      ))}
    </ul>
  );
}

/** Banner for each active alert, with delivery results and All clear. */
export function ActiveAlerts({ state }: { state: LiveState }) {
  const active = state.alerts.filter((a) => a.status === "active");
  const [open, setOpen] = useState<string | null>(null);
  const [clearing, setClearing] = useState<Alert | null>(null);
  const [lift, setLift] = useState(true);
  const { busy, error, run } = useAction();
  return (
    <>
      {active.map((a) => {
        const preset = ALERT_PRESETS.find((p) => p.id === a.presetId);
        const failed = a.deliveries.filter((d) => d.status === "failed").length;
        return (
          <div key={a.id} className="alert-banner" style={{ background: preset?.color ?? "var(--danger)" }}>
            <span className="ab-title">{preset?.icon} {a.title}</span>
            <span className="ab-scope">{a.scopeLabel} · {new Date(a.at).toLocaleTimeString()} · by {a.by}</span>
            <span className="spacer" />
            <button className="ab-btn" onClick={() => setOpen(open === a.id ? null : a.id)}>
              {a.deliveries.length ? `${a.deliveries.filter((d) => d.status === "sent" || d.status === "simulated").length}/${a.deliveries.length} delivered${failed ? ` · ${failed} failed` : ""}` : "sending…"}
            </button>
            <button className="ab-btn strong" onClick={() => (setClearing(a), setLift(true))}>All clear</button>
            {open === a.id && (
              <div className="ab-details" onClick={(e) => e.stopPropagation()}>
                <DeliveryList alert={a} />
              </div>
            )}
          </div>
        );
      })}
      {clearing && (
        <div className="modal-backdrop" onClick={() => setClearing(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head"><h3>All clear: {clearing.title}?</h3><button className="btn-ghost" onClick={() => setClearing(null)}>✕</button></div>
            <p>Sends “All clear” to {clearing.scopeLabel} on the same channels ({clearing.channels.map((c) => CHANNEL_LABELS[c]).join(", ")}).</p>
            {clearing.channels.includes("lockdown") && (
              <label className="toggle"><input type="checkbox" checked={lift} onChange={(e) => setLift(e.target.checked)} /> Also unlock doors (lift lockdown)</label>
            )}
            {error && <p className="error">{error}</p>}
            <div className="btn-row end">
              <button onClick={() => setClearing(null)}>Cancel</button>
              <button className="btn-primary" disabled={busy} onClick={() => run(async () => { await send(`/api/alerts/${clearing.id}/clear`, { liftLockdown: lift }); setClearing(null); })}>Send all clear</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
