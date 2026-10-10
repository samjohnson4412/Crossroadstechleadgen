import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_RULES, evaluateRules, parseLabels, withinHours, type Detection } from "../lib/core/detections.ts";

const det = (labels: Detection["labels"], at: string, id = Math.random().toString(36), cameraId = "c1"): Detection => ({
  id, at, integration: "cameras", cameraId, labels, summary: "", hasSnapshot: false, ruleHits: [], severity: "info", status: "new",
});

test("reads Blue Iris memos", () => {
  assert.deepEqual(parseLabels("person:87%"), [{ label: "person", confidence: 87 }]);
  assert.deepEqual(parseLabels("person:87%,car:61%").map((l) => l.label), ["person", "car"]);
  assert.deepEqual(parseLabels("Person 90% Knife 55%"), [{ label: "person", confidence: 90 }, { label: "knife", confidence: 55 }]);
  assert.deepEqual(parseLabels("nothing found"), []);
  assert.deepEqual(parseLabels(""), []);
});

test("hours wrap past midnight", () => {
  assert.equal(withinHours(new Date("2026-10-10T23:30:00"), "22:00", "05:00"), true);
  assert.equal(withinHours(new Date("2026-10-10T03:00:00"), "22:00", "05:00"), true);
  assert.equal(withinHours(new Date("2026-10-10T12:00:00"), "22:00", "05:00"), false);
});

test("weapon fires above the confidence floor only", () => {
  const hit = evaluateRules(DEFAULT_RULES, det([{ label: "gun", confidence: 72 }], "2026-10-10T12:00:00"), [], []);
  assert.deepEqual(hit.map((h) => h.ruleId), ["weapon"]);
  assert.equal(evaluateRules(DEFAULT_RULES, det([{ label: "gun", confidence: 30 }], "2026-10-10T12:00:00"), [], []).length, 0);
});

test("person at noon is fine; at 11pm is after hours", () => {
  assert.equal(evaluateRules(DEFAULT_RULES, det([{ label: "person", confidence: 90 }], "2026-10-10T12:00:00"), [], []).length, 0);
  assert.deepEqual(evaluateRules(DEFAULT_RULES, det([{ label: "person", confidence: 90 }], "2026-10-10T23:00:00"), [], []).map((h) => h.ruleId), ["after-hours"]);
});

test("loitering needs repeated detections on one camera, and fires once per window", () => {
  const recent: Detection[] = [];
  const base = Date.parse("2026-10-10T12:00:00");
  let fired = 0;
  for (let i = 0; i < 8; i++) {
    const d = det([{ label: "person", confidence: 90 }], new Date(base + i * 60_000).toISOString());
    d.ruleHits = evaluateRules(DEFAULT_RULES, d, recent, []);
    if (d.ruleHits.some((h) => h.ruleId === "loitering")) fired++;
    recent.push(d);
  }
  assert.equal(fired, 1);
});
