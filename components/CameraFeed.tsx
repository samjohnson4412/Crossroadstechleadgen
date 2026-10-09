"use client";

import { useEffect, useRef, type ReactNode } from "react";
import type { CameraPlacement, Zone } from "@/lib/core/site";
import { bounds } from "@/lib/core/site";
import type { StreamInfo } from "@/lib/integrations/types";
import type { SimActorView } from "@/lib/integrations/simulator";

const COLORS: Record<string, string> = {
  red: "#d33a3a", orange: "#e8873a", yellow: "#e6c84a", green: "#3f9b52", blue: "#3a6fd3", purple: "#8a4fc9",
  white: "#e9e9e9", gray: "#8a8f98", black: "#1d1f24", khaki: "#b9a77a", brown: "#7a5534",
};
export const colorOf = (name?: string) => (name && COLORS[name]) || "#9aa3ad";
export const COLOR_NAMES = Object.keys(COLORS);

interface Props {
  camera: CameraPlacement;
  stream?: StreamInfo;
  zones: Map<string, Zone>;
  sim: SimActorView[] | null;
  badge?: ReactNode;
  footer?: ReactNode;
  emphasis?: boolean;
  onClick?: () => void;
}

/** One live camera tile: real MJPEG via the server proxy, or the simulator's rendering. */
export function CameraFeed({ camera, stream, zones, sim, badge, footer, emphasis, onClick }: Props) {
  return (
    <div className={`feed${emphasis ? " feed-emphasis" : ""}`} onClick={onClick}>
      <div className="feed-video">
        {!stream || stream.kind === "unavailable" ? (
          <div className="feed-empty">{stream?.kind === "unavailable" ? stream.reason : "No stream"}</div>
        ) : stream.kind === "simulated" ? (
          <SimFeed camera={camera} zones={zones} actors={sim ?? []} />
        ) : stream.kind === "mjpeg" ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={stream.url} alt={camera.name} />
        ) : (
          <div className="feed-empty">{stream.kind.toUpperCase()} playback not wired yet</div>
        )}
        <div className="feed-label">
          <span className="live-dot" /> {camera.name}
        </div>
        {badge && <div className="feed-badge">{badge}</div>}
      </div>
      {footer && <div className="feed-footer">{footer}</div>}
    </div>
  );
}

/** Renders simulated people standing in the zones this camera covers. */
function SimFeed({ camera, zones, actors }: { camera: CameraPlacement; zones: Map<string, Zone>; actors: SimActorView[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const latest = useRef(actors);
  latest.current = actors;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    const drawn = new Map<string, { x: number; y: number }>();
    const covered = camera.covers.map((id) => zones.get(id)).filter((z): z is Zone => !!z);
    const box = covered.length
      ? covered.map((z) => bounds(z.polygon)).reduce((a, b) => ({ minX: Math.min(a.minX, b.minX), minY: Math.min(a.minY, b.minY), maxX: Math.max(a.maxX, b.maxX), maxY: Math.max(a.maxY, b.maxY), w: 0, h: 0 }))
      : { minX: 0, minY: 0, maxX: 1, maxY: 1, w: 1, h: 1 };
    let frame = 0;
    let raf = 0;
    const seed = camera.id.split("").reduce((a, c) => a + c.charCodeAt(0), 0);

    const render = () => {
      const W = canvas.width;
      const H = canvas.height;
      frame++;
      // Scene: a dim room with a floor in perspective.
      const hue = seed % 360;
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, `hsl(${hue}, 8%, 16%)`);
      g.addColorStop(0.45, `hsl(${hue}, 8%, 22%)`);
      g.addColorStop(1, `hsl(${hue}, 6%, 30%)`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.lineWidth = 1;
      const horizon = H * 0.38;
      for (let i = -8; i <= 8; i++) {
        ctx.beginPath();
        ctx.moveTo(W / 2 + i * 12, horizon);
        ctx.lineTo(W / 2 + i * W * 0.18, H);
        ctx.stroke();
      }
      for (let r = 1; r < 8; r++) {
        const y = horizon + (H - horizon) * Math.pow(r / 8, 1.6);
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(W, y);
        ctx.stroke();
      }

      const visible = latest.current.filter((a) => camera.covers.includes(a.zoneId));
      // Far people first so near ones overlap them.
      const placed = visible
        .map((a) => {
          const tx = (a.x - box.minX) / Math.max(1, box.maxX - box.minX);
          const ty = (a.y - box.minY) / Math.max(1, box.maxY - box.minY);
          const prev = drawn.get(a.id) ?? { x: tx, y: ty };
          const cur = { x: prev.x + (tx - prev.x) * 0.06, y: prev.y + (ty - prev.y) * 0.06 };
          drawn.set(a.id, cur);
          return { a, ...cur };
        })
        .sort((p, q) => p.y - q.y);
      for (const p of placed) {
        const depth = 0.25 + 0.75 * p.y;
        const h = H * 0.55 * depth;
        const x = W * (0.1 + 0.8 * p.x);
        const feet = horizon + (H - horizon) * (0.1 + 0.85 * p.y);
        const w = h * 0.28;
        const bob = Math.sin((frame + p.a.id.length * 7) / 9) * 1.2;
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.beginPath();
        ctx.ellipse(x, feet, w * 0.7, w * 0.18, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = colorOf(p.a.lowerColor);
        ctx.fillRect(x - w * 0.42, feet - h * 0.48 + bob, w * 0.84, h * 0.48);
        ctx.fillStyle = colorOf(p.a.upperColor);
        ctx.beginPath();
        ctx.roundRect(x - w / 2, feet - h * 0.85 + bob, w, h * 0.4, w * 0.2);
        ctx.fill();
        ctx.fillStyle = "#c9a184";
        ctx.beginPath();
        ctx.arc(x, feet - h * 0.93 + bob, w * 0.26, 0, Math.PI * 2);
        ctx.fill();
      }
      for (const id of drawn.keys()) if (!visible.some((a) => a.id === id)) drawn.delete(id);

      // Sensor noise + overlay text, like a real NVR feed.
      ctx.fillStyle = "rgba(255,255,255,0.025)";
      for (let i = 0; i < 120; i++) ctx.fillRect(Math.random() * W, Math.random() * H, 1, 1);
      ctx.font = "11px ui-monospace, monospace";
      ctx.fillStyle = "rgba(255,255,255,0.8)";
      ctx.fillText(new Date().toLocaleTimeString(), W - 78, H - 8);
      ctx.fillText("SIM", 8, H - 8);
      raf = requestAnimationFrame(render);
    };
    raf = requestAnimationFrame(render);
    return () => cancelAnimationFrame(raf);
  }, [camera, zones]);

  return <canvas ref={canvasRef} width={480} height={270} />;
}
