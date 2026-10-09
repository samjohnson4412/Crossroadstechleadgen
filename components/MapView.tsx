"use client";

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

/** Interactive floor plan: zones, cameras, doors and displays; click anything to act on it. */
export function MapView({ floor, doors, selection, onSelect, overlay, simActors, compact }: Props) {
  const isSel = (kind: string, id: string) => selection?.kind === kind && selection.id === id;
  return (
    <svg className={`map${compact ? " map-compact" : ""}`} viewBox={`0 0 ${floor.width} ${floor.height}`} onClick={() => onSelect(null)}>
      {floor.background && <image href={floor.background} x={0} y={0} width={floor.width} height={floor.height} opacity={0.5} />}

      {floor.zones.map((z) => {
        const c = centroid(z.polygon);
        const predicted = overlay?.predictedZoneIds.includes(z.id);
        const last = overlay?.lastZoneId === z.id;
        return (
          <g key={z.id} onClick={(e) => (e.stopPropagation(), onSelect({ kind: "zone", id: z.id }))} className="zone">
            <polygon
              points={z.polygon.map((p) => `${p.x},${p.y}`).join(" ")}
              className={`zone-shape zone-${z.kind}${isSel("zone", z.id) ? " selected" : ""}${predicted ? " predicted" : ""}${last ? " last-seen" : ""}`}
              style={last ? { fill: overlay!.color } : undefined}
            />
            {!compact && bounds(z.polygon).w >= 70 && (
              <text x={c.x} y={c.y} className="zone-label">
                {z.name}
              </text>
            )}
          </g>
        );
      })}

      {floor.cameras.map((cam) => (
        <g key={cam.id} className="camera" onClick={(e) => (e.stopPropagation(), onSelect({ kind: "camera", id: cam.id }))}>
          <path d={wedge(cam.position, cam.heading, cam.fov)} className={`fov${isSel("camera", cam.id) ? " selected" : ""}`} />
          <circle cx={cam.position.x} cy={cam.position.y} r={9} className={`cam-dot${isSel("camera", cam.id) ? " selected" : ""}`} />
          <path d={`M${cam.position.x - 4},${cam.position.y - 3} h6 v6 h-6 z M${cam.position.x + 2},${cam.position.y} l3,-3 v6 z`} fill="var(--bg)" />
        </g>
      ))}

      {floor.doors.map((d) => {
        const status = doors[d.id];
        const controlled = !!d.source;
        return (
          <g key={d.id} className="door" onClick={(e) => (e.stopPropagation(), onSelect({ kind: "door", id: d.id }))}>
            <rect
              x={d.position.x - (controlled ? 9 : 6)}
              y={d.position.y - (controlled ? 9 : 6)}
              width={controlled ? 18 : 12}
              height={controlled ? 18 : 12}
              rx={3}
              fill={doorColor(status, controlled)}
              className={`door-shape${isSel("door", d.id) ? " selected" : ""}${status?.position === "open" ? " door-open" : ""}`}
            />
            {controlled && <path d={`M${d.position.x - 3},${d.position.y - 1} h6 v5 h-6 z M${d.position.x - 2},${d.position.y - 1} v-2 a2,2 0 0 1 4,0 v2`} fill="none" stroke="var(--bg)" strokeWidth={1.4} />}
          </g>
        );
      })}

      {floor.displays.map((d) => (
        <rect
          key={d.id}
          x={d.position.x - 9}
          y={d.position.y - 5}
          width={18}
          height={10}
          rx={2}
          className={`display${isSel("display", d.id) ? " selected" : ""}`}
          onClick={(e) => (e.stopPropagation(), onSelect({ kind: "display", id: d.id }))}
        />
      ))}

      {simActors
        ?.filter((a) => a.floorId === floor.id)
        .map((a) => (
          <g key={a.id} className="sim-actor" style={{ transform: `translate(${a.x}px, ${a.y}px)` }}>
            <circle r={7} fill={colorOf(a.upperColor)} stroke={colorOf(a.lowerColor)} strokeWidth={3} />
          </g>
        ))}

      {overlay && overlay.trail.length > 0 && (
        <g className="trail" pointerEvents="none">
          <polyline points={overlay.trail.map((p) => `${p.x},${p.y}`).join(" ")} stroke={overlay.color} />
          {overlay.trail.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={5} fill={overlay.color} />
          ))}
        </g>
      )}
      {overlay?.lastPoint && <circle className="pulse" cx={overlay.lastPoint.x} cy={overlay.lastPoint.y} r={12} fill={overlay.color} pointerEvents="none" />}
    </svg>
  );
}
