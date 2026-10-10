"use client";

import { useEffect, useMemo, useState } from "react";

interface Row {
  integration: string;
  server: string;
  externalId: string;
  name: string;
  online: boolean | null;
  since?: string;
  onMap: boolean;
  mapName?: string;
  room?: string;
  detections7d: number;
  real: number;
  falseAlarms: number;
  lastDetection?: string;
}
interface Data {
  servers: { id: string; name: string; health?: { state: string; detail?: string }; simulated: boolean }[];
  cameras: Row[];
  checkedAt: string;
}

type Filter = "problems" | "all" | "offline" | "unplaced" | "noai";

/** Admin page: which cameras are offline, not on the map, without AI, or noisy. */
export function CameraHealth() {
  const [data, setData] = useState<Data | null>(null);
  const [filter, setFilter] = useState<Filter>("problems");
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const load = (refresh = false) => {
    setLoading(true);
    fetch(`/api/health/cameras${refresh ? "?refresh=1" : ""}`)
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  };
  useEffect(() => load(true), []);

  const rate = (r: Row) => (r.real + r.falseAlarms ? Math.round((r.falseAlarms / (r.real + r.falseAlarms)) * 100) : null);
  const problems = (r: Row) => r.online === false || r.online === null || !r.onMap || (rate(r) ?? 0) >= 50;
  const rows = useMemo(() => {
    const all = data?.cameras ?? [];
    const f = all.filter((r) =>
      filter === "all" ? true : filter === "offline" ? r.online !== true : filter === "unplaced" ? !r.onMap : filter === "noai" ? r.detections7d === 0 : problems(r),
    );
    return f
      .filter((r) => !q || `${r.name} ${r.mapName ?? ""} ${r.room ?? ""}`.toLowerCase().includes(q.toLowerCase()))
      .sort((a, b) => Number(a.online === true) - Number(b.online === true) || a.name.localeCompare(b.name));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, filter, q]);

  const cams = data?.cameras ?? [];
  const count = {
    total: cams.length,
    offline: cams.filter((r) => r.online === false).length,
    missing: cams.filter((r) => r.online === null).length,
    unplaced: cams.filter((r) => !r.onMap).length,
    noai: cams.filter((r) => r.detections7d === 0).length,
  };

  return (
    <div className="settings-page">
      <header className="topbar">
        <div className="brand"><span className="logo">◆</span> Camera health</div>
        <span className="spacer" />
        <button disabled={loading} onClick={() => load(true)}>{loading ? "Checking…" : "Check now"}</button>
        <a className="button-link" href="/settings">Settings</a>
        <a className="button-link" href="/">← Back to console</a>
      </header>
      <main className="settings-main">
        <div className="stats health-stats">
          <div><strong>{count.total}</strong><span>cameras</span></div>
          <div className={count.offline ? "bad" : ""}><strong>{count.offline}</strong><span>offline</span></div>
          <div className={count.missing ? "warn" : ""}><strong>{count.missing}</strong><span>on map but not on a server</span></div>
          <div className={count.unplaced ? "warn" : ""}><strong>{count.unplaced}</strong><span>not on the map</span></div>
          <div><strong>{count.noai}</strong><span>no AI detections in 7 days</span></div>
        </div>
        <div className="chips">
          {data?.servers.map((s) => (
            <span key={s.id} className="label-chip">
              {s.name}: <span className={`health health-${s.simulated ? "simulated" : s.health?.state}`}>{s.simulated ? "simulated" : s.health?.state}</span>
            </span>
          ))}
        </div>
        <div className="chips tabs" style={{ marginTop: 12 }}>
          {(
            [
              ["problems", "Needs attention"],
              ["offline", "Offline / missing"],
              ["unplaced", "Not on map"],
              ["noai", "No AI detections"],
              ["all", "All"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={filter === id ? "chip on" : "chip"} onClick={() => setFilter(id)}>{label}</button>
          ))}
          <input style={{ width: 220 }} placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {!data && <p className="muted">Checking cameras…</p>}
        {data && rows.length === 0 && <p className="muted">Nothing here{filter === "problems" ? " — every camera looks healthy." : "."}</p>}
        {rows.length > 0 && (
          <table className="table">
            <thead>
              <tr><th>Camera</th><th>Server</th><th>Status</th><th>On map</th><th>AI (7 days)</th><th>False alarms</th><th>Last detection</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const fr = rate(r);
                return (
                  <tr key={`${r.integration}/${r.externalId}`}>
                    <td><strong>{r.name}</strong><div className="muted small">{r.externalId}</div></td>
                    <td className="small">{r.server}</td>
                    <td>
                      {r.online === true ? <span className="health health-ok">online</span> : r.online === false ? <span className="health health-offline">offline</span> : <span className="health health-degraded">not found on server</span>}
                      {r.since && r.online === false && <div className="muted small">since {new Date(r.since).toLocaleString()}</div>}
                    </td>
                    <td className="small">{r.onMap ? r.room ?? "yes" : <span className="muted">not placed</span>}</td>
                    <td>{r.detections7d}</td>
                    <td className={fr !== null && fr >= 50 ? "error" : ""}>{fr === null ? "—" : `${fr}% (${r.falseAlarms}/${r.real + r.falseAlarms})`}</td>
                    <td className="small">{r.lastDetection ? new Date(r.lastDetection).toLocaleString() : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="muted small">
          Camera status comes from the Blue Iris servers and is re-checked every 5 minutes; cameras going offline are texted to contacts subscribed to “system”.
          False-alarm rates come from Real / False alarm reviews in Detections.
        </p>
      </main>
    </div>
  );
}
