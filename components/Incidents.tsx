"use client";

import { useEffect, useState } from "react";
import { CHANNEL_LABELS, type Alert } from "@/lib/core/alerts";
import type { Detection } from "@/lib/core/detections";
import type { Incident } from "@/lib/core/incidents";
import type { LiveState } from "@/lib/core/live";
import type { Track } from "@/lib/tracking/tracker";
import { Modal, useAction } from "./Panels";
import { ago, useNow } from "./TrackView";
import { send } from "./useLive";

const duration = (from: string, to?: string) => {
  const s = Math.max(0, Math.round(((to ? Date.parse(to) : Date.now()) - Date.parse(from)) / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m ${s % 60}s`;
};

/** Banner while an incident is open: note, report, close. */
export function OpenIncidentBar({ state }: { state: LiveState }) {
  const now = useNow(5000);
  const [note, setNote] = useState("");
  const [closing, setClosing] = useState(false);
  const [summary, setSummary] = useState("");
  const { busy, error, run } = useAction();
  const inc = state.incident;
  if (!inc) return null;
  void now;
  return (
    <div className="incident-bar">
      <span className="ib-title">● INCIDENT{inc.drill ? " (DRILL)" : ""}: {inc.title}</span>
      <span className="muted small">open {duration(inc.openedAt)} · {inc.timeline.length} entries</span>
      <span className="spacer" />
      <input className="ib-note" placeholder="Add a note to the record…" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && note.trim() && run(async () => { await send(`/api/incidents/${inc.id}/notes`, { text: note }); setNote(""); })} />
      <button className="small-btn" disabled={busy || !note.trim()} onClick={() => run(async () => { await send(`/api/incidents/${inc.id}/notes`, { text: note }); setNote(""); })}>Add note</button>
      <a className="button-link small-btn" href={`/incidents/${inc.id}`} target="_blank" rel="noreferrer">Report</a>
      <button className="small-btn" onClick={() => setClosing(true)}>Close incident</button>
      {error && <span className="error">{error}</span>}
      {closing && (
        <Modal title="Close incident" onClose={() => setClosing(false)}>
          <label>What happened and how it ended (goes at the top of the report)
            <textarea rows={4} value={summary} onChange={(e) => setSummary(e.target.value)} />
          </label>
          <div className="btn-row end">
            <button onClick={() => setClosing(false)}>Cancel</button>
            <button className="btn-primary" disabled={busy} onClick={() => run(async () => { await send(`/api/incidents/${inc.id}/close`, { summary }); setClosing(false); window.open(`/incidents/${inc.id}`, "_blank"); })}>
              Close and open report
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

export function StartIncidentDialog({ onClose }: { onClose: () => void }) {
  const [title, setTitle] = useState("");
  const { busy, error, run } = useAction();
  return (
    <Modal title="Start an incident" onClose={onClose}>
      <p className="muted small">Everything from now on (and the 10 minutes before) is recorded in one timeline: alerts, doors and badges, detections, tracking, operator actions and notes. Emergency alerts start one automatically.</p>
      <label>What's happening<input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Unknown man in Education building" /></label>
      {error && <p className="error">{error}</p>}
      <div className="btn-row end">
        <button onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={busy || !title.trim()} onClick={() => run(async () => { await send("/api/incidents", { title }); onClose(); })}>Start incident</button>
      </div>
    </Modal>
  );
}

type IncidentSummary = Omit<Incident, "timeline"> & { items: number };

export function IncidentList() {
  const [list, setList] = useState<IncidentSummary[] | null>(null);
  useEffect(() => {
    fetch("/api/incidents").then((r) => r.json()).then(setList).catch(() => setList([]));
  }, []);
  return (
    <div className="settings-page">
      <header className="topbar">
        <div className="brand"><span className="logo">◆</span> Incidents</div>
        <span className="spacer" />
        <a className="button-link" href="/drills">Drill log</a>
        <a className="button-link" href="/">← Back to console</a>
      </header>
      <main className="settings-main">
        {!list && <p className="muted">Loading…</p>}
        {list?.length === 0 && <p className="muted">No incidents yet. Sending an emergency alert, or “Start incident”, opens one.</p>}
        <table className="table">
          <thead><tr><th>Opened</th><th>Incident</th><th>Duration</th><th>By</th><th>Status</th><th /></tr></thead>
          <tbody>
            {list?.map((i) => (
              <tr key={i.id}>
                <td>{new Date(i.openedAt).toLocaleString()}</td>
                <td><strong>{i.title}</strong>{i.drill && <span className="drill-chip">DRILL</span>}<div className="muted small">{i.items} entries · {i.alertIds.length} alert(s) · {i.trackIds.length} track(s)</div></td>
                <td>{duration(i.openedAt, i.closedAt)}</td>
                <td>{i.openedBy}</td>
                <td>{i.status === "open" ? <span className="health health-offline">open</span> : "closed"}</td>
                <td><a className="button-link small-btn" href={`/incidents/${i.id}`}>Report</a></td>
              </tr>
            ))}
          </tbody>
        </table>
      </main>
    </div>
  );
}

interface ReportData {
  incident: Incident;
  siteName: string;
  alerts: Alert[];
  tracks: Track[];
  detections: Detection[];
  names: { zones: Record<string, string>; cameras: Record<string, string>; doors: Record<string, string> };
}

/** Printable incident report (browser Print → Save as PDF). */
export function IncidentReport({ id }: { id: string }) {
  const [data, setData] = useState<ReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const now = useNow(10_000);
  useEffect(() => {
    fetch(`/api/incidents/${id}`).then((r) => r.json()).then((d) => (d.error ? setError(d.error) : setData(d))).catch((e) => setError(String(e)));
  }, [id, now]);
  if (error) return <p className="error">{error}</p>;
  if (!data) return <p className="muted">Loading…</p>;
  const { incident: inc, alerts, tracks, detections, names } = data;
  const t = (iso: string) => new Date(iso).toLocaleTimeString();
  return (
    <div className="report">
      <div className="report-actions no-print">
        <a className="button-link" href="/incidents">← All incidents</a>
        <button className="btn-primary" onClick={() => window.print()}>Print / Save as PDF</button>
      </div>
      <h1>{inc.title}{inc.drill && <span className="drill-chip">DRILL</span>}</h1>
      <p className="report-meta">
        {data.siteName} · Incident report · {new Date(inc.openedAt).toLocaleDateString()}<br />
        Opened {new Date(inc.openedAt).toLocaleString()} by {inc.openedBy}
        {inc.closedAt ? <> · Closed {new Date(inc.closedAt).toLocaleString()} by {inc.closedBy} · Duration {duration(inc.openedAt, inc.closedAt)}</> : <> · <strong>Still open</strong> ({ago(inc.openedAt, now).replace(" ago", "")})</>}
      </p>
      {inc.summary && (
        <section>
          <h2>Summary</h2>
          <p className="report-summary">{inc.summary}</p>
        </section>
      )}

      <section>
        <h2>Alerts sent ({alerts.length})</h2>
        {alerts.length === 0 && <p className="muted">None.</p>}
        {alerts.map((a) => (
          <div key={a.id} className="report-block">
            <strong>{t(a.at)} — {a.title}</strong> → {a.scopeLabel} <span className="muted">(by {a.by}{a.status === "cleared" ? `; all clear ${t(a.clearedAt!)} by ${a.clearedBy}` : ""})</span>
            <div>{a.message}</div>
            <ul className="report-list">
              {a.deliveries.map((d, i) => <li key={i}>{CHANNEL_LABELS[d.channel]} · {d.system}: {d.status}{d.detail ? ` — ${d.detail}` : ""}</li>)}
            </ul>
          </div>
        ))}
      </section>

      {tracks.length > 0 && (
        <section>
          <h2>People tracked ({tracks.length})</h2>
          {tracks.map((tr) => (
            <div key={tr.id} className="report-block">
              <strong>{tr.label}</strong>{tr.description ? ` — ${tr.description}` : ""}
              <ul className="report-list">
                {tr.sightings.map((s) => (
                  <li key={s.id}>
                    {t(s.at)} · {names.zones[s.zoneId] ?? s.zoneId}
                    {s.cameraId ? ` (camera: ${names.cameras[s.cameraId] ?? s.cameraId})` : ""}
                    {s.doorId ? ` (door: ${names.doors[s.doorId] ?? s.doorId})` : ""} · {s.source === "operator" ? "seen" : s.source === "access" ? "badge" : "AI"}{s.by ? ` by ${s.by}` : ""}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      )}

      {detections.length > 0 && (
        <section>
          <h2>Detections ({detections.length})</h2>
          <div className="report-dets">
            {detections.map((d) => (
              <figure key={d.id}>
                {d.hasSnapshot ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={`/api/detections/${d.id}/snapshot`} alt={d.summary} />
                ) : (
                  <div className="report-noimg">no snapshot</div>
                )}
                <figcaption>{t(d.at)} · {d.ruleHits.map((h) => h.name).join(", ")} · {d.summary}{d.status !== "new" ? ` · marked ${d.status} by ${d.reviewedBy}` : ""}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      <section>
        <h2>Timeline ({inc.timeline.length})</h2>
        <table className="report-table">
          <tbody>
            {inc.timeline
              .slice()
              .sort((a, b) => a.at.localeCompare(b.at))
              .map((item, i) => (
                <tr key={i} className={`ri-${item.kind} ri-${item.severity ?? ""}`}>
                  <td className="nowrap">{t(item.at)}</td>
                  <td className="ri-kind">{item.kind}</td>
                  <td>{item.text}{item.by ? <span className="muted"> — {item.by}</span> : null}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </section>
      <p className="report-foot muted">Generated {new Date().toLocaleString()} by the campus security console.</p>
    </div>
  );
}
