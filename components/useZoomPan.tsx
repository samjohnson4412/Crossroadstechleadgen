"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type ViewBox = { x: number; y: number; w: number; h: number };

/**
 * Wheel/drag/button zoom and pan for an SVG floor plan. Shared by the live map and the map editor.
 * Pointer handlers pan when the drag starts on empty map; elements that stop propagation get the drag instead.
 */
export function useZoomPan(floor: { id: string; width: number; height: number }) {
  const full: ViewBox = { x: 0, y: 0, w: floor.width, h: floor.height };
  const [vb, setVb] = useState<ViewBox>(full);
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number; vb: ViewBox; moved: boolean } | null>(null);
  /** True right after a pan, so the click that ends it doesn't also select something. */
  const suppressClick = useRef(false);

  useEffect(() => setVb({ x: 0, y: 0, w: floor.width, h: floor.height }), [floor.id, floor.width, floor.height]);

  const zoomAt = useCallback(
    (factor: number, cx?: number, cy?: number) =>
      setVb((v) => {
        const w = Math.min(floor.width, Math.max(floor.width / 16, v.w * factor));
        const h = (w / v.w) * v.h;
        const px = cx ?? v.x + v.w / 2;
        const py = cy ?? v.y + v.h / 2;
        const x = px - ((px - v.x) * w) / v.w;
        const y = py - ((py - v.y) * h) / v.h;
        return { x: Math.min(Math.max(x, -w * 0.25), floor.width - w * 0.75), y: Math.min(Math.max(y, -h * 0.25), floor.height - h * 0.75), w, h };
      }),
    [floor.width, floor.height],
  );

  /** Convert a mouse position to floor-plan coordinates. */
  const toSvg = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return { x: p.x, y: p.y };
  }, []);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const p = toSvg(e.clientX, e.clientY);
      zoomAt(e.deltaY > 0 ? 1.15 : 1 / 1.15, p.x, p.y);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [zoomAt, toSvg]);

  const panHandlers = {
    onPointerDown: (e: React.PointerEvent) => {
      drag.current = { x: e.clientX, y: e.clientY, vb, moved: false };
      suppressClick.current = false;
    },
    onPointerMove: (e: React.PointerEvent) => {
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
    },
    onPointerUp: () => {
      suppressClick.current = !!drag.current?.moved;
      drag.current = null;
    },
    onPointerLeave: () => {
      drag.current = null;
    },
  };

  return { svgRef, vb, setVb, full, zoomAt, toSvg, panHandlers, suppressClick, zoomed: vb.w < floor.width - 1 };
}

export function ZoomButtons({ zoomAt, zoomed, reset }: { zoomAt: (f: number) => void; zoomed: boolean; reset: () => void }) {
  return (
    <div className="map-zoom">
      <button onClick={() => zoomAt(1 / 1.4)} title="Zoom in">+</button>
      <button onClick={() => zoomAt(1.4)} title="Zoom out">−</button>
      {zoomed && <button onClick={reset} title="Show whole floor">⤢</button>}
    </div>
  );
}
