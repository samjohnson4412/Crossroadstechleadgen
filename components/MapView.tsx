"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { bounds, centroid, type Floor, type Point } from "@/lib/core/site";
import type { DoorStatus } from "@/lib/integrations/types";
import type { SimActorView } from "@/lib/integrations/simulator";
import { colorOf } from "./CameraFeed";

export type Selection = { kind: "zone" | "camera" | "door" | "display"; id: string } | null;

export interface TrackOverlay {
  color: string;
  /** Sighting positions on this floor, oldest first. */
  trail: Point[];
  lastZoneId?: string;
  /** Where they were last seen, if that's on this floor. */
  lastPoint?: Point;
  predictedZoneIds: string[];
}

interface Props {
  floor: Floor;
  doors: Record<string, DoorStatus>;
  selection: Selection;
  onSelect: (s: Selection) => void;
  overlay?: TrackOverlay | null;
  simActors?: SimActorView[] | null;
  compact?: boolean;
}

export function doorColor(status?: DoorStatus, controlled = true) {
  if (!controlled) return "var(--door-passive)";
  if (!status) return "var(--muted)";
  if (status.position === "open" && status.lock === "locked") return "var(--danger)";
  if (status.mode === "held-locked") return "var(--lockdown)";
  if (status.lock === "unlocked" || status.mode === "held-unlocked") return "var(--warn)";
  return "var(--ok)";
}

function wedge(p: Point, heading = 0, fov = 70, r = 55) {
  const toXY = (deg: number) => {
    const rad = (deg * Math.PI) / 180;
    return { x: p.x + Math.sin(rad) * r, y: p.y - Math.cos(rad) * r };
  };
  const a = toXY(heading - fov / 2);
  const b = toXY(heading + fov / 2);
  return `M${p.x},${p.y} L${a.x},${a.y} A${r},${r} 0 0 1 ${b.x},${b.y} Z`;
}

type ViewBox = { x: number; y: number; w: number; h: number };

/** Interactive floor plan: zones, cameras, doors and displays; click anything to act on it. Scroll/drag/buttons to zoom and pan. */
export function MapView({ floor, doors, selection, onSelect, overlay, simActors, compact }: Props) {
  const isSel = (kind: string, id: string) => selection?.kind === kind && selection.id === id;
  const full: ViewBox = { x: 0, y: 0, w: floor.width, h: floor.height };
  const [vb, setVb] = useState<ViewBox>(full);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; vb: ViewBox; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  // Marker sizes are authored for a 1000-unit-wide plan; scale them to this floor.
  const k = floor.width / 1000;

  useEffect(() => setVb({ x: 0, y: 0, w: floor.width, h: floor.height }), [floor.id, floor.width, floor.height]);

  const zoomAt = useCallback(
    (factor: number, cx?: number, cy?: number) =>
      setVb((v) => {
        const w = Math.min(floor.width, Math.max(floor.width / 12, v.w * factor));
        const h = (w / v.w) * v.h;
        const px = cx ?? v.x + v.w / 2;
        const py = cy ?? v.y + v.h / 2;
        const x = px - ((px - v.x) * w) / v.w;
        const y = py - ((py - v.y) * h) / v.h;
        return { x: Math.min(Math.max(x, -w * 0.25), floor.width - w * 0.75), y: Math.min(Math.max(y, -h * 0.25), floor.height - h * 0.75), w, h };
      }),
    [floor.width, floor.height],
  );

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const pt = svg.createSVGPoint();
      pt.x = e.clientX;
      pt.y = e.clientY;
      const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
      zoomAt(e.deltaY > 0 ? 1.15 : 1 / 1.15, p.x, p.y);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, vb, moved: false };
    suppressClick.current = false;
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const svg = svgRef.current;
    if (!d || !svg) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 5) return;
    if (!d.moved) svg.setPointerCapture(e.pointerId);
    d.moved = true;
    const scale = d.vb.w / svg.clientWidth;
    setVb({ ...d.vb, x: d.vb.x - dx * scale, y: d.vb.y - dy * scale });
  };
  const onPointerUp = () => {
    suppressClick.current = !!drag.current?.moved;
    drag.current = null;
  };
  const pick = (s: Selection) => (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!suppressClick.current) onSelect(s);
  };
  const zoomed = vb.w < floor.width - 1;

  return (
    <div className={`map-wrap${compact ? " compact" : ""}`}>
      <svg
        ref={svgRef}
        className={`map${compact ? " map-compact" : ""}${floor.background ? " has-bg" : ""}`}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        onClick={() => !suppressClick.current && onSelect(null)}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        {floor.background && <image href={floor.background} x={0} y={0} width={floor.width} height={floor.height} className="map-bg" />}

        {floor.zones.map((z) => {
          const c = centroid(z.polygon);
          const b = bounds(z.polygon);
          const predicted = overlay?.predictedZoneIds.includes(z.id);
          const last = overlay?.lastZoneId === z.id;
          const fontSize = Math.min(13 * k, (b.w * 0.9) / Math.max(4, z.name.length * 0.58), b.h * 0.45);
          return (
            <g key={z.id} onClick={pick({ kind: "zone", id: z.id })} className="zone">
              <title>{z.building ? `${z.name} — ${z.building}` : z.name}</title>
              <polygon
                points={z.polygon.map((p) => `${p.x},${p.y}`).join(" ")}
                className={`zone-shape zone-${z.kind}${isSel("zone", z.id) ? " selected" : ""}${predicted ? " predicted" : ""}${last ? " last-seen" : ""}`}
                style={last ? { fill: overlay!.color } : undefined}
                strokeWidth={2 * k}
              />
              {!compact && fontSize >= 3.5 && (
                <text x={c.x} y={c.y} className="zone-label" fontSize={fontSize}>
                  {z.name}
                </text>
              )}
            </g>
          );
        })}

        {floor.cameras.map((cam) => (
          <g key={cam.id} className={`camera${cam.placeholder ? " placeholder" : ""}`} onClick={pick({ kind: "camera", id: cam.id })}>
            <path d={wedge(cam.position, cam.heading, cam.fov, 55 * k)} className={`fov${isSel("camera", cam.id) ? " selected" : ""}`} />
            <g transform={`translate(${cam.position.x} ${cam.position.y}) scale(${k})`}>
              <circle r={9} className={`cam-dot${isSel("camera", cam.id) ? " selected" : ""}`} />
              <path d="M-4,-3 h6 v6 h-6 z M2,0 l3,-3 v6 z" fill="var(--bg)" />
            </g>
          </g>
        ))}

        {floor.doors.map((d) => {
          const status = doors[d.id];
          const controlled = !!d.source;
          const size = controlled ? 9 : 6;
          return (
            <g key={d.id} className={`door${d.placeholder ? " placeholder" : ""}`} onClick={pick({ kind: "door", id: d.id })} transform={`translate(${d.position.x} ${d.position.y}) scale(${k})`}>
              <rect
                x={-size}
                y={-size}
                width={size * 2}
                height={size * 2}
                rx={3}
                fill={doorColor(status, controlled)}
                className={`door-shape${isSel("door", d.id) ? " selected" : ""}${status?.position === "open" ? " door-open" : ""}`}
              />
              {controlled && <path d="M-3,-1 h6 v5 h-6 z M-2,-1 v-2 a2,2 0 0 1 4,0 v2" fill="none" stroke="var(--bg)" strokeWidth={1.4} />}
            </g>
          );
        })}

        {floor.displays.map((d) => (
          <rect
            key={d.id}
            x={d.position.x - 9 * k}
            y={d.position.y - 5 * k}
            width={18 * k}
            height={10 * k}
            rx={2 * k}
            className={`display${isSel("display", d.id) ? " selected" : ""}`}
            onClick={pick({ kind: "display", id: d.id })}
          />
        ))}

        {simActors
          ?.filter((a) => a.floorId === floor.id)
          .map((a) => (
            <g key={a.id} className="sim-actor" style={{ transform: `translate(${a.x}px, ${a.y}px)` }}>
              <circle r={7 * k} fill={colorOf(a.upperColor)} stroke={colorOf(a.lowerColor)} strokeWidth={3 * k} />
            </g>
          ))}

        {overlay && overlay.trail.length > 0 && (
          <g className="trail" pointerEvents="none">
            <polyline points={overlay.trail.map((p) => `${p.x},${p.y}`).join(" ")} stroke={overlay.color} strokeWidth={4 * k} strokeDasharray={`${2 * k} ${6 * k}`} />
            {overlay.trail.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={5 * k} fill={overlay.color} />
            ))}
          </g>
        )}
        {overlay?.lastPoint && <circle className="pulse" cx={overlay.lastPoint.x} cy={overlay.lastPoint.y} r={12 * k} fill={overlay.color} pointerEvents="none" />}
      </svg>
      <div className="map-zoom">
        <button onClick={() => zoomAt(1 / 1.4)} title="Zoom in">+</button>
        <button onClick={() => zoomAt(1.4)} title="Zoom out">−</button>
        {zoomed && <button onClick={() => setVb(full)} title="Show whole floor">⤢</button>}
      </div>
    </div>
  );
}
