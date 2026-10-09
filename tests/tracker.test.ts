import assert from "node:assert/strict";
import { test } from "node:test";
import { cccSite } from "../config/sites/ccc.ts";
import type { SecurityEvent } from "../lib/core/events.ts";
import { SiteGraph } from "../lib/core/graph.ts";
import { appearanceScore, reachability, Tracker } from "../lib/tracking/tracker.ts";

const graph = new SiteGraph(cccSite);
const t0 = Date.parse("2026-01-01T12:00:00Z");
const iso = (s: number) => new Date(t0 + s * 1000).toISOString();

function detection(cameraId: string, atSec: number, appearance?: SecurityEvent["appearance"]): SecurityEvent {
  return { id: `e${atSec}${cameraId}`, type: "person.detected", at: iso(atSec), severity: "info", integration: "cameras", summary: "person", cameraId, appearance };
}

function newTrack() {
  const tracker = new Tracker(graph);
  const track = tracker.create({ label: "Suspect", by: "test", appearance: { upperColor: "red", lowerColor: "black" } });
  tracker.addSighting(track.id, { cameraId: "c-lobby" }, "operator", "test", iso(0));
  return { tracker, track };
}

test("appearance: match, partial, mismatch, unknown", () => {
  const target = { upperColor: "red", lowerColor: "black" };
  assert.equal(appearanceScore(target, { upperColor: "red", lowerColor: "black" }), 0.8);
  assert.equal(appearanceScore(target, { upperColor: "red", lowerColor: "blue" }), 0.3);
  assert.equal(appearanceScore(target, { upperColor: "green", lowerColor: "blue" }), 0);
  assert.equal(appearanceScore(target, undefined), null);
});

test("reachability rules out impossible jumps", () => {
  assert.equal(reachability(graph, "lobby", t0, "hall-1w", t0 + 10_000).possible, true);
  assert.equal(reachability(graph, "lobby", t0, "library", t0 + 5_000).possible, false);
});

test("matching detection at a reachable camera becomes a suggestion", () => {
  const { tracker, track } = newTrack();
  tracker.ingest(detection("c-hall-1w", 12, { upperColor: "red", lowerColor: "black" }));
  assert.equal(track.suggestions.length, 1);
  assert.equal(track.suggestions[0].cameraId, "c-hall-1w");
});

test("wrong clothes or impossible location is ignored", () => {
  const { tracker, track } = newTrack();
  tracker.ingest(detection("c-hall-1w", 12, { upperColor: "green", lowerColor: "blue" }));
  tracker.ingest(detection("c-library", 3, { upperColor: "red", lowerColor: "black" }));
  assert.equal(track.suggestions.length, 0);
});

test("detections without appearance only suggest nearby, recent hits", () => {
  const { tracker, track } = newTrack();
  tracker.ingest(detection("c-hall-1w", 10));
  tracker.ingest(detection("c-library", 200)); // reachable by now, but too far for an appearance-less hit
  assert.deepEqual(track.suggestions.map((s) => s.cameraId), ["c-hall-1w"]);
});

test("confirming a suggestion moves the track; badge swipes add sightings", () => {
  const { tracker, track } = newTrack();
  tracker.ingest(detection("c-hall-1w", 12, { upperColor: "red", lowerColor: "black" }));
  tracker.confirmSuggestion(track.id, track.suggestions[0].id, "test");
  assert.equal(track.sightings.at(-1)!.zoneId, "hall-1w");

  tracker.update(track.id, { credentialIds: ["cred-9"] });
  tracker.ingest({ id: "x", type: "access.granted", at: iso(40), severity: "info", integration: "doors", summary: "", doorId: "d-office-hall", person: { id: "cred-9" } });
  const last = track.sightings.at(-1)!;
  assert.equal(last.source, "access");
  assert.equal(last.zoneId, "office", "door sighting resolves to the side they walked into");
});

test("next cameras follow the latest sighting", () => {
  const { tracker, track } = newTrack();
  assert.equal(tracker.nextCameras(track)[0].cameraId, "c-lobby");
  tracker.addSighting(track.id, { cameraId: "c-stair-1" }, "operator", "test", iso(60));
  const next = tracker.nextCameras(track, 1).map((c) => c.cameraId);
  assert.ok(next.includes("c-stair-2"));
});
