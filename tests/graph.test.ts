import assert from "node:assert/strict";
import { test } from "node:test";
import { cccSite } from "../config/sites/ccc.ts";
import { SiteGraph } from "../lib/core/graph.ts";

const graph = new SiteGraph(cccSite);

test("doors and passages make zones adjacent", () => {
  assert.ok(graph.neighbors("lobby").includes("front-drive"));
  assert.ok(graph.neighbors("lobby").includes("hall-1w"));
  assert.ok(graph.neighbors("stair-1").includes("stair-2"), "stairwell passage crosses floors");
});

test("cameras near a zone are ordered by walking time", () => {
  const near = graph.camerasNear("lobby", 1);
  assert.equal(near[0].cameraId, "c-lobby");
  assert.equal(near[0].hops, 0);
  const ids = near.map((n) => n.cameraId);
  assert.ok(ids.includes("c-front-drive"));
  assert.ok(ids.includes("c-hall-1w"));
  assert.ok(!ids.includes("c-library"), "other floor is out of range at 1 hop");
});

test("distances reach the second floor through the stairwell", () => {
  const d = graph.distancesFrom("hall-1e").get("hall-2e");
  assert.ok(d);
  assert.equal(d.hops, 3); // hall → stair → stair → hall
});

test("every mapped camera covers a real zone and every device has a unique id", () => {
  const ids = [...graph.cameras.keys(), ...graph.doors.keys(), ...graph.zones.keys(), ...graph.displays.keys()];
  assert.equal(new Set(ids).size, ids.length);
});
