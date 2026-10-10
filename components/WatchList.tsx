"use client";

import { useEffect, useState } from "react";
import type { LiveState } from "@/lib/core/live";
import type { WatchEntry } from "@/lib/core/watchlist";
import { useAction, type SiteIndex } from "./Panels";
import { send } from "./useLive";

/** Red banner for each un-acknowledged watch-list hit. */
export function WatchHits({ state, onShowDoor, onFollow }: { state: LiveState; idx: SiteIndex; onShowDoor: (doorId: string) => void; onFollow: (trackId: string) => void }) {
  const { busy, run } = useAction();
  const open = state.watchHits.filter((h) => !h.acknowledgedBy).slice(-3).reverse();
  return (
    <>
      {open.map((h) => (
        <div key={h.id} className="alert-banner watch-banner">
          <span className="ab-title">👁 WATCH LIST: {h.name ?? "Card"} ({h.cardId})</span>
          <span className="ab-scope">
            {h.doorName ?? "unknown door"} · {h.granted ? "access granted" : "access denied"} · {new Date(h.at).toLocaleTimeString()} · {h.reason}
          </span>
          <span className="spacer" />
          {h.doorId && <button className="ab-btn" onClick={() => onShowDoor(h.doorId!)}>Cameras</button>}
          <button
            className="ab-btn"
            disabled={busy}
            onClick={() => run(async () => onFollow((await send("/api/tracks", { label: h.name ?? `Card ${h.cardId}`, credentialIds: [h.cardId], doorId: h.doorId })).id))}
          >
            Track
          </button>
          <button className="ab-btn strong" disabled={busy} onClick={() => run(() => send(`/api/watchlist/hits/${h.id}`, {}))}>Acknowledge</button>
        </div>
      ))}
    </>
  );
}

/** Hook for reading and changing the watch list. */
export function useWatchlist() {
  const [list, setList] = useState<WatchEntry[] | null>(null);
  const { busy, error, run } = useAction();
  useEffect(() => {
    fetch("/api/watchlist").then((r) => r.json()).then(setList).catch(() => setList([]));
  }, []);
  const save = (entries: WatchEntry[]) => run(async () => setList(await send("/api/watchlist", { entries }, "PUT")));
  return { list, busy, error, save };
}

export function WatchListEditor() {
  const { list, busy, error, save } = useWatchlist();
  const [card, setCard] = useState("");
  const [name, setName] = useState("");
  const [reason, setReason] = useState("");
  if (!list) return <p className="muted small">Loading…</p>;
  return (
    <div>
      <p className="muted small">If any of these cards is used at a door, every console gets a red banner and watch-list contacts get a text.</p>
      {list.length === 0 && <p className="muted">No cards on the watch list.</p>}
      <ul className="people">
        {list.map((w) => (
          <li key={w.cardId} style={{ cursor: "default" }}>
            <div className="grow">
              <strong>{w.name ?? `Card ${w.cardId}`}</strong> <span className="muted small">card {w.cardId}</span>
              <div className="muted small">{w.reason} · added by {w.addedBy} {new Date(w.addedAt).toLocaleDateString()}</div>
            </div>
            <button className="btn-ghost" disabled={busy} onClick={() => save(list.filter((x) => x.cardId !== w.cardId))}>Remove</button>
          </li>
        ))}
      </ul>
      <div className="section-title">Add a card</div>
      <div className="grid2">
        <label>Card number<input value={card} onChange={(e) => setCard(e.target.value)} /></label>
        <label>Name (optional)<input value={name} onChange={(e) => setName(e.target.value)} /></label>
      </div>
      <label>Reason<input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Lost badge, former employee, no-contact order" /></label>
      {error && <p className="error">{error}</p>}
      <div className="btn-row end">
        <button
          className="btn-primary"
          disabled={busy || !card.trim() || !reason.trim()}
          onClick={() => {
            save([...list, { cardId: card.trim(), name: name.trim() || undefined, reason: reason.trim(), addedBy: "", addedAt: "" }]);
            setCard("");
            setName("");
            setReason("");
          }}
        >
          Add to watch list
        </button>
      </div>
    </div>
  );
}
