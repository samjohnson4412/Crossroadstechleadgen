"use client";

import { useEffect, useState } from "react";
import { Modal, useAction, type SiteIndex } from "./Panels";
import { ago, useNow } from "./TrackView";
import { send } from "./useLive";

interface PersonSummary {
  cardId: string;
  name?: string;
  lastAt: string;
  lastDoor?: string;
  lastZoneId?: string;
  todayCount: number;
  denied: number;
}

interface BadgeEvent {
  at: string;
  cardId: string;
  name?: string;
  doorId?: string;
  doorName?: string;
  zoneId?: string;
  granted: boolean;
  action: string;
}

export interface BadgePath {
  label: string;
  doorIds: string[];
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

/** Find anyone who badged: where they were last, their swipes for a day, their path on the map. */
export function PeoplePanel({ idx, onClose, onShowPath, onFollow }: { idx: SiteIndex; onClose: () => void; onShowPath: (p: BadgePath) => void; onFollow: (trackId: string) => void }) {
  const now = useNow(10_000);
  const [q, setQ] = useState("");
  const [people, setPeople] = useState<PersonSummary[] | null>(null);
  const [selected, setSelected] = useState<PersonSummary | null>(null);
  const [date, setDate] = useState(today());
  const [history, setHistory] = useState<BadgeEvent[] | null>(null);
  const { busy, error, run } = useAction();

  useEffect(() => {
    const t = setTimeout(() => {
      fetch(`/api/people?q=${encodeURIComponent(q)}`).then((r) => r.json()).then(setPeople).catch(() => setPeople([]));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!selected) return;
    setHistory(null);
    fetch(`/api/people/${encodeURIComponent(selected.cardId)}?date=${date}`).then((r) => r.json()).then(setHistory).catch(() => setHistory([]));
  }, [selected, date]);

  const label = (p: PersonSummary) => p.name ?? `Card ${p.cardId}`;

  return (
    <Modal title="People (badge tracking)" onClose={onClose}>
      {!selected ? (
        <>
          <input autoFocus placeholder="Search name or card number…" value={q} onChange={(e) => setQ(e.target.value)} />
          {!people && <p className="muted small">Loading…</p>}
          {people?.length === 0 && <p className="muted">No badge swipes {q ? "match" : "recorded yet"}. They appear here as IDentiPASS reports them.</p>}
          <ul className="people">
            {people?.map((p) => (
              <li key={p.cardId} onClick={() => setSelected(p)}>
                <div className="grow">
                  <strong>{label(p)}</strong> <span className="muted small">card {p.cardId}</span>
                  <div className="muted small">Last: {p.lastDoor ?? "unknown door"} · {ago(p.lastAt, now)}</div>
                </div>
                <span className="muted small">{p.todayCount} today{p.denied ? ` · ${p.denied} denied` : ""}</span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <>
          <button className="btn-ghost small-btn" onClick={() => setSelected(null)}>← All people</button>
          <h3 className="person-name">{label(selected)} <span className="muted small">card {selected.cardId}</span></h3>
          <div className="btn-row">
            <input type="date" value={date} max={today()} onChange={(e) => setDate(e.target.value)} style={{ width: "auto" }} />
            <button
              disabled={!history?.some((h) => h.doorId)}
              onClick={() => {
                onShowPath({ label: `${label(selected)} · ${date === today() ? "today" : date}`, doorIds: (history ?? []).map((h) => h.doorId).filter((d): d is string => !!d) });
                onClose();
              }}
            >
              Show path on map
            </button>
            <button
              className="btn-primary"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const lastDoor = [...(history ?? [])].reverse().find((h) => h.doorId)?.doorId;
                  const track = await send("/api/tracks", { label: label(selected), credentialIds: [selected.cardId], doorId: date === today() ? lastDoor : undefined });
                  onFollow(track.id);
                  onClose();
                })
              }
            >
              Track this person
            </button>
          </div>
          <p className="muted small">Tracking follows every new swipe of this card automatically, alongside cameras.</p>
          {error && <p className="error">{error}</p>}
          {!history && <p className="muted small">Loading…</p>}
          {history?.length === 0 && <p className="muted">No swipes on this day.</p>}
          <ol className="timeline">
            {history?.slice().reverse().map((h, i) => (
              <li key={i}>
                <span className="event-time">{new Date(h.at).toLocaleTimeString()}</span>
                <span>
                  {h.doorName ?? "unknown door"}
                  {h.zoneId && idx.zones.get(h.zoneId) && <span className="muted"> · {idx.zones.get(h.zoneId)!.name}</span>}
                </span>
                <span className={`src ${h.granted ? "src-access" : "src-denied"}`}>{h.granted ? "granted" : "denied"}</span>
              </li>
            ))}
          </ol>
        </>
      )}
    </Modal>
  );
}
