"use client";

import { useMemo, useState } from "react";
import { importFloorPlan, type CameraInfo, type ImportReport } from "@/lib/floorplan/importPlan";
import type { SiteLayout } from "@/lib/core/overrides";
import type { Floor } from "@/lib/core/site";
import { Modal } from "./Panels";

/** File name without a download/upload id in front ("725ca99c-EB_FL_1.svg" → "EB_FL_1.svg"). */
const cleanName = (n: string) => n.replace(/^[0-9a-f]{6,}[-_ ]/i, "");

/** "EB_FL_1.svg" → "EB1": the usual camera-name prefix for that building and level. */
function guessPrefix(fileName: string) {
  const m = cleanName(fileName).match(/^([A-Za-z]+)[^0-9]*?(\d+)/);
  return m ? `${m[1].toUpperCase()}${m[2]}` : "";
}

/**
 * Import a floor plan drawn in Inkscape (docs/floorplans/floorplan-template.svg) into the map
 * editor's draft. Nothing is saved until the editor's Save map.
 */
export function ImportPlanDialog({ draft, floor, cameras, onApply, onClose }: {
  draft: SiteLayout;
  floor: Floor;
  cameras: CameraInfo[];
  onApply: (layout: SiteLayout, report: ImportReport) => void;
  onClose: () => void;
}) {
  const buildings = useMemo(() => [...new Set(floor.zones.map((z) => z.building).filter((b): b is string => !!b))].sort(), [floor]);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [building, setBuilding] = useState(buildings[0] ?? "");
  const [otherBuilding, setOtherBuilding] = useState("");
  const [prefix, setPrefix] = useState("");
  const [result, setResult] = useState<{ layout: SiteLayout; report: ImportReport } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const target = building === "__other" ? otherBuilding.trim() : building;

  const pick = async (f: File | undefined) => {
    setResult(null);
    setError(null);
    if (!f) return setFile(null);
    setFile({ name: f.name, text: await f.text() });
    setPrefix(guessPrefix(f.name));
    const first = cleanName(f.name)[0]?.toLowerCase();
    const match = buildings.find((b) => b[0]?.toLowerCase() === first);
    if (match) setBuilding(match);
  };

  const preview = () => {
    setError(null);
    setResult(null);
    try {
      setResult(importFloorPlan({ layout: draft, floorId: floor.id, building: target, svg: file!.text, cameras, cameraPrefix: prefix }));
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const r = result?.report;
  return (
    <Modal title={`Import floor plan — ${floor.name}`} onClose={onClose}>
      <p className="muted small">
        Pick a plan drawn on the Inkscape template (walls, doors, labels). It replaces that building&apos;s rooms on this level. Rooms with the same
        number keep their history; cameras and badge doors move to the new rooms.
      </p>
      <label>Floor plan (.svg)<input type="file" accept=".svg,image/svg+xml" onChange={(e) => pick(e.target.files?.[0])} /></label>
      <div className="grid2">
        <label>Building it replaces
          <select value={building} onChange={(e) => (setBuilding(e.target.value), setResult(null))}>
            {buildings.map((b) => <option key={b} value={b}>{b}</option>)}
            <option value="__other">New building…</option>
          </select>
        </label>
        {building === "__other" ? (
          <label>Building name<input value={otherBuilding} onChange={(e) => (setOtherBuilding(e.target.value), setResult(null))} placeholder="e.g. Y Building" /></label>
        ) : (
          <label>Camera names start with
            <input value={prefix} onChange={(e) => (setPrefix(e.target.value), setResult(null))} placeholder="e.g. EB1" />
          </label>
        )}
      </div>
      {error && <p className="error">{error}</p>}
      {r && (
        <div className="import-report">
          <p>
            <strong>{r.rooms} rooms</strong>, <strong>{r.doors} doors</strong> ({r.exteriorDoors} to the outside).{" "}
            {r.fit === "matched rooms" ? <>Lined up using {r.matched.length} rooms with the same names ({r.matched.join(", ")}), off by ~{r.fitError} on average.</> : r.fit === "old outline" ? "Stretched over the old rooms." : "Placed in the middle of the map."}
          </p>
          {r.controlledDoors.length > 0 && <><div className="section-title">Badge doors moved onto the plan</div><ul>{r.controlledDoors.map((x) => <li key={x}>{x}</li>)}</ul></>}
          {r.camerasPlaced.length > 0 && <><div className="section-title">Cameras placed by name (dashed until you confirm the spot)</div><ul>{r.camerasPlaced.map((x) => <li key={x}>{x}</li>)}</ul></>}
          {r.camerasMoved.length > 0 && <><div className="section-title">Cameras already on the map, now covering</div><ul>{r.camerasMoved.map((x) => <li key={x}>{x}</li>)}</ul></>}
          {r.links.length > 0 && <><div className="section-title">Connections to other buildings / levels kept</div><ul>{r.links.map((x) => <li key={x}>{x}</li>)}</ul></>}
          {r.removedRooms.length > 0 && <><div className="section-title">Old rooms replaced</div><ul><li>{r.removedRooms.join(", ")}</li></ul></>}
          {r.warnings.length > 0 && <><div className="section-title">Check</div><ul>{r.warnings.map((x) => <li key={x} className="warn-text">{x}</li>)}</ul></>}
        </div>
      )}
      <div className="btn-row end">
        <button onClick={onClose}>Cancel</button>
        <button disabled={!file || !target} onClick={preview}>Preview</button>
        <button className="btn-primary" disabled={!result} onClick={() => onApply(result!.layout, result!.report)}>Put on map</button>
      </div>
    </Modal>
  );
}
