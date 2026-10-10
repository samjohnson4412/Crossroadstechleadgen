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

test("SMS: alert texts go to subscribed contacts; repeats are suppressed", async () => {
  process.env.SENTINEL_SIMULATE = "1";
  process.env.SENTINEL_SITE = "demo-test";
  const rt = new Runtime(demoSite);
  await rt.start();
  try {
    rt.contacts = [
      { id: "a", name: "Sam", phone: "+15551230001", topics: ["alerts", "critical"], enabled: true },
      { id: "b", name: "Off", phone: "+15551230002", topics: ["alerts"], enabled: false },
      { id: "c", name: "Doors only", phone: "+15551230003", topics: ["doors"], enabled: true },
    ];
    const alert = await rt.sendAlert({ presetId: "evacuate", level: "emergency", title: "EVACUATE", message: "Go", zoneIds: null, scopeLabel: "Entire campus", channels: ["sms"] }, { name: "t" });
    assert.equal(alert.deliveries[0].status, "simulated");
    assert.equal(alert.deliveries[0].detail, "1 text(s)");
    const again = await rt.notify("doors", "Door forced", "same");
    assert.equal(again.sent, 1);
    const dup = await rt.notify("doors", "Door forced", "same");
    assert.equal(dup.sent, 0, "same thing within 2 minutes isn't texted twice");
  } finally {
    await rt.stop();
  }
});

test("drill: marked DRILL, opens a drill incident, logged with its all clear; incident records and closes", async () => {
  process.env.SENTINEL_SIMULATE = "1";
  process.env.SENTINEL_SITE = "demo-test-drill";
  const { rmSync } = await import("node:fs");
  rmSync("data/drills.demo-test-drill.jsonl", { force: true });
  rmSync("data/incidents.demo-test-drill.json", { force: true });
  const rt = new Runtime(demoSite);
  await rt.start();
  try {
    const a = await rt.sendAlert({ presetId: "lockdown", level: "emergency", title: "LOCKDOWN", message: "Locks, lights.", zoneIds: null, scopeLabel: "Entire campus", channels: ["displays"], drill: true }, actor);
    assert.equal(a.title, "DRILL: LOCKDOWN");
    assert.match(a.message, /This is a drill\./);
    const inc = rt.openIncident()!;
    assert.ok(inc && inc.drill, "emergency alert opened a drill incident");
    assert.ok(inc.alertIds.includes(a.id));
    rt.addIncidentNote(inc.id, "Room 101 reported clear", actor);
    await rt.clearAlert(a.id, actor);
    assert.ok(inc.timeline.some((i) => i.kind === "note" && i.text.includes("Room 101")));
    assert.ok(inc.timeline.some((i) => i.kind === "action" && i.text.includes("alert.lockdown")));
    rt.closeIncident(inc.id, "Drill went well", actor);
    assert.equal(rt.openIncident(), undefined);
    assert.equal(rt.incidentReport(inc.id).alerts.length, 1);
    await new Promise((r) => setTimeout(r, 50));
    const log = rt.drillLog();
    assert.equal(log.length, 1);
    assert.ok(log[0].clearedAt, "all clear recorded");
    assert.throws(() => rt.openIncidentNow("x", actor) && rt.openIncidentNow("y", actor), /already open/);
  } finally {
    await rt.stop();
  }
});
