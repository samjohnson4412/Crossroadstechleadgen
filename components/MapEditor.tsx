"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { closestOnSegment, distanceToOutline, pointInPolygon, polygonsTouch } from "@/lib/core/geometry";
import type { SiteLayout } from "@/lib/core/overrides";
import { bounds, centroid, type CameraPlacement, type DoorPlacement, type Floor, type Point, type Zone, type ZoneKind } from "@/lib/core/site";
import { useAction } from "./Panels";
import { send } from "./useLive";
import { useZoomPan, ZoomButtons } from "./useZoomPan";

type Tool = "select" | "rect" | "shape" | "camera" | "door" | "display";
type Sel = { kind: "zone" | "camera" | "door" | "display"; id: string } | null;
type Drag =
  | { type: "vertex"; zoneId: string; index: number }
  | { type: "zone"; zoneId: string; start: Point; orig: Point[] }
  | { type: "camera" | "door" | "display"; id: string; start: Point; orig: Point }
  | { type: "rect"; start: Point; current: Point };

const KINDS: { value: ZoneKind; label: string }[] = [
  { value: "room", label: "Room / classroom" },
  { value: "office", label: "Office" },
  { value: "hall", label: "Hallway" },
  { value: "entry", label: "Entrance / lobby" },
  { value: "common", label: "Large space (gym, sanctuary…)" },
  { value: "stair", label: "Stairs / elevator" },
  { value: "outdoor", label: "Outside" },
];
/** Kinds people walk through: new rooms auto-connect to touching spaces of these kinds. */
const WALKWAYS: ZoneKind[] = ["hall", "entry", "stair", "outdoor", "common"];

const rid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;

interface Props {
  initial: SiteLayout;
  floorId: string;
  showBackground: boolean;
  /** Camera systems (e.g. two Blue Iris servers) whose cameras can be placed. */
  cameraIntegrations: { id: string; name: string }[];
  doorIntegration?: string;
  displayIntegration?: string;
  onDone: () => void;
}

/**
 * Map editor: draw and reshape rooms, place cameras and doors, set which rooms
 * connect. Works on a draft; nothing changes for other consoles until Save.
 */
export function MapEditor({ initial, floorId, showBackground, cameraIntegrations, doorIntegration, displayIntegration, onDone }: Props) {
  const cameraIntegration = cameraIntegrations[0]?.id;
  const serverName = (id: string) => cameraIntegrations.find((c) => c.id === id)?.name ?? id;
  const [draft, setDraft] = useState<SiteLayout>(() => structuredClone(initial));
  const [history, setHistory] = useState<SiteLayout[]>([]);
  const [tool, setTool] = useState<Tool>("select");
  const [sel, setSel] = useState<Sel>(null);
  const [shapePoints, setShapePoints] = useState<Point[]>([]);
  const [hint, setHint] = useState<string | null>(null);
  const [biCameras, setBiCameras] = useState<{ integration: string; externalId: string; name: string; online?: boolean }[]>([]);
  /** A Blue Iris camera picked from the "not on the map" list, waiting to be clicked onto the map. */
  const [pendingCam, setPendingCam] = useState<{ integration: string; externalId: string; name: string } | null>(null);
  const [camFilter, setCamFilter] = useState("");
  const [uniDoors, setUniDoors] = useState<{ externalId: string; name: string }[]>([]);
  const dragRef = useRef<Drag | null>(null);
  /** The click that ends a draw/drag/placement must not also clear the selection. */
  const ignoreClick = useRef(false);
  const [rectPreview, setRectPreview] = useState<{ a: Point; b: Point } | null>(null);
  const { busy, error, run } = useAction();

  const floors = draft.buildings.flatMap((b) => b.floors);
  const floor = floors.find((f) => f.id === floorId) ?? floors[0];
  const allZones = useMemo(() => floors.flatMap((f) => f.zones.map((z) => ({ ...z, floorId: f.id, floorName: f.name }))), [floors]);
  const zp = useZoomPan(floor);
  useEffect(() => (setSel(null), setShapePoints([])), [floor.id]);
  const k = floor.width / 1000;

  useEffect(() => {
    Promise.all(
      cameraIntegrations.map((ci) =>
        fetch(`/api/integrations/${ci.id}/devices`)
          .then((r) => r.json())
          .then((d) => ((d.cameras ?? []) as { externalId: string; name: string; online?: boolean }[]).map((c) => ({ ...c, integration: ci.id })))
          .catch(() => []),
      ),
    ).then((lists) => setBiCameras(lists.flat()));
    if (doorIntegration) fetch(`/api/integrations/${doorIntegration}/devices`).then((r) => r.json()).then((d) => setUniDoors(d.doors ?? [])).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cameraIntegrations.map((c) => c.id).join(","), doorIntegration]);

  // ---------- draft helpers ----------

  const draftRef = useRef(draft);
  draftRef.current = draft;
  function commit(mutate: (d: SiteLayout) => void, snapshot = true) {
    if (snapshot) setHistory((h) => [...h.slice(-49), draftRef.current]);
    setDraft((prev) => {
      const next = structuredClone(prev);
      mutate(next);
      return next;
    });
  }
  const floorOf = (d: SiteLayout) => d.buildings.flatMap((b) => b.floors).find((f) => f.id === floor.id)!;
  const undo = () => {
    if (!history.length) return;
    setDraft(history[history.length - 1]);
    setHistory(history.slice(0, -1));
  };

  /** Snap to an existing corner nearby so walls line up. */
  function snap(p: Point, ignoreZone?: string): Point {
    const radius = 7 * k * (zp.vb.w / floor.width);
    let best: Point | null = null;
    let bestD = radius;
    for (const z of floor.zones) {
      if (z.id === ignoreZone) continue;
      for (const q of z.polygon) {
        const d = Math.hypot(q.x - p.x, q.y - p.y);
        if (d < bestD) (best = q), (bestD = d);
      }
    }
    if (best) return { ...best };
    return { x: Math.round(Math.min(floor.width, Math.max(0, p.x))), y: Math.round(Math.min(floor.height, Math.max(0, p.y))) };
  }

  function zoneAt(p: Point) {
    return floor.zones.filter((z) => pointInPolygon(p, z.polygon)).sort((a, b) => bounds(a.polygon).w * bounds(a.polygon).h - bounds(b.polygon).w * bounds(b.polygon).h)[0];
  }

  function addZone(polygon: Point[]) {
    const id = rid("z");
    const touching = floor.zones.filter((z) => polygonsTouch(polygon, z.polygon));
    const building = touching.find((z) => z.building)?.building;
    commit((d) => {
      floorOf(d).zones.push({ id, name: "New room", kind: "room", building, polygon });
      for (const z of touching) if (WALKWAYS.includes(z.kind)) d.passages.push({ between: [id, z.id] });
    });
    setSel({ kind: "zone", id });
    setTool("select");
  }

  function deleteSelected() {
    if (!sel) return;
    commit((d) => {
      const f = floorOf(d);
      if (sel.kind === "zone") {
        f.zones = f.zones.filter((z) => z.id !== sel.id);
        d.passages = d.passages.filter((p) => !p.between.includes(sel.id));
        for (const fl of d.buildings.flatMap((b) => b.floors)) {
          fl.doors = fl.doors.filter((x) => !x.between.includes(sel.id));
          for (const c of fl.cameras) c.covers = c.covers.filter((z) => z !== sel.id);
          fl.displays = fl.displays.filter((x) => x.zoneId !== sel.id);
        }
      } else if (sel.kind === "camera") f.cameras = f.cameras.filter((c) => c.id !== sel.id);
      else if (sel.kind === "display") f.displays = f.displays.filter((x) => x.id !== sel.id);
      else f.doors = f.doors.filter((x) => x.id !== sel.id);
    });
    setSel(null);
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest("input, textarea, select")) return;
      if (e.key === "Delete" || e.key === "Backspace") deleteSelected();
      if (e.key === "Escape") (setShapePoints([]), setTool("select"));
      if (e.key === "Enter" && shapePoints.length >= 3) (addZone(shapePoints), setShapePoints([]));
      if ((e.ctrlKey || e.metaKey) && e.key === "z") undo();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ---------- pointer handling ----------

  const onPointerDown = (e: React.PointerEvent) => {
    const p = zp.toSvg(e.clientX, e.clientY);
    if (tool === "select") return zp.panHandlers.onPointerDown(e);
    e.preventDefault();
    ignoreClick.current = true;
    if (tool === "rect") {
      const s = snap(p);
      dragRef.current = { type: "rect", start: s, current: s };
      zp.svgRef.current?.setPointerCapture(e.pointerId);
      setRectPreview({ a: s, b: s });
    } else if (tool === "shape") {
      const s = snap(p);
      if (shapePoints.length >= 3 && Math.hypot(s.x - shapePoints[0].x, s.y - shapePoints[0].y) < 8 * k * (zp.vb.w / floor.width)) {
        addZone(shapePoints);
        setShapePoints([]);
      } else setShapePoints((pts) => [...pts, s]);
    } else if (tool === "camera") {
      const z = zoneAt(p);
      const id = rid("cam");
      const cam: CameraPlacement = {
        id,
        name: pendingCam?.name ?? (z ? `${z.name} camera` : "New camera"),
        position: { x: Math.round(p.x), y: Math.round(p.y) },
        heading: 0,
        fov: 70,
        covers: z ? [z.id] : [],
        source: { integration: pendingCam?.integration ?? cameraIntegration ?? "cameras", externalId: pendingCam?.externalId ?? id },
        placeholder: pendingCam ? undefined : true,
      };
      commit((d) => floorOf(d).cameras.push(cam));
      setSel({ kind: "camera", id });
      setTool("select");
      setPendingCam(null);
    } else if (tool === "display") {
      const z = zoneAt(p);
      if (!z) return setHint("Click inside the room the SMART Board is in.");
      const id = rid("board");
      commit((d) =>
        floorOf(d).displays.push({ id, name: `${z.name} board`, position: { x: Math.round(p.x), y: Math.round(p.y) }, zoneId: z.id, source: { integration: displayIntegration ?? "displays", externalId: id } }),
      );
      setSel({ kind: "display", id });
      setTool("select");
    } else if (tool === "door") {
      const near = floor.zones
        .map((z) => ({ z, d: pointInPolygon(p, z.polygon) ? 0 : distanceToOutline(p, z.polygon).distance }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 2);
      if (near.length < 2) return setHint("A door needs a room on each side — draw the rooms first.");
      const id = rid("door");
      const door: DoorPlacement = { id, name: `${near[0].z.name} door`, position: { x: Math.round(p.x), y: Math.round(p.y) }, between: [near[0].z.id, near[1].z.id] };
      commit((d) => floorOf(d).doors.push(door));
      setSel({ kind: "door", id });
      setTool("select");
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return zp.panHandlers.onPointerMove(e);
    const p = zp.toSvg(e.clientX, e.clientY);
    if (drag.type === "rect") {
      drag.current = snap(p);
      setRectPreview({ a: drag.start, b: drag.current });
    } else if (drag.type === "vertex") {
      const s = snap(p, drag.zoneId);
      commit((d) => {
        const z = floorOf(d).zones.find((x) => x.id === drag.zoneId);
        if (z) z.polygon[drag.index] = s;
      }, false);
    } else if (drag.type === "zone") {
      const dx = Math.round(p.x - drag.start.x);
      const dy = Math.round(p.y - drag.start.y);
      commit((d) => {
        const z = floorOf(d).zones.find((x) => x.id === drag.zoneId);
        if (z) z.polygon = drag.orig.map((q) => ({ x: q.x + dx, y: q.y + dy }));
      }, false);
    } else {
      const pos = { x: Math.round(drag.orig.x + p.x - drag.start.x), y: Math.round(drag.orig.y + p.y - drag.start.y) };
      commit((d) => {
        const f = floorOf(d);
        const item = drag.type === "camera" ? f.cameras.find((c) => c.id === drag.id) : drag.type === "door" ? f.doors.find((x) => x.id === drag.id) : f.displays.find((x) => x.id === drag.id);
        if (item) item.position = pos;
      }, false);
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return zp.panHandlers.onPointerUp();
    ignoreClick.current = true;
    if (drag.type === "rect") {
      setRectPreview(null);
      const { start: a, current: b } = drag;
      if (Math.abs(a.x - b.x) < 4 || Math.abs(a.y - b.y) < 4) return setHint("Drag to draw a rectangle.");
      addZone([
        { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
        { x: Math.max(a.x, b.x), y: Math.min(a.y, b.y) },
        { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) },
        { x: Math.min(a.x, b.x), y: Math.max(a.y, b.y) },
      ]);
    }
    zp.svgRef.current?.releasePointerCapture?.(e.pointerId);
  };

  /** Start dragging an element (select tool only). Takes a history snapshot first so Undo restores it. */
  const grab = (s: NonNullable<Sel>, makeDrag: (start: Point) => Drag) => (e: React.PointerEvent) => {
    if (tool !== "select") return;
    e.stopPropagation();
    setSel(s);
    setHistory((h) => [...h.slice(-49), draftRef.current]);
    dragRef.current = makeDrag(zp.toSvg(e.clientX, e.clientY));
    zp.svgRef.current?.setPointerCapture(e.pointerId);
  };

  const insertCorner = (zone: Zone) => (e: React.MouseEvent) => {
    e.stopPropagation();
    const p = zp.toSvg(e.clientX, e.clientY);
    const { edge } = distanceToOutline(p, zone.polygon);
    const at = closestOnSegment(p, zone.polygon[edge], zone.polygon[(edge + 1) % zone.polygon.length]).point;
    commit((d) => floorOf(d).zones.find((z) => z.id === zone.id)!.polygon.splice(edge + 1, 0, { x: Math.round(at.x), y: Math.round(at.y) }));
  };

  const removeCorner = (zone: Zone, index: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (zone.polygon.length <= 3) return setHint("A room needs at least 3 corners.");
    commit((d) => floorOf(d).zones.find((z) => z.id === zone.id)!.polygon.splice(index, 1));
  };

  const save = () =>
    run(async () => {
      await send("/api/site/layout", draft, "PUT");
      onDone();
    });

  const placedIds = new Set(floors.flatMap((f) => f.cameras.map((c) => `${c.source.integration}/${c.source.externalId}`)));
  const unplaced = biCameras.filter((c) => !placedIds.has(`${c.integration}/${c.externalId}`));
  const selZone = sel?.kind === "zone" ? floor.zones.find((z) => z.id === sel.id) : undefined;
  const selCam = sel?.kind === "camera" ? floor.cameras.find((c) => c.id === sel.id) : undefined;
  const selDoor = sel?.kind === "door" ? floor.doors.find((d) => d.id === sel.id) : undefined;
  const selDisplay = sel?.kind === "display" ? floor.displays.find((d) => d.id === sel.id) : undefined;
  const bg = showBackground && floor.background;
  const hr = 5 * k * Math.max(0.5, zp.vb.w / floor.width);

  const TOOLS: { id: Tool; label: string; help: string }[] = [
    { id: "select", label: "Select / move", help: "Click to select. Drag rooms, corners, cameras and doors. Double-click a room's edge to add a corner; right-click a corner to remove it." },
    { id: "rect", label: "▭ Rectangle room", help: "Drag on the map to draw a rectangular room." },
    { id: "shape", label: "✎ Any shape", help: "Click each corner. Click the first corner (or press Enter) to finish. Esc cancels." },
    { id: "camera", label: "◉ Add camera", help: "Click where the camera is mounted." },
    { id: "door", label: "▣ Add door", help: "Click on the wall between two rooms." },
    { id: "display", label: "▭ Add SMART Board", help: "Click inside the room the board is in." },
  ];

  return (
    <>
      <section className="stage">
        <div className="editor-bar">
          {TOOLS.map((t) => (
            <button key={t.id} className={tool === t.id ? "on" : ""} onClick={() => (setTool(t.id), setShapePoints([]), setHint(null), setPendingCam(null))}>
              {t.label}
            </button>
          ))}
          <span className="spacer" />
          <button disabled={!history.length} onClick={undo}>↶ Undo</button>
          <button onClick={onDone} disabled={busy}>Cancel</button>
          <button className="btn-primary" onClick={save} disabled={busy}>Save map</button>
        </div>
        <div className="editor-hint">
          {hint ?? TOOLS.find((t) => t.id === tool)!.help}
          {tool === "shape" && shapePoints.length >= 3 && <button className="btn-primary small-btn" onClick={() => (addZone(shapePoints), setShapePoints([]))}>Finish shape</button>}
        </div>
        {error && <p className="error">{error}</p>}
        <div className="map-wrap">
          <svg
            ref={zp.svgRef}
            className={`map editor tool-${tool}${bg ? " has-bg" : ""}`}
            viewBox={`${zp.vb.x} ${zp.vb.y} ${zp.vb.w} ${zp.vb.h}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onClick={() => {
              if (ignoreClick.current) return void (ignoreClick.current = false);
              if (tool === "select" && !zp.suppressClick.current) setSel(null);
            }}
          >
            {bg && <image href={floor.background} x={0} y={0} width={floor.width} height={floor.height} className="map-bg" />}
            {!bg && <rect x={0} y={0} width={floor.width} height={floor.height} className="editor-canvas" />}

            {floor.zones.map((z) => {
              const c = centroid(z.polygon);
              const b = bounds(z.polygon);
              const fontSize = Math.min(13 * k, (b.w * 0.9) / Math.max(4, z.name.length * 0.58), b.h * 0.45);
              const selected = sel?.kind === "zone" && sel.id === z.id;
              return (
                <g key={z.id} className="zone">
                  <polygon
                    points={z.polygon.map((p) => `${p.x},${p.y}`).join(" ")}
                    className={`zone-shape zone-${z.kind}${selected ? " selected" : ""}`}
                    strokeWidth={2 * k}
                    onPointerDown={grab({ kind: "zone", id: z.id }, (start) => ({ type: "zone", zoneId: z.id, start, orig: z.polygon }))}
                    onDoubleClick={selected ? insertCorner(z) : undefined}
                    onClick={(e) => e.stopPropagation()}
                  />
                  {fontSize >= 3.5 && (
                    <text x={c.x} y={c.y} className="zone-label" fontSize={fontSize}>
                      {z.name}
                    </text>
                  )}
                </g>
              );
            })}

            {selZone &&
              connectionsOf(draft, selZone.id).map((other) => {
                const oz = floor.zones.find((z) => z.id === other.id);
                if (!oz) return null;
                const a = centroid(selZone.polygon);
                const b = centroid(oz.polygon);
                return <line key={other.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="conn-line" strokeWidth={2 * k} />;
              })}

            {floor.cameras.map((cam) => (
              <g key={cam.id} className={`camera${cam.placeholder ? " placeholder" : ""}`} onPointerDown={grab({ kind: "camera", id: cam.id }, (start) => ({ type: "camera", id: cam.id, start, orig: cam.position }))} onClick={(e) => e.stopPropagation()}>
                <path d={wedgePath(cam.position, cam.heading, cam.fov, 55 * k)} className={`fov${sel?.id === cam.id ? " selected" : ""}`} />
                <g transform={`translate(${cam.position.x} ${cam.position.y}) scale(${k})`}>
                  <circle r={9} className={`cam-dot${sel?.id === cam.id ? " selected" : ""}`} />
                </g>
              </g>
            ))}

            {floor.doors.map((d) => (
              <g key={d.id} className={`door${d.placeholder ? " placeholder" : ""}`} transform={`translate(${d.position.x} ${d.position.y}) scale(${k})`} onPointerDown={grab({ kind: "door", id: d.id }, (start) => ({ type: "door", id: d.id, start, orig: d.position }))} onClick={(e) => e.stopPropagation()}>
                <rect x={-8} y={-8} width={16} height={16} rx={3} fill={d.source ? "var(--ok)" : "var(--door-passive)"} className={`door-shape${sel?.id === d.id ? " selected" : ""}`} />
              </g>
            ))}

            {floor.displays.map((d) => (
              <rect
                key={d.id}
                x={d.position.x - 9 * k}
                y={d.position.y - 5 * k}
                width={18 * k}
                height={10 * k}
                rx={2 * k}
                className={`display${sel?.id === d.id ? " selected" : ""}`}
                onPointerDown={grab({ kind: "display", id: d.id }, (start) => ({ type: "display", id: d.id, start, orig: d.position }))}
                onClick={(e) => e.stopPropagation()}
              />
            ))}

            {selZone &&
              selZone.polygon.map((p, i) => (
                <circle
                  key={i}
                  cx={p.x}
                  cy={p.y}
                  r={hr}
                  className="handle"
                  onPointerDown={grab({ kind: "zone", id: selZone.id }, () => ({ type: "vertex", zoneId: selZone.id, index: i }))}
                  onContextMenu={removeCorner(selZone, i)}
                />
              ))}

            {rectPreview && (
              <rect
                x={Math.min(rectPreview.a.x, rectPreview.b.x)}
                y={Math.min(rectPreview.a.y, rectPreview.b.y)}
                width={Math.abs(rectPreview.a.x - rectPreview.b.x)}
                height={Math.abs(rectPreview.a.y - rectPreview.b.y)}
                className="draw-preview"
                strokeWidth={2 * k}
              />
            )}
            {shapePoints.length > 0 && (
              <g className="draw-preview">
                <polyline points={shapePoints.map((p) => `${p.x},${p.y}`).join(" ")} strokeWidth={2 * k} />
                {shapePoints.map((p, i) => (
                  <circle key={i} cx={p.x} cy={p.y} r={hr} className={i === 0 ? "first" : ""} />
                ))}
              </g>
            )}
          </svg>
          <ZoomButtons zoomAt={zp.zoomAt} zoomed={zp.zoomed} reset={() => zp.setVb(zp.full)} />
        </div>
      </section>

      <aside className="side">
        {!sel && (
          <div className="panel">
            <h3>Editing {floor.name}</h3>
            <p className="muted small">Pick a tool above. Changes only take effect when you press <strong>Save map</strong>.</p>
            <ul className="help-list small">
              <li>New rooms automatically connect to hallways, lobbies and stairs they touch. Check a room&apos;s connections after drawing it.</li>
              <li>Corners snap to nearby corners so walls line up.</li>
              <li>Turn off the background (below the map) to see your drawing on its own.</li>
              <li>Delete key removes the selected item. Ctrl+Z undoes.</li>
            </ul>
            <p className="muted small">{floor.zones.length} rooms · {floor.cameras.length} cameras · {floor.doors.length} doors on this level</p>
            {unplaced.length > 0 && (
              <>
                <div className="section-title">Blue Iris cameras not on the map yet <span className="count">{unplaced.length}</span></div>
                <p className="muted small">Click one, then click where it&apos;s mounted.</p>
                <input placeholder="Filter…" value={camFilter} onChange={(e) => setCamFilter(e.target.value)} />
                <ul className="unplaced">
                  {unplaced
                    .filter((c) => !camFilter || `${c.name} ${c.externalId}`.toLowerCase().includes(camFilter.toLowerCase()))
                    .map((c) => (
                      <li key={`${c.integration}/${c.externalId}`}>
                        <button className={pendingCam?.externalId === c.externalId && pendingCam.integration === c.integration ? "on" : ""} onClick={() => (setPendingCam(c), setTool("camera"), setHint(`Click on the map where "${c.name}" is mounted.`))}>
                          {c.name}
                          {cameraIntegrations.length > 1 && <span className="muted small"> · {serverName(c.integration)}</span>}
                          {c.online === false && <span className="muted small"> · offline</span>}
                        </button>
                      </li>
                    ))}
                </ul>
              </>
            )}
          </div>
        )}

        {selZone && (
          <div className="panel" key={selZone.id}>
            <h3>Room</h3>
            <label>Name<input value={selZone.name} autoFocus={selZone.name === "New room"} onFocus={(e) => e.target.select()} onChange={(e) => commit((d) => (findZone(d, selZone.id)!.name = e.target.value), false)} /></label>
            <div className="grid2">
              <label>Type
                <select value={selZone.kind} onChange={(e) => commit((d) => (findZone(d, selZone.id)!.kind = e.target.value as ZoneKind))}>
                  {KINDS.map((x) => <option key={x.value} value={x.value}>{x.label}</option>)}
                </select>
              </label>
              <label>Building
                <input list="buildings" value={selZone.building ?? ""} onChange={(e) => commit((d) => (findZone(d, selZone.id)!.building = e.target.value || undefined), false)} />
                <datalist id="buildings">{[...new Set(allZones.map((z) => z.building).filter(Boolean))].map((b) => <option key={b} value={b} />)}</datalist>
              </label>
            </div>
            <Connections draft={draft} zone={selZone} floor={floor} allZones={allZones} commit={commit} />
            <div className="btn-row end"><button className="btn-danger" onClick={deleteSelected}>Delete room</button></div>
          </div>
        )}

        {selCam && (
          <div className="panel" key={selCam.id}>
            <h3>Camera</h3>
            <label>Name<input value={selCam.name} onChange={(e) => commit((d) => (findCam(d, selCam.id)!.name = e.target.value), false)} /></label>
            {cameraIntegrations.length > 1 && (
              <label>Camera server
                <select value={selCam.source.integration} onChange={(e) => commit((d) => (findCam(d, selCam.id)!.source.integration = e.target.value))}>
                  {cameraIntegrations.map((ci) => <option key={ci.id} value={ci.id}>{ci.name}</option>)}
                </select>
              </label>
            )}
            <label>Blue Iris camera (short name)
              <input
                list="bi-cams"
                value={selCam.placeholder ? "" : selCam.source.externalId}
                placeholder="Not linked yet"
                onChange={(e) =>
                  commit((d) => {
                    const c = findCam(d, selCam.id)!;
                    const v = e.target.value.trim();
                    c.source = { integration: c.source.integration, externalId: v || c.id };
                    c.placeholder = !v;
                  }, false)
                }
              />
              <datalist id="bi-cams">{biCameras.filter((c) => c.integration === selCam.source.integration).map((c) => <option key={c.externalId} value={c.externalId}>{c.name}</option>)}</datalist>
            </label>
            <label>Facing: {selCam.heading ?? 0}°
              <input type="range" min={0} max={359} value={selCam.heading ?? 0} onChange={(e) => commit((d) => (findCam(d, selCam.id)!.heading = Number(e.target.value)), false)} />
            </label>
            <label>View width: {selCam.fov ?? 70}°
              <input type="range" min={20} max={180} value={selCam.fov ?? 70} onChange={(e) => commit((d) => (findCam(d, selCam.id)!.fov = Number(e.target.value)), false)} />
            </label>
            <div className="section-title">Rooms this camera sees</div>
            <div className="chips">
              {floor.zones
                .slice()
                .sort((a, b) => Number(selCam.covers.includes(b.id)) - Number(selCam.covers.includes(a.id)) || a.name.localeCompare(b.name))
                .map((z) => (
                  <button
                    key={z.id}
                    className={selCam.covers.includes(z.id) ? "chip on" : "chip"}
                    onClick={() =>
                      commit((d) => {
                        const c = findCam(d, selCam.id)!;
                        c.covers = c.covers.includes(z.id) ? c.covers.filter((x) => x !== z.id) : [...c.covers, z.id];
                      })
                    }
                  >
                    {z.name}
                  </button>
                ))}
            </div>
            <div className="btn-row end"><button className="btn-danger" onClick={deleteSelected}>Delete camera</button></div>
          </div>
        )}

        {selDisplay && (
          <div className="panel" key={selDisplay.id}>
            <h3>SMART Board</h3>
            <label>Name<input value={selDisplay.name} onChange={(e) => commit((d) => (findDisplay(d, selDisplay.id)!.name = e.target.value), false)} /></label>
            <label>Room
              <select value={selDisplay.zoneId} onChange={(e) => commit((d) => (findDisplay(d, selDisplay.id)!.zoneId = e.target.value))}>
                {floor.zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
              </select>
            </label>
            <label>SMART device ID (from SMART Remote Management)
              <input
                value={selDisplay.source.externalId === selDisplay.id ? "" : selDisplay.source.externalId}
                placeholder="Not linked yet"
                onChange={(e) => commit((d) => {
                  const x = findDisplay(d, selDisplay.id)!;
                  x.source = { integration: x.source.integration, externalId: e.target.value.trim() || x.id };
                }, false)}
              />
            </label>
            <div className="btn-row end"><button className="btn-danger" onClick={deleteSelected}>Delete board</button></div>
          </div>
        )}

        {selDoor && (
          <div className="panel" key={selDoor.id}>
            <h3>Door</h3>
            <label>Name<input value={selDoor.name} onChange={(e) => commit((d) => (findDoor(d, selDoor.id)!.name = e.target.value), false)} /></label>
            <div className="grid2">
              {[0, 1].map((side) => (
                <label key={side}>{side === 0 ? "Between" : "and"}
                  <select value={selDoor.between[side]} onChange={(e) => commit((d) => (findDoor(d, selDoor.id)!.between[side] = e.target.value))}>
                    {floor.zones.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
                  </select>
                </label>
              ))}
            </div>
            <label className="toggle"><input type="checkbox" checked={!!selDoor.exterior} onChange={(e) => commit((d) => (findDoor(d, selDoor.id)!.exterior = e.target.checked))} /> Exterior door</label>
            <label className="toggle"><input type="checkbox" checked={!!selDoor.source} onChange={(e) => commit((d) => {
              const x = findDoor(d, selDoor.id)!;
              x.source = e.target.checked ? { integration: doorIntegration ?? "doors", externalId: x.id } : undefined;
              x.placeholder = e.target.checked ? true : undefined;
            })} /> Access-controlled (UniFi)</label>
            {selDoor.source && (
              <label>UniFi Access door
                <input
                  list="uni-doors"
                  value={selDoor.placeholder ? "" : selDoor.source.externalId}
                  placeholder="Not linked yet"
                  onChange={(e) => commit((d) => {
                    const x = findDoor(d, selDoor.id)!;
                    const v = e.target.value.trim();
                    x.source = { integration: doorIntegration ?? "doors", externalId: v || x.id };
                    x.placeholder = !v;
                  }, false)}
                />
                <datalist id="uni-doors">{uniDoors.map((u) => <option key={u.externalId} value={u.externalId}>{u.name}</option>)}</datalist>
              </label>
            )}
            <div className="btn-row end"><button className="btn-danger" onClick={deleteSelected}>Delete door</button></div>
          </div>
        )}
      </aside>
    </>
  );
}

function findZone(d: SiteLayout, id: string) {
  return d.buildings.flatMap((b) => b.floors).flatMap((f) => f.zones).find((z) => z.id === id);
}
function findCam(d: SiteLayout, id: string) {
  return d.buildings.flatMap((b) => b.floors).flatMap((f) => f.cameras).find((c) => c.id === id);
}
function findDisplay(d: SiteLayout, id: string) {
  return d.buildings.flatMap((b) => b.floors).flatMap((f) => f.displays).find((x) => x.id === id);
}
function findDoor(d: SiteLayout, id: string) {
  return d.buildings.flatMap((b) => b.floors).flatMap((f) => f.doors).find((x) => x.id === id);
}

/** Every zone this one connects to, via an open passage or a door. */
function connectionsOf(d: SiteLayout, zoneId: string) {
  const out: { id: string; via: "passage" | "door"; doorName?: string; index?: number }[] = [];
  d.passages.forEach((p, index) => {
    if (p.between.includes(zoneId)) out.push({ id: p.between[0] === zoneId ? p.between[1] : p.between[0], via: "passage", index });
  });
  for (const f of d.buildings.flatMap((b) => b.floors))
    for (const door of f.doors) if (door.between.includes(zoneId)) out.push({ id: door.between[0] === zoneId ? door.between[1] : door.between[0], via: "door", doorName: door.name });
  return out;
}

function Connections({ draft, zone, floor, allZones, commit }: {
  draft: SiteLayout;
  zone: Zone;
  floor: Floor;
  allZones: (Zone & { floorId: string; floorName: string })[];
  commit: (m: (d: SiteLayout) => void, snapshot?: boolean) => void;
}) {
  const conns = connectionsOf(draft, zone.id);
  const name = (id: string) => {
    const z = allZones.find((x) => x.id === id);
    return z ? (z.floorId === floor.id ? z.name : `${z.name} (${z.floorName})`) : id;
  };
  const connected = new Set(conns.map((c) => c.id));
  const touching = floor.zones.filter((z) => z.id !== zone.id && !connected.has(z.id) && polygonsTouch(zone.polygon, z.polygon));
  const others = allZones.filter((z) => z.id !== zone.id && !connected.has(z.id) && !touching.some((t) => t.id === z.id));
  return (
    <>
      <div className="section-title">People can walk from here to</div>
      {conns.length === 0 && <p className="muted small">Nothing yet — tracking can&apos;t follow anyone through this room until it&apos;s connected.</p>}
      <ul className="conn-list">
        {conns.map((c, i) => (
          <li key={`${c.id}-${i}`}>
            <span>{name(c.id)}</span>
            {c.via === "door" ? (
              <span className="muted small">through door “{c.doorName}”</span>
            ) : (
              <button className="btn-ghost" title="Remove connection" onClick={() => commit((d) => d.passages.splice(c.index!, 1))}>✕</button>
            )}
          </li>
        ))}
      </ul>
      <select
        value=""
        onChange={(e) => {
          const other = e.target.value;
          if (other) commit((d) => d.passages.push({ between: [zone.id, other], ...(allZones.find((z) => z.id === other)?.floorId !== floor.id ? { seconds: 25 } : {}) }));
        }}
      >
        <option value="">+ Connect to…</option>
        {touching.length > 0 && (
          <optgroup label="Touching this room">
            {touching.map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}
          </optgroup>
        )}
        <optgroup label="Other rooms / levels (stairs, elevators)">
          {others.map((z) => <option key={z.id} value={z.id}>{name(z.id)}</option>)}
        </optgroup>
      </select>
    </>
  );
}

function wedgePath(p: Point, heading = 0, fov = 70, r = 55) {
  const toXY = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return { x: p.x + Math.sin(rad) * r, y: p.y - Math.cos(rad) * r };
  };
  const a = toXY(heading - fov / 2);
  const b = toXY(heading + fov / 2);
  return `M${p.x},${p.y} L${a.x},${a.y} A${r},${r} 0 0 1 ${b.x},${b.y} Z`;
}
