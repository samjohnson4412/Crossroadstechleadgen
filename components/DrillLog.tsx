"use client";

import { useEffect, useState } from "react";
import { ALERT_PRESETS } from "@/lib/core/alerts";

interface Drill {
  id: string;
  at: string;
  presetId: string;
  title: string;
  scope: string;
  by: string;
  channels: string[];
  clearedAt?: string;
  clearedBy?: string;
}

const mins = (d: Drill) => (d.clearedAt ? Math.round((Date.parse(d.clearedAt) - Date.parse(d.at)) / 60000) : null);

/** Every drill run from the Alert Center — for compliance records. */
export function DrillLog() {
  const [rows, setRows] = useState<Drill[] | null>(null);
  useEffect(() => {
    fetch("/api/drills").then((r) => r.json()).then(setRows).catch(() => setRows([]));
  }, []);
  const label = (id: string) => ALERT_PRESETS.find((p) => p.id === id)?.label ?? id;
  const csv = () => {
    const head = ["Date", "Type", "Title", "Where", "Started", "All clear", "Minutes", "Started by", "Cleared by", "Channels"];
    const lines = (rows ?? []).map((d) =>
      [new Date(d.at).toLocaleDateString(), label(d.presetId), d.title, d.scope, new Date(d.at).toLocaleTimeString(), d.clearedAt ? new Date(d.clearedAt).toLocaleTimeString() : "", mins(d) ?? "", d.by, d.clearedBy ?? "", d.channels.join(" ")]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(","),
    );
    const blob = new Blob([[head.join(","), ...lines].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `drill-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };
  return (
    <div className="settings-page">
      <header className="topbar">
        <div className="brand"><span className="logo">◆</span> Drill log</div>
        <span className="spacer" />
        <button disabled={!rows?.length} onClick={csv}>Export CSV</button>
        <a className="button-link" href="/incidents">Incidents</a>
        <a className="button-link" href="/">← Back to console</a>
      </header>
      <main className="settings-main">
        <p className="muted">Drills are sent from 🚨 Alert → “This is a drill”. Each one is logged here with its all clear.</p>
        {!rows && <p className="muted">Loading…</p>}
        {rows?.length === 0 && <p className="muted">No drills logged yet.</p>}
        {rows && rows.length > 0 && (
          <table className="table">
            <thead><tr><th>Date</th><th>Drill</th><th>Where</th><th>Started</th><th>All clear</th><th>Length</th><th>By</th></tr></thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <td>{new Date(d.at).toLocaleDateString()}</td>
                  <td><strong>{label(d.presetId)}</strong><div className="muted small">{d.title}</div></td>
                  <td>{d.scope}</td>
                  <td>{new Date(d.at).toLocaleTimeString()}</td>
                  <td>{d.clearedAt ? new Date(d.clearedAt).toLocaleTimeString() : <span className="health health-offline">not cleared</span>}</td>
                  <td>{mins(d) !== null ? `${mins(d)} min` : "—"}</td>
                  <td>{d.by}{d.clearedBy && d.clearedBy !== d.by ? ` / ${d.clearedBy}` : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </div>
  );
}
