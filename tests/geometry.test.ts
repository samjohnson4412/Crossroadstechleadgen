import assert from "node:assert/strict";
import { test } from "node:test";
import { distanceToOutline, pointInPolygon, polygonsTouch } from "../lib/core/geometry.ts";
import { rect } from "../lib/core/site.ts";

test("point in polygon", () => {
  assert.equal(pointInPolygon({ x: 5, y: 5 }, rect(0, 0, 10, 10)), true);
  assert.equal(pointInPolygon({ x: 15, y: 5 }, rect(0, 0, 10, 10)), false);
});

test("rooms sharing a wall touch; rooms apart don't", () => {
  assert.equal(polygonsTouch(rect(0, 0, 10, 10), rect(10, 0, 10, 10)), true);
  assert.equal(polygonsTouch(rect(0, 0, 10, 10), rect(30, 0, 10, 10)), false);
  assert.equal(polygonsTouch(rect(0, 0, 10, 10), rect(2, 2, 3, 3)), true, "nested counts as touching");
});

test("distance to outline finds the nearest edge", () => {
  const hit = distanceToOutline({ x: 5, y: -3 }, rect(0, 0, 10, 10));
  assert.equal(hit.distance, 3);
  assert.equal(hit.edge, 0);
});
