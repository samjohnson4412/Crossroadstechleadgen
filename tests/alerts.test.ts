import assert from "node:assert/strict";
import { test } from "node:test";
import { demoSite } from "../config/sites/demo.ts";
import { Runtime } from "../lib/core/runtime.ts";

const actor = { name: "test" };

test("an alert reaches every chosen channel, targeted by room, and clears", async () => {
  process.env.SENTINEL_SIMULATE = "1";
  process.env.SENTINEL_SITE = "demo-test";
  const rt = new Runtime(demoSite);
  await rt.start();
  try {
    const alert = await rt.sendAlert(
      { presetId: "shelter", level: "emergency", title: "SHELTER IN PLACE", message: "Go to interior rooms", zoneIds: ["room-101"], scopeLabel: "Room 101", channels: ["displays", "paging", "saferwatch"] },
      actor,
    );
    const by = Object.fromEntries(alert.deliveries.map((d) => [d.channel, d]));
    assert.equal(by.displays.status, "simulated");
    assert.equal(by.displays.detail, "1 board(s)", "only the board in Room 101");
    assert.equal(by.paging.status, "simulated");
    assert.equal(by.saferwatch.status, "simulated");

    const none = await rt.sendAlert(
      { presetId: "announcement", level: "info", title: "Hi", message: "", zoneIds: ["hall-1w"], scopeLabel: "Hall", channels: ["displays"] },
      actor,
    );
    assert.equal(none.deliveries[0].status, "skipped", "no boards in that hallway");

    const lock = await rt.sendAlert({ presetId: "lockdown", level: "emergency", title: "LOCKDOWN", message: "", zoneIds: null, scopeLabel: "Entire campus", channels: ["lockdown"] }, actor);
    assert.equal(rt.lockdown, true);
    await rt.clearAlert(lock.id, actor, { liftLockdown: true });
    assert.equal(rt.lockdown, false);
    assert.equal(rt.alerts.find((a) => a.id === lock.id)!.status, "cleared");

    await assert.rejects(rt.sendAlert({ presetId: "x", level: "info", title: "", message: "", zoneIds: null, scopeLabel: "", channels: ["displays"] }, actor));
  } finally {
    await rt.stop();
  }
});
