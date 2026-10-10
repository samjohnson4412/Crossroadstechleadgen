import assert from "node:assert/strict";
import { test } from "node:test";
import { findRooms } from "../lib/floorplan/rooms.ts";
import { applyPlan, readPlan } from "../lib/floorplan/importPlan.ts";
import { doorTypeFromColor, parsePathData, parsePlanSvg } from "../lib/floorplan/svg.ts";
import { rect, type Floor } from "../lib/core/site.ts";
import type { SiteLayout } from "../lib/core/overrides.ts";

// A 300×200 building: R1 | R2 | R3 over R4 (R3/R4 split by a divider, not a wall).
const SVG = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" viewBox="0 0 400 300">
  <defs><rect x="0" y="0" width="999" height="999" id="ignored"/></defs>
  <g inkscape:groupmode="layer" id="layer-scan" inkscape:label="Scan"><image width="10" height="10"/></g>
  <g inkscape:groupmode="layer" id="layer-rooms" inkscape:label="Dividers"><path d="M 200,100 H 300"/></g>
  <g inkscape:groupmode="layer" id="layer-walls" inkscape:label="Walls" transform="translate(10,10)">
    <path d="M -10,-10 H 290 V 190 H -10 Z"/>
    <path d="m 90,-10 v 200"/>
    <path d="M 190,-11 V 191"/>
  </g>
  <g inkscape:groupmode="layer" id="layer-doors" inkscape:label="Doors" style="stroke:#e53935">
    <path d="M 90,150 H 110" style="stroke:#1565c0"/>
    <path d="M 200,40 V 60"/>
    <path d="M -10,50 H 10"/>
    <path d="M 290,140 H 310"/>
    <path d="M 290,146 H 310"/>
  </g>
  <g inkscape:groupmode="layer" id="layer-labels" inkscape:label="Labels">
    <text x="50" y="100" style="text-anchor:middle"><tspan x="50" y="100">R1</tspan><tspan x="50" y="120">Office</tspan></text>
    <text x="150" y="100" style="text-anchor:middle"><tspan x="150" y="100">R2</tspan><tspan x="150" y="120">Studio</tspan></text>
    <text x="250" y="50" style="text-anchor:middle">R3</text>
    <text transform="scale(2)" x="125" y="75" style="text-anchor:middle">R4</text>
  </g>
</svg>`;

test("path data: relative moves, H/V and close", () => {
  assert.deepEqual(parsePathData("m 10,10 5,0 v 5 h -5 z")[0], [
    { x: 10, y: 10 }, { x: 15, y: 10 }, { x: 15, y: 15 }, { x: 10, y: 15 }, { x: 10, y: 10 },
  ]);
});

test("door colors map to lock types", () => {
  assert.equal(doorTypeFromColor("#1565c0"), "access");
  assert.equal(doorTypeFromColor("#ff9800"), "keypad");
  assert.equal(doorTypeFromColor("#2e7d32"), "none");
  assert.equal(doorTypeFromColor("#8e24aa"), "key");
  assert.equal(doorTypeFromColor("#e53935"), undefined);
  assert.equal(doorTypeFromColor("#000000"), undefined);
});

test("rooms come from enclosed walls and dividers, named by their labels", () => {
  const plan = parsePlanSvg(SVG);
  const { rooms, doors, footprint } = findRooms(plan);
  const names = rooms.map((r) => r.lines.join(" ")).sort();
  assert.deepEqual(names, ["R1 Office", "R2 Studio", "R3", "R4"]);
  assert.equal(footprint.length, 4);
  const byName = (n: string) => rooms.find((r) => r.lines[0] === n)!.index;
  const pair = (a: number, b: number) => doors.find((d) => (d.between[0] === a && d.between[1] === b) || (d.between[0] === b && d.between[1] === a));
  assert.equal(pair(byName("R1"), byName("R2"))?.type, "access");
  assert.ok(pair(byName("R2"), byName("R3")), "a door drawn along the wall still counts");
  assert.ok(pair(-1, byName("R1")), "outside door");
  assert.equal(doors.filter((d) => d.between.includes(byName("R4"))).length, 1, "double door lines are one door");
});

test("placing a plan replaces a building's rooms where the operator put it", () => {
  // Old map: the same building turned a quarter turn and doubled: plan (x, y) → map (100 + 2y, 700 − 2x).
  const m = (x: number, y: number) => ({ x: 100 + 2 * y, y: 700 - 2 * x });
  const box = (x0: number, y0: number, x1: number, y1: number) => [m(x0, y0), m(x1, y0), m(x1, y1), m(x0, y1)];
  const floor: Floor = {
    id: "l1",
    name: "Level 1",
    width: 1000,
    height: 1000,
    zones: [
      { id: "old-r1", name: "R1", kind: "room", building: "Test", polygon: box(0, 0, 100, 200) },
      { id: "old-r3", name: "R3", kind: "room", building: "Test", polygon: box(200, 0, 300, 100) },
      { id: "old-hall", name: "Old hall", kind: "hall", building: "Test", polygon: box(200, 100, 300, 200) },
      { id: "yard", name: "Yard", kind: "outdoor", polygon: rect(100, 705, 400, 100) },
    ],
    cameras: [{ id: "c1", name: "Hall cam", position: m(250, 150), covers: ["old-hall"], source: { integration: "cams", externalId: "c1" } }],
    doors: [{ id: "side", name: "Side Door", position: { x: 205, y: 712 }, between: ["yard", "old-r1"], exterior: true, source: { integration: "acs", externalId: "side" } }],
    displays: [],
  };
  const layout: SiteLayout = { buildings: [{ id: "b", name: "Campus", floors: [floor] }], passages: [{ between: ["old-hall", "yard"] }] };
  const plan = readPlan(SVG);
  // The operator turned it a quarter turn left (3 right) and doubled it, centred at (300, 400).
  const { layout: out, report } = applyPlan({ layout, floorId: "l1", plan, placement: { x: 300, y: 400, turns: 3, scaleX: 2, scaleY: 2 }, building: "Test", replace: "Test" });
  const f = out.buildings[0].floors[0];
  const zone = (name: string) => f.zones.find((z) => z.name === name)!;
  assert.deepEqual(zone("R1 Office").polygon.map((p) => [p.x, p.y]).sort(), box(0, 0, 100, 200).map((p) => [p.x, p.y]).sort());
  assert.equal(zone("R3").id, "old-r3", "same name keeps its id");
  assert.ok(!f.zones.some((z) => z.id === "old-hall" || z.id === "old-r1"));
  // Things that pointed at old rooms now point at the room in the same spot.
  assert.deepEqual(f.cameras[0].covers, [zone("R4").id]);
  assert.deepEqual(out.passages[0].between, [zone("R4").id, "yard"]);
  assert.deepEqual(f.doors.find((d) => d.id === "side")!.between, ["yard", zone("R1 Office").id]);
  // Plan doors: R1's outside door reaches the yard; R4's leads nowhere drawn.
  assert.ok(f.doors.some((d) => !d.source && d.exterior && d.between[0] === "yard" && d.between[1] === zone("R1 Office").id));
  assert.equal(report.exteriorDoors, 1);
  assert.ok(report.warnings.some((w) => w.includes("R4")));
  assert.equal(f.doors.find((d) => d.between.includes(zone("R1 Office").id) && d.between.includes(zone("R2 Studio").id))?.lockType, "access");
  assert.equal(f.drawings?.length, 1);
});

test("adding a plan as a new building leaves other rooms alone", () => {
  const floor: Floor = { id: "l1", name: "L1", width: 1000, height: 1000, zones: [{ id: "a", name: "A", kind: "room", building: "Other", polygon: rect(0, 0, 10, 10) }], cameras: [], doors: [], displays: [] };
  const plan = readPlan(SVG);
  const { layout } = applyPlan({ layout: { buildings: [{ id: "b", name: "B", floors: [floor] }], passages: [] }, floorId: "l1", plan, placement: { x: 500, y: 500, turns: 0, scaleX: 1, scaleY: 1 }, building: "New" });
  const f = layout.buildings[0].floors[0];
  assert.equal(f.zones.length, 5);
  assert.ok(f.zones.find((z) => z.id === "a"));
  assert.ok(f.zones.filter((z) => z.building === "New").every((z) => z.polygon.every((p) => p.x >= 340 && p.x <= 660)));
});
