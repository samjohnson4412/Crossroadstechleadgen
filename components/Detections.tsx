"use client";

import { useEffect, useMemo, useState } from "react";
import type { Detection, DetectionRule, RuleSeverity } from "@/lib/core/detections";
import type { LiveState } from "@/lib/core/live";
import { Modal, useAction, type SiteIndex } from "./Panels";
import { ago, useNow } from "./TrackView";
import { send } from "./useLive";

type Tab = "review" | "new" | "reviewed" | "rules" | "test";

export function needsReview(d: Detection) {
  return d.status === "new" && d.ruleHits.length > 0;
}

interface Props {
  state: LiveState;
  idx: SiteIndex;
  onClose: () => void;
  onShowCamera: (cameraId: string) => void;
  onTrack: (cameraId: string) => void;
  onLockdown: () => void;
}

/** Review queue for AI detections, plus the rules that decide what needs review. */
export function DetectionsPanel({ state, idx, onClose, onShowCamera, onTrack, onLockdown }: Props) {
  const [tab, setTab] = useState<Tab>("review");
  const list = state.detections.slice().reverse();
  const shown = tab === "review" ? list.filter(needsReview) : tab === "new" ? list.filter((d) => d.status === "new") : list.filter((d) => d.status !== "new");
  const counts = { review: list.filter(needsReview).length, new: list.filter((d) => d.status === "new").length };

  return (
    <Modal title="Detections" onClose={onClose}>
      <div className="chips tabs">
        <button className={tab === "review" ? "chip on" : "chip"} onClick={() => setTab("review")}>Needs review {counts.review > 0 && <span className="count">{counts.review}</span>}</button>
        <button className={tab === "new" ? "chip on" : "chip"} onClick={() => setTab("new")}>All new ({counts.new})</button>
        <button className={tab === "reviewed" ? "chip on" : "chip"} onClick={() => setTab("reviewed")}>Reviewed</button>
        <button className={tab === "rules" ? "chip on" : "chip"} onClick={() => setTab("rules")}>Rules</button>
        <button className={tab === "test" ? "chip on" : "chip"} onClick={() => setTab("test")}>Test</button>
      </div>

      {tab === "rules" && <RulesEditor idx={idx} />}
      {tab === "test" && <TestDetection idx={idx} />}
      {(tab === "review" || tab === "new" || tab === "reviewed") && (
        <>
          {tab === "reviewed" && <CameraStats detections={list} idx={idx} />}
          {shown.length === 0 && (
            <p className="muted">
              {tab === "review"
                ? "Nothing needs review. Detections that match a rule (weapon, after hours, loitering, restricted area) show up here."
                : state.detections.length === 0
                  ? "No AI detections yet. Point Blue Iris alerts at the console (see docs/BLUE_IRIS_SETUP.md), or try the Test tab."
                  : "Nothing here."}
            </p>
          )}
          <ul className="det-list">
            {shown.slice(0, 60).map((d) => (
              <DetectionItem key={d.id} d={d} idx={idx} onShowCamera={onShowCamera} onTrack={onTrack} onLockdown={onLockdown} />
            ))}
          </ul>
        </>
      )}
    </Modal>
  );
}

function DetectionItem({ d, idx, onShowCamera, onTrack, onLockdown }: { d: Detection; idx: SiteIndex; onShowCamera: (id: string) => void; onTrack: (id: string) => void; onLockdown: () => void }) {
  const now = useNow(5000);
  const { busy, error, run } = useAction();
  const review = (status: "real" | "false" | "new") => run(() => send(`/api/detections/${d.id}`, { status }));
  const cam = d.cameraId ? idx.cameras.get(d.cameraId) : undefined;
  return (
    <li className={`det det-${d.severity} det-${d.status}`}>
      <div className="det-thumb">
        {d.hasSnapshot ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={`/api/detections/${d.id}/snapshot`} alt={d.summary} />
        ) : (
          <span className="muted small">no snapshot</span>
        )}
      </div>
      <div className="grow">
        <div className="det-head">
          <strong>{cam?.name ?? d.externalCameraId}</strong>
          <span className="muted small">{new Date(d.at).toLocaleTimeString()} · {ago(d.at, now)}</span>
        </div>
        <div className="chips">
          {d.ruleHits.map((h) => <span key={h.ruleId} className={`rule-chip sev-${h.severity}`}>{h.name}</span>)}
          {d.labels.map((l, i) => <span key={i} className="label-chip">{l.label}{l.confidence !== undefined ? ` ${Math.round(l.confidence)}%` : ""}</span>)}
        </div>
        {d.status !== "new" && <div className="muted small">Marked {d.status === "real" ? "real" : "false alarm"} by {d.reviewedBy}</div>}
        {error && <p className="error">{error}</p>}
        <div className="btn-row">
          {d.status === "new" ? (
            <>
              <button className="btn-primary" disabled={busy} onClick={() => review("real")}>✓ Real</button>
              <button disabled={busy} onClick={() => review("false")}>✕ False alarm</button>
            </>
          ) : (
            <button className="btn-ghost small-btn" disabled={busy} onClick={() => review("new")}>Undo</button>
          )}
          {cam && <button onClick={() => onShowCamera(cam.id)}>Show camera</button>}
          {cam && d.labels.some((l) => l.label === "person") && <button onClick={() => onTrack(cam.id)}>Track person</button>}
          {d.severity === "critical" && <button className="btn-danger" onClick={onLockdown}>🔒 Lockdown…</button>}
        </div>
        {!cam && <div className="muted small">This camera isn&apos;t on the map yet.</div>}
      </div>
    </li>
  );
}

/** False-alarm rate per camera from reviewed detections: where to tune or retrain. */
function CameraStats({ detections, idx }: { detections: Detection[]; idx: SiteIndex }) {
  const rows = useMemo(() => {
    const by = new Map<string, { name: string; real: number; false: number }>();
    for (const d of detections) {
      if (d.status === "new") continue;
      const key = d.cameraId ?? d.externalCameraId ?? "?";
      const row = by.get(key) ?? { name: (d.cameraId && idx.cameras.get(d.cameraId)?.name) || d.externalCameraId || "?", real: 0, false: 0 };
      row[d.status === "real" ? "real" : "false"]++;
      by.set(key, row);
    }
    return [...by.values()].sort((a, b) => b.false - a.false).slice(0, 8);
  }, [detections, idx]);
  if (!rows.length) return null;
  return (
    <table className="table small det-stats">
      <thead><tr><th>Camera</th><th>Real</th><th>False alarms</th><th>False rate</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.name}><td>{r.name}</td><td>{r.real}</td><td>{r.false}</td><td>{Math.round((r.false / Math.max(1, r.real + r.false)) * 100)}%</td></tr>
        ))}
      </tbody>
    </table>
  );
}

function RulesEditor({ idx }: { idx: SiteIndex }) {
  const [rules, setRules] = useState<DetectionRule[] | null>(null);
  const [dirty, setDirty] = useState(false);
  const { busy, error, run } = useAction();
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    fetch("/api/detections/rules").then((r) => r.json()).then(setRules).catch(() => setRules([]));
  }, []);
  if (!rules) return <p className="muted">Loading…</p>;
  const update = (i: number, patch: Partial<DetectionRule>) => {
    setRules(rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
    setDirty(true);
    setSaved(false);
  };
  const zones = [...idx.zones.values()].sort((a, b) => a.name.localeCompare(b.name));
  return (
    <div>
      <p className="muted small">Detections matching an enabled rule go to “Needs review”. Critical ones also put a banner on every console.</p>
      {rules.map((r, i) => (
        <div key={r.id} className={`rule-card${r.enabled ? "" : " off"}`}>
          <div className="rule-top">
            <label className="toggle"><input type="checkbox" checked={r.enabled} onChange={(e) => update(i, { enabled: e.target.checked })} /></label>
            <input className="rule-name" value={r.name} onChange={(e) => update(i, { name: e.target.value })} />
            <select value={r.severity} onChange={(e) => update(i, { severity: e.target.value as RuleSeverity })}>
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>
            <button className="btn-ghost" title="Delete rule" onClick={() => (setRules(rules.filter((_, j) => j !== i)), setDirty(true))}>✕</button>
          </div>
          <div className="grid2">
            <label>Labels (comma separated; blank = any)<input value={r.labels.join(", ")} onChange={(e) => update(i, { labels: e.target.value.split(",").map((s) => s.trim().toLowerCase()) })} /></label>
            <label>Minimum confidence %<input type="number" min={0} max={100} value={r.minConfidence} onChange={(e) => update(i, { minConfidence: Number(e.target.value) })} /></label>
            <label>Only between (optional)
              <span className="row2"><input type="time" value={r.from ?? ""} onChange={(e) => update(i, { from: e.target.value || undefined })} /><input type="time" value={r.to ?? ""} onChange={(e) => update(i, { to: e.target.value || undefined })} /></span>
            </label>
            <label>Repeated (loitering): times / within minutes
              <span className="row2"><input type="number" min={1} value={r.count} onChange={(e) => update(i, { count: Number(e.target.value) })} /><input type="number" min={1} value={r.minutes} onChange={(e) => update(i, { minutes: Number(e.target.value) })} /></span>
            </label>
          </div>
          <label>Only in these areas (blank = everywhere)
            <select multiple value={r.zoneIds} onChange={(e) => update(i, { zoneIds: [...e.target.selectedOptions].map((o) => o.value) })} className="zone-multi">
              {zones.map((z) => <option key={z.id} value={z.id}>{z.name}{z.building ? ` — ${z.building}` : ""}</option>)}
            </select>
          </label>
        </div>
      ))}
      {error && <p className="error">{error}</p>}
      {saved && <p className="ok-text">Rules saved.</p>}
      <div className="btn-row end">
        <button
          onClick={() => {
            setRules([...rules, { id: `rule-${Date.now().toString(36)}`, name: "New rule", enabled: true, labels: ["person"], minConfidence: 60, zoneIds: [], count: 1, minutes: 1, severity: "warning" }]);
            setDirty(true);
          }}
        >
          + Add rule
        </button>
        <button className="btn-primary" disabled={busy || !dirty} onClick={() => run(async () => { setRules(await send("/api/detections/rules", { rules: rules.map((r) => ({ ...r, labels: r.labels.filter(Boolean) })) }, "PUT")); setDirty(false); setSaved(true); })}>
          Save rules
        </button>
      </div>
    </div>
  );
}

function TestDetection({ idx }: { idx: SiteIndex }) {
  const cams = [...idx.cameras.values()].sort((a, b) => a.name.localeCompare(b.name));
  const [cameraId, setCameraId] = useState(cams[0]?.id ?? "");
  const [labels, setLabels] = useState("person:90");
  const { busy, error, run } = useAction();
  const [sent, setSent] = useState(false);
  if (!cams.length) return <p className="muted">Place at least one camera on the map (✎ Edit map) to send a test detection.</p>;
  return (
    <div>
      <p className="muted small">Sends a made-up detection through the real pipeline: rules, snapshot, banners and the review queue. Use it to check your rules. It is marked TEST in the activity list.</p>
      <div className="grid2">
        <label>Camera
          <select value={cameraId} onChange={(e) => setCameraId(e.target.value)}>
            {cams.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <label>Labels (label:confidence, comma separated)<input value={labels} onChange={(e) => setLabels(e.target.value)} placeholder="gun:80, person:90" /></label>
      </div>
      {error && <p className="error">{error}</p>}
      {sent && <p className="ok-text">Sent — check “Needs review” / “All new”.</p>}
      <div className="btn-row end">
        <button
          className="btn-primary"
          disabled={busy}
          onClick={() =>
            run(async () => {
              const parsed = labels.split(",").map((p) => p.trim()).filter(Boolean).map((p) => {
                const [label, conf] = p.split(":");
                return { label: label.trim().toLowerCase(), confidence: conf ? Number(conf) : undefined };
              });
              await send("/api/detections/test", { cameraId, labels: parsed });
              setSent(true);
            })
          }
        >
          Send test detection
        </button>
      </div>
    </div>
  );
}

/** Red banner for critical detections nobody has reviewed yet. */
export function CriticalDetections({ state, idx, onReview, onLockdown }: { state: LiveState; idx: SiteIndex; onReview: () => void; onLockdown: () => void }) {
  const open = state.detections.filter((d) => d.status === "new" && d.severity === "critical").slice(-3).reverse();
  return (
    <>
      {open.map((d) => (
        <div key={d.id} className="alert-banner det-banner">
          <span className="ab-title">⚠ {d.ruleHits.map((h) => h.name).join(", ")}</span>
          <span className="ab-scope">{(d.cameraId && idx.cameras.get(d.cameraId)?.name) || d.externalCameraId} · {new Date(d.at).toLocaleTimeString()} · needs review</span>
          <span className="spacer" />
          <button className="ab-btn strong" onClick={onReview}>Review</button>
          <button className="ab-btn" onClick={onLockdown}>🔒 Lockdown…</button>
        </div>
      ))}
    </>
  );
}
