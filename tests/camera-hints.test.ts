import assert from "node:assert/strict";
import { test } from "node:test";
import { placeSuggestedCameras } from "../lib/core/cameraHints.ts";
import { pointInPolygon } from "../lib/core/geometry.ts";
import { rect, type Floor } from "../lib/core/site.ts";

test("suggested cameras land inside their room, spread out, skipping ones already on the map", () => {
  const floor: Floor = {
    id: "l1", name: "L1", width: 1000, height: 1000,
    zones: [{ id: "gym", name: "Gym", kind: "common", polygon: rect(0, 0, 200, 100) }, { id: "lib", name: "E099 Library", kind: "room", polygon: rect(300, 0, 100, 100) }],
    cameras: [{ id: "x", name: "Existing", position: { x: 10, y: 10 }, covers: ["gym"], source: { integration: "bi", externalId: "old" } }],
    doors: [], displays: [],
  };
  const cams = ["old", "g1", "g2", "lib", "nowhere", "nohint"].map((id) => ({ integration: "bi", externalId: id, name: id.toUpperCase() }));
  const hints = {
    old: { rooms: ["gym"], sure: true },
    g1: { rooms: ["gym"], sure: true },
    g2: { rooms: ["gym"], sure: false },
    lib: { rooms: ["missing-room", "e099 library"], sure: false },
    nowhere: { rooms: ["Chapel"], sure: false },
  };
  const { layout, placed, noRoom } = placeSuggestedCameras({ buildings: [{ id: "b", name: "B", floors: [floor] }], passages: [] }, cams, hints);
  const f = layout.buildings[0].floors[0];
  assert.deepEqual(placed.map((p) => `${p.name}@${p.room}`), ["G1@Gym", "G2@Gym", "LIB@E099 Library"]);
  assert.deepEqual(noRoom, ["NOWHERE"]);
  assert.equal(f.cameras.length, 4);
  const g = f.cameras.filter((c) => c.source.externalId.startsWith("g"));
  assert.ok(g.every((c) => pointInPolygon(c.position, rect(0, 0, 200, 100)) && c.placeholder));
  assert.notDeepEqual(g[0].position, g[1].position);
});
