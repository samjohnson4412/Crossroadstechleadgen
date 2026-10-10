import assert from "node:assert/strict";
import { test } from "node:test";
import { pointInPolygon } from "../lib/core/geometry.ts";
import { roomLabel } from "../lib/core/labels.ts";
import { poly, rect } from "../lib/core/site.ts";

test("a plain room gets its name in the middle, as big as fits", () => {
  const l = roomLabel("E105", rect(0, 0, 100, 60), 13);
  assert.ok(Math.abs(l.x - 50) < 2 && Math.abs(l.y - 30) < 2);
  assert.equal(l.fontSize, 13);
  assert.equal(l.vertical, false);
});

test("a U-shaped hallway gets its label inside the hallway, not in the middle of the U", () => {
  // U: left leg, bottom, right leg; the middle (50, 40) is outside.
  const u = poly(0, 0, 20, 0, 20, 80, 80, 80, 80, 0, 100, 0, 100, 100, 0, 100);
  const l = roomLabel("Hallway", u, 13);
  assert.ok(pointInPolygon(l, u), `${l.x},${l.y} should be inside`);
});

test("small rooms get small text; long names wrap or turn to fit", () => {
  const small = roomLabel("Closet", rect(0, 0, 20, 12), 13);
  assert.ok(small.fontSize < 6);
  const narrowTall = roomLabel("Accounting Hallway", rect(0, 0, 12, 200), 13);
  assert.equal(narrowTall.vertical, true);
  const square = roomLabel("School Resource Officer", rect(0, 0, 60, 60), 13);
  assert.equal(square.lines.length, 2);
});
