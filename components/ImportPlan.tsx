"use client";

import { useMemo, useState } from "react";
import { readPlan, type ReadPlan } from "@/lib/floorplan/importPlan";
import type { Floor } from "@/lib/core/site";
import { Modal } from "./Panels";

export interface PlanChoice {
  plan: ReadPlan;
  building: string;
  /** Building whose rooms (and drawing) this replaces on this level. */
  replace?: string;
}

/** File name → a readable default building name ("725ca99c-EB_FL_1.svg" → "EB FL 1"). */
const nameFromFile = (n: string) => n.replace(/^[0-9a-f]{6,}[-_ ]/i, "").replace(/\.svg$/i, "").replace(/[_-]+/g, " ").trim();

/** Step 1 of importing a floor plan: pick the file, and whether it's new or replaces a building. Step 2 (lining it up) happens on the map. */
export function ImportPlanDialog({ floor, onNext, onClose }: { floor: Floor; onNext: (choice: PlanChoice) => void; onClose: () => void }) {
  const buildings = useMemo(
    () => [...new Set([...floor.zones.map((z) => z.building), ...(floor.drawings ?? []).map((d) => d.building)].filter((b): b is string => !!b))].sort(),
    [floor],
  );
  const [plan, setPlan] = useState<ReadPlan | null>(null);
  const [mode, setMode] = useState<"new" | "replace">("new");
  const [name, setName] = useState("");
  const [replace, setReplace] = useState(buildings[0] ?? "");
  const [error, setError] = useState<string | null>(null);

  const pick = async (f: File | undefined) => {
    setPlan(null);
    setError(null);
    if (!f) return;
    try {
      setPlan(readPlan(await f.text()));
      setName((n) => n || nameFromFile(f.name));
    } catch (err) {
      setError((err as Error).message);
    }
  };
  const building = mode === "replace" ? replace : name.trim();

  return (
    <Modal title={`Import floor plan — ${floor.name}`} onClose={onClose}>
      <p className="muted small">An .svg drawn on the Inkscape template. Next you&apos;ll drag it into place on the map and size it.</p>
      <label>Floor plan (.svg)<input type="file" accept=".svg,image/svg+xml" onChange={(e) => pick(e.target.files?.[0])} /></label>
      {error && <p className="error">{error}</p>}
      {plan && (
        <p className="muted small">
          Found {plan.rooms.length} rooms and {plan.doors.length} doors.{plan.warnings.length > 0 && <> {plan.warnings.join(" ")}</>}
        </p>
      )}
      <label className="toggle"><input type="radio" checked={mode === "new"} onChange={() => setMode("new")} /> A new building on this level</label>
      {mode === "new" && <label>Building name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Education" /></label>}
      <label className="toggle">
        <input type="radio" checked={mode === "replace"} disabled={!buildings.length} onChange={() => setMode("replace")} /> Replaces a building already on this level
      </label>
      {mode === "replace" && (
        <>
          <select value={replace} onChange={(e) => setReplace(e.target.value)}>
            {buildings.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
          <p className="muted small">
            Its old rooms, doors and drawing are removed. Cameras, badge doors and stairs that pointed at them move to the new room in the same spot.
          </p>
        </>
      )}
      <div className="btn-row end">
        <button onClick={onClose}>Cancel</button>
        <button className="btn-primary" disabled={!plan || !building} onClick={() => onNext({ plan: plan!, building, replace: mode === "replace" ? replace : undefined })}>
          Next: line it up
        </button>
      </div>
    </Modal>
  );
}
