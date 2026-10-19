"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SiteGraph } from "@/lib/core/graph";
import type { LiveState } from "@/lib/core/live";
import { CameraFeed, LiveImage, SnapshotImage } from "./CameraFeed";
import type { SiteIndex } from "./Panels";

/**
 * Camera wall: a grid of cameras you pick by building, level or favourites, with
 * paging and an optional auto-cycle. Click a camera to watch it large (live), with
 * the cameras around it underneath. Tiles are refreshing snapshots (browsers allow
 * only a few live streams per server); the large one is live.
 */

interface VendorCam {
  integration: string;
  externalId: string;
  name: string;
  online?: boolean;
}
/** A wall tile: a camera on the map (has an id) or one only the camera server knows about. */
type WallCam = { key: string; name: string; mapId?: string; vendor?: VendorCam };

const SIZES = [1, 4, 9, 16, 25, 36];
const load = <T,>(k: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(k);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const save = (k: string, v: unknown) => {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch {}
};

export function CameraWall({
  state,
  idx,
  graph,
  contextZoneId,
  levels,
  compact,
  onShowOnMap,
  onTrack,
}: {
  state: LiveState;
  idx: SiteIndex;
  graph: SiteGraph;
  /** In the split view: the room picked on the map, to show its cameras. */
  contextZoneId?: string | null;
  levels: { id: string; name: string }[];
  compact?: boolean;
  onShowOnMap: (cameraId: string) => void;
  onTrack: (cameraId: string) => void;
}) {
  const systems = state.integrations.filter((i) => i.capabilities.includes("cameras") && i.health.state !== "unconfigured" && !i.simulated);
  const systemKey = systems.map((s) => s.id).join(",");
  const [vendor, setVendor] = useState<VendorCam[]>([]);
  useEffect(() => {
    Promise.all(
      systems.map((sys) =>
        fetch(`/api/integrations/${sys.id}/devices`)
          .then((r) => r.json())
          .then((d) => ((d.cameras ?? []) as VendorCam[]).map((c) => ({ ...c, integration: sys.id })))
          .catch(() => [] as VendorCam[]),
      ),
    ).then((l) => setVendor(l.flat()));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemKey]);

  const prefix = compact ? "sentinel.wall.split." : "sentinel.wall.";
  const [group, setGroup] = useState<string>(() => load(prefix + "group", compact ? "context" : "all"));
  const [size, setSize] = useState<number>(() => load(prefix + "size", compact ? 4 : 9));
  const [favorites, setFavorites] = useState<string[]>(() => load("sentinel.wall.favorites", []));
  const [cycle, setCycle] = useState<boolean>(() => load(prefix + "cycle", false));
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [focus, setFocus] = useState<WallCam | null>(null);
  const wallRef = useRef<HTMLDivElement>(null);
  useEffect(() => save(prefix + "group", group), [prefix, group]);
  useEffect(() => save(prefix + "size", size), [prefix, size]);
  useEffect(() => save(prefix + "cycle", cycle), [prefix, cycle]);
  useEffect(() => save("sentinel.wall.favorites", favorites), [favorites]);

  // Every camera: the ones on the map, plus the camera servers' cameras not placed yet.
  const all = useMemo(() => {
    const out: WallCam[] = [];
    const placed = new Set<string>();
    for (const c of idx.cameras.values()) {
      out.push({ key: `map:${c.id}`, name: c.name, mapId: c.id });
      placed.add(`${c.source.integration}/${c.source.externalId}`);
    }
    for (const v of vendor) if (!placed.has(`${v.integration}/${v.externalId}`)) out.push({ key: `v:${v.integration}/${v.externalId}`, name: v.name, vendor: v });
    return out.sort((a, b) => a.name.localeCompare(b.name));
  }, [idx, vendor]);

  const buildingOf = (c: WallCam) => {
    if (!c.mapId) return undefined;
    const cam = idx.cameras.get(c.mapId)!;
    const zone = cam.covers.map((z) => idx.zones.get(z)).find(Boolean);
    return zone?.building ?? (zone?.kind === "outdoor" ? "Outside" : undefined);
  };
  const buildings = [...new Set(all.map(buildingOf).filter((b): b is string => !!b))].sort();
  const floors = levels.filter((l) => [...idx.cameras.values()].some((c) => c.floorId === l.id)).map((l) => [l.id, l.name] as const);

  const contextIds = useMemo(() => {
    if (!contextZoneId) return null;
    return new Set([...graph.camerasInZone(contextZoneId), ...graph.camerasNear(contextZoneId, 1).map((c) => c.cameraId)]);
  }, [contextZoneId, graph]);

  const grouped = all.filter((c) => {
    if (group === "all") return true;
    if (group === "favorites") return favorites.includes(c.key);
    if (group === "unplaced") return !c.mapId;
    if (group === "context") return contextIds ? !!c.mapId && contextIds.has(c.mapId) : favorites.includes(c.key);
    if (group.startsWith("floor:")) return !!c.mapId && idx.cameras.get(c.mapId)!.floorId === group.slice(6);
    if (group.startsWith("bldg:")) return buildingOf(c) === group.slice(5);
    return true;
  });
  const shown = search ? grouped.filter((c) => c.name.toLowerCase().includes(search.toLowerCase())) : grouped;
  const pages = Math.max(1, Math.ceil(shown.length / size));
  const pageNow = Math.min(page, pages - 1);
  const tiles = shown.slice(pageNow * size, pageNow * size + size);
  useEffect(() => setPage(0), [group, size, search, contextZoneId]);

  // Auto-cycle through pages, like a monitoring wall.
  useEffect(() => {
    if (!cycle || pages < 2 || focus) return;
    const t = setInterval(() => setPage((p) => (p + 1) % pages), 10_000);
    return () => clearInterval(t);
  }, [cycle, pages, focus]);

  // Esc leaves the large view; arrows page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
      if (e.key === "Escape") setFocus(null);
      if (!focus && e.key === "ArrowRight") setPage((p) => (p + 1) % pages);
      if (!focus && e.key === "ArrowLeft") setPage((p) => (p - 1 + pages) % pages);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus, pages]);

  const cols = Math.ceil(Math.sqrt(size));
  const refreshMs = size <= 4 ? 1000 : size <= 9 ? 1500 : size <= 16 ? 2500 : 3500;
  const toggleFav = (key: string) => setFavorites((f) => (f.includes(key) ? f.filter((x) => x !== key) : [...f, key]));
  const fullscreen = (el: HTMLElement | null) => {
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else el.requestFullscreen?.().catch(() => {});
  };

  const tile = (c: WallCam, opts: { live?: boolean; big?: boolean; small?: boolean } = {}) => {
    const fav = favorites.includes(c.key);
    const star = (
      <button className={`star${fav ? " on" : ""}`} title={fav ? "Remove from favourites" : "Add to favourites"} onClick={(e) => (e.stopPropagation(), toggleFav(c.key))}>
        {fav ? "★" : "☆"}
      </button>
    );
    const open = () => setFocus(c);
    if (c.mapId) {
      const cam = idx.cameras.get(c.mapId)!;
      return (
        <CameraFeed
          key={c.key}
          camera={cam}
          stream={state.streams[cam.id]}
          zones={idx.zones}
          sim={state.sim}
          live={opts.live}
          emphasis={opts.big}
          refreshMs={opts.small ? 2500 : refreshMs}
          badge={star}
          onClick={opts.big ? undefined : open}
        />
      );
    }
    const v = c.vendor!;
    const base = `/api/integrations/${v.integration}/cameras/${encodeURIComponent(v.externalId)}`;
    return (
      <div key={c.key} className={`feed${opts.big ? " feed-emphasis" : ""}`} onClick={opts.big ? undefined : open}>
        <div className="feed-video">
          {opts.live ? <LiveImage streamUrl={`${base}/stream`} snapshotUrl={`${base}/snapshot`} alt={v.name} /> : <SnapshotImage url={`${base}/snapshot?w=480`} alt={v.name} intervalMs={opts.small ? 2500 : refreshMs} />}
          <div className="feed-label"><span className="live-dot" /> {v.name}</div>
          <div className="feed-badge">{star}</div>
        </div>
      </div>
    );
  };

  if (focus) {
    const near = focus.mapId
      ? graph
          .camerasNear(idx.cameras.get(focus.mapId)!.covers[0], 1)
          .map((n) => all.find((c) => c.mapId === n.cameraId))
          .filter((c): c is WallCam => !!c && c.key !== focus.key)
          .slice(0, 6)
      : [];
    const cam = focus.mapId ? idx.cameras.get(focus.mapId) : undefined;
    const room = cam?.covers.map((z) => idx.zones.get(z)?.name).filter(Boolean).join(", ");
    return (
      <div className="wall wall-focus" ref={wallRef}>
        <div className="wall-bar">
          <button onClick={() => setFocus(null)}>← Back to cameras</button>
          <strong className="wall-title">{focus.name}</strong>
          {room && <span className="muted small">{room}</span>}
          <span className="spacer" />
          {cam && <button onClick={() => onShowOnMap(cam.id)}>Show on map</button>}
          {cam && <button onClick={() => onTrack(cam.id)}>Track person</button>}
          <button onClick={() => fullscreen(wallRef.current)} title="Full screen (Esc to leave)">⛶</button>
        </div>
        <div className="wall-focus-main" onDoubleClick={() => fullscreen(wallRef.current)}>{tile(focus, { live: true, big: true })}</div>
        {near.length > 0 && (
          <>
            <div className="section-title">Nearby cameras</div>
            <div className="wall-strip">{near.map((c) => tile(c, { small: true }))}</div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={`wall${compact ? " wall-compact" : ""}`} ref={wallRef}>
      <div className="wall-bar">
        <select value={group} onChange={(e) => setGroup(e.target.value)}>
          {compact && <option value="context">Selected area on the map</option>}
          <option value="all">All cameras ({all.length})</option>
          <option value="favorites">★ Favourites ({favorites.length})</option>
          {buildings.length > 0 && (
            <optgroup label="Building">
              {buildings.map((b) => <option key={b} value={`bldg:${b}`}>{b}</option>)}
            </optgroup>
          )}
          {floors.length > 1 && (
            <optgroup label="Level">
              {floors.map(([id, name]) => <option key={id} value={`floor:${id}`}>{name}</option>)}
            </optgroup>
          )}
          {all.some((c) => !c.mapId) && <option value="unplaced">Not on the map yet</option>}
        </select>
        <input className="wall-search" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <div className="wall-sizes" title="Cameras per screen">
          {SIZES.filter((s) => !compact || s <= 9).map((s) => (
            <button key={s} className={size === s ? "on" : ""} onClick={() => setSize(s)}>{s === 1 ? "1" : `${Math.sqrt(s)}×${Math.sqrt(s)}`}</button>
          ))}
        </div>
        <span className="spacer" />
        {pages > 1 && (
          <span className="wall-pages">
            <button onClick={() => setPage((pageNow - 1 + pages) % pages)}>‹</button>
            <span className="muted small">{pageNow + 1} / {pages}</span>
            <button onClick={() => setPage((pageNow + 1) % pages)}>›</button>
            <label className="toggle small" title="Move to the next page every 10 seconds"><input type="checkbox" checked={cycle} onChange={(e) => setCycle(e.target.checked)} /> Cycle</label>
          </span>
        )}
        {!compact && <button onClick={() => fullscreen(wallRef.current)} title="Full screen (Esc to leave)">⛶</button>}
      </div>
      {tiles.length === 0 ? (
        <p className="muted wall-empty">
          {group === "favorites"
            ? "No favourites yet — click ☆ on any camera to add it here."
            : group === "context"
              ? "Click a room on the map to see its cameras here."
              : "No cameras to show."}
        </p>
      ) : (
        <div
          className="wall-grid"
          style={{
            gridTemplateColumns: `repeat(${Math.min(cols, Math.max(1, tiles.length))}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${Math.ceil(size / cols)}, minmax(0, 1fr))`,
          }}
        >
          {tiles.map((c) => tile(c))}
        </div>
      )}
    </div>
  );
}
