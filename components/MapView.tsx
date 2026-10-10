"use client";

import { roomLabel } from "@/lib/core/labels";
import { doorLockType, type DoorPlacement, type Floor, type Point, type Zone } from "@/lib/core/site";
import type { DoorStatus } from "@/lib/integrations/types";
import type { SimActorView } from "@/lib/integrations/simulator";
import { colorOf } from "./CameraFeed";
import { useZoomPan, ZoomButtons } from "./useZoomPan";

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
  showBackground?: boolean;
}

export function doorColor(status?: DoorStatus, controlled = true) {
  if (!controlled) return "var(--door-passive)";
  if (!status) return "var(--muted)";
  if (status.position === "open" && status.lock === "locked") return "var(--danger)";
  if (status.mode === "held-locked") return "var(--lockdown)";
  if (status.lock === "unlocked" || status.mode === "held-unlocked") return "var(--warn)";
  return "var(--ok)";
}

/** Fill color for a door that isn't wired to a live system, by how it's secured. */
export function lockColor(door: DoorPlacement) {
  const t = doorLockType(door);
  return t ? `var(--lock-${t})` : "var(--door-passive)";
}

/**
 * Markers (cameras, doors) shrink as you zoom in, so detailed plans with small
 * rooms stay readable; `k` keeps them proportional to the floor's size.
 */
export function markerScale(floor: Floor, vbWidth: number) {
  return (floor.width / 1000) * Math.max(0.28, Math.sqrt(vbWidth / floor.width));
}

/** Room name position and size (fitted to the room); hidden when it would be too small to read at this zoom. */
export function zoneLabel(z: Zone, k: number, pxPerUnit: number) {
  const label = roomLabel(z.name, z.polygon, 13 * k);
  return { ...label, visible: label.fontSize * pxPerUnit >= 7 };
}

/** A room's name, on one or two lines, or turned sideways. */
export function ZoneLabelText({ label }: { label: ReturnType<typeof zoneLabel> }) {
  const lh = label.fontSize * 1.1;
  return (
    <text
      x={label.x}
      y={label.y}
      className="zone-label"
      fontSize={label.fontSize}
      transform={label.vertical ? `rotate(-90 ${label.x} ${label.y})` : undefined}
    >
      {label.lines.length === 1
        ? label.lines[0]
        : label.lines.map((line, i) => (
            <tspan key={i} x={label.x} y={label.y + (i - (label.lines.length - 1) / 2) * lh}>
              {line}
            </tspan>
          ))}
    </text>
  );
}

/** Buildings drawn from an imported floor plan: a solid outline that hides the photo, and the walls. */
export function PlanDrawings({ floor }: { floor: Floor }) {
  if (!floor.drawings?.length) return null;
  return (
    <g className="plan-drawing" pointerEvents="none">
      {floor.drawings.map((d) => (
        <g key={d.building}>
          {d.outline && <path d={d.outline} className="plan-outline" />}
          <path d={d.walls} className="plan-walls" vectorEffect="non-scaling-stroke" />
        </g>
      ))}
    </g>
  );
}

/** Rooms of buildings with an imported drawing: their walls are drawn already. */
export function drawnBuildings(floor: Floor) {
  return new Set((floor.drawings ?? []).map((d) => d.building.toLowerCase()));
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

/** Interactive floor plan: zones, cameras, doors and displays; click anything to act on it. Scroll/drag/buttons to zoom and pan. */
export function MapView({ floor, doors, selection, onSelect, overlay, simActors, compact, showBackground = true }: Props) {
  const isSel = (kind: string, id: string) => selection?.kind === kind && selection.id === id;
  const { svgRef, vb, setVb, full, zoomAt, panHandlers, suppressClick, zoomed } = useZoomPan(floor);
  // Marker sizes are authored for a 1000-unit-wide plan; scale them to this floor (and the zoom).
  const k = floor.width / 1000;
  const m = markerScale(floor, vb.w);
  const ppu = (svgRef.current?.clientWidth || 900) / vb.w;
  const drawn = drawnBuildings(floor);
  const bg = showBackground && floor.background;
  const pick = (s: Selection) => (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!suppressClick.current) onSelect(s);
  };

  return (
    <div className={`map-wrap${compact ? " compact" : ""}`}>
      <svg
        ref={svgRef}
        className={`map${compact ? " map-compact" : ""}${bg ? " has-bg" : ""}`}
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        onClick={() => !suppressClick.current && onSelect(null)}
        {...panHandlers}
      >
        {bg && <image href={floor.background} x={0} y={0} width={floor.width} height={floor.height} className="map-bg" />}
        <PlanDrawings floor={floor} />

        {floor.zones.map((z) => {
          const predicted = overlay?.predictedZoneIds.includes(z.id);
          const last = overlay?.lastZoneId === z.id;
          const label = zoneLabel(z, k, ppu);
          const isDrawn = drawn.has((z.building ?? "").toLowerCase());
          return (
            <g key={z.id} onClick={pick({ kind: "zone", id: z.id })} className={`zone${isDrawn ? " zone-drawn" : ""}`}>
              <title>{z.building ? `${z.name} — ${z.building}` : z.name}</title>
              <polygon
                points={z.polygon.map((p) => `${p.x},${p.y}`).join(" ")}
                className={`zone-shape zone-${z.kind}${isSel("zone", z.id) ? " selected" : ""}${predicted ? " predicted" : ""}${last ? " last-seen" : ""}`}
                style={last ? { fill: overlay!.color } : undefined}
                strokeWidth={isDrawn ? 1.5 : 2 * k}
                vectorEffect={isDrawn ? "non-scaling-stroke" : undefined}
              />
              {!compact && label.visible && <ZoneLabelText label={label} />}
            </g>
          );
        })}

        {floor.cameras.map((cam) => (
          <g key={cam.id} className={`camera${cam.placeholder ? " placeholder" : ""}`} onClick={pick({ kind: "camera", id: cam.id })}>
            <path d={wedge(cam.position, cam.heading, cam.fov, 55 * m)} className={`fov${isSel("camera", cam.id) ? " selected" : ""}`} />
            <g transform={`translate(${cam.position.x} ${cam.position.y}) scale(${m})`}>
              <circle r={9} className={`cam-dot${isSel("camera", cam.id) ? " selected" : ""}`} />
              <path d="M-4,-3 h6 v6 h-6 z M2,0 l3,-3 v6 z" fill="var(--bg)" />
            </g>
          </g>
        ))}

        {floor.doors.map((d) => {
          const status = doors[d.id];
          const controlled = !!d.source;
          if (!controlled)
            return (
              <circle
                key={d.id}
                cx={d.position.x}
                cy={d.position.y}
                r={3.2 * m}
                fill={lockColor(d)}
                className={`door-dot${isSel("door", d.id) ? " selected" : ""}`}
                onClick={pick({ kind: "door", id: d.id })}
              />
            );
          const size = 9;
          return (
            <g key={d.id} className={`door${d.placeholder ? " placeholder" : ""}`} onClick={pick({ kind: "door", id: d.id })} transform={`translate(${d.position.x} ${d.position.y}) scale(${m})`}>
              <rect
                x={-size}
                y={-size}
                width={size * 2}
                height={size * 2}
                rx={3}
                fill={doorColor(status, true)}
                className={`door-shape${isSel("door", d.id) ? " selected" : ""}${status?.position === "open" ? " door-open" : ""}`}
              />
              <path d="M-3,-1 h6 v5 h-6 z M-2,-1 v-2 a2,2 0 0 1 4,0 v2" fill="none" stroke="var(--bg)" strokeWidth={1.4} />
            </g>
          );
        })}

        {floor.displays.map((d) => (
          <rect
            key={d.id}
            x={d.position.x - 9 * m}
            y={d.position.y - 5 * m}
            width={18 * m}
            height={10 * m}
            rx={2 * m}
            className={`display${isSel("display", d.id) ? " selected" : ""}`}
            onClick={pick({ kind: "display", id: d.id })}
          />
        ))}

        {simActors
          ?.filter((a) => a.floorId === floor.id)
          .map((a) => (
            <g key={a.id} className="sim-actor" style={{ transform: `translate(${a.x}px, ${a.y}px)` }}>
              <circle r={7 * m} fill={colorOf(a.upperColor)} stroke={colorOf(a.lowerColor)} strokeWidth={3 * m} />
            </g>
          ))}

        {overlay && overlay.trail.length > 0 && (
          <g className="trail" pointerEvents="none">
            <polyline points={overlay.trail.map((p) => `${p.x},${p.y}`).join(" ")} stroke={overlay.color} strokeWidth={4 * m} strokeDasharray={`${2 * m} ${6 * m}`} />
            {overlay.trail.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r={5 * m} fill={overlay.color} />
            ))}
          </g>
        )}
        {overlay?.lastPoint && <circle className="pulse" cx={overlay.lastPoint.x} cy={overlay.lastPoint.y} r={12 * m} fill={overlay.color} pointerEvents="none" />}
      </svg>
      <ZoomButtons zoomAt={zoomAt} zoomed={zoomed} reset={() => setVb(full)} />
    </div>
  );
}
