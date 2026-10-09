import assert from "node:assert/strict";
import { test } from "node:test";
import { cccSite } from "../config/sites/ccc.ts";
import { SiteGraph } from "../lib/core/graph.ts";

const graph = new SiteGraph(cccSite);

test("every CCC area is reachable on foot from the sanctuary lobby", () => {
  const reachable = graph.distancesFrom("s-north-lobby");
  const unreachable = [...graph.zones.keys()].filter((z) => !reachable.has(z) && z !== "o-playground");
  assert.deepEqual(unreachable, []);
});

test("the three buildings connect: Y ↔ Education on level 1, Education ↔ Sanctuary over the skybridge", () => {
  assert.ok(graph.distancesFrom("y-gym").has("e-101"));
  const viaBridge = graph.distancesFrom("e2-200").get("s2-balcony");
  assert.ok(viaBridge && viaBridge.hops <= 5);
});

test("ids are unique and every placement points inside its floor", () => {
  const ids = [...graph.zones.keys(), ...graph.cameras.keys(), ...graph.doors.keys()];
  assert.equal(new Set(ids).size, ids.length);
  for (const f of graph.floors.values()) {
    for (const p of [...f.cameras.map((c) => c.position), ...f.doors.map((d) => d.position), ...f.zones.flatMap((z) => z.polygon)]) {
      assert.ok(p.x >= 0 && p.x <= f.width && p.y >= 0 && p.y <= f.height, `${f.id}: ${p.x},${p.y}`);
    }
  }
});
