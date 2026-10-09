import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyAction, parseColumns, parseTransactionLine, toRawEvent } from "../lib/integrations/identipass.ts";

/** Build a line the way IDentiPASS's transaction printer lays it out (Transaction Printer Setup defaults). */
function line(date: string, time: string, card: string, holder: string, panel: string, point: string, action: string) {
  const col = (s: string, w: number) => s.slice(0, w).padEnd(w);
  return col(date, 15) + col(time, 10) + col(card, 10) + col(holder, 15) + col(panel, 15) + col(point, 15) + col(action, 20);
}

test("parses a printed access-granted line", () => {
  const tx = parseTransactionLine(line("10/09/2026", "19:45.42", "42349", "Andrea Bishop CLEANING CREW", "Worship Center", "(3) WC West Lobby", "Access Granted"))!;
  assert.ok(tx);
  assert.equal(tx.card, "42349");
  assert.equal(tx.holder, "Andrea Bishop C", "holder column is 15 wide, as configured");
  assert.equal(tx.point, "WC West Lob", "default 15-wide column cuts the name; the (n) prefix is removed");
  assert.equal(tx.at.getHours(), 19);
  assert.equal(tx.at.getMinutes(), 45);
  assert.equal(tx.at.getSeconds(), 42);
  const ev = toRawEvent(tx, "");
  assert.equal(ev.type, "access.granted");
  assert.equal(ev.externalDoorId, "WC West Lob");
  assert.deepEqual(ev.person, { id: "42349", name: "Andrea Bishop C" });
});

test("unknown cards are denials without a name", () => {
  const tx = parseTransactionLine(line("10/09/2026", "16:18.45", "44034", "0000044034", "MAINT. OFFICE", "(2) EB Academy Do", "Site Code Fail"))!;
  const ev = toRawEvent(tx, "");
  assert.equal(ev.type, "access.denied");
  assert.equal(ev.person?.name, undefined);
});

test("falls back to splitting on spaces when columns differ", () => {
  const tx = parseTransactionLine("10/09/2026  17:25.57  42137  Alex Jacovides  MAINT. OFFICE  (7) YC Cafe Entry  Access Granted")!;
  assert.equal(tx.point, "YC Cafe Entry");
  assert.equal(tx.action, "Access Granted");
});

test("ignores blank and heading lines; classifies door alarms", () => {
  assert.equal(parseTransactionLine(""), null);
  assert.equal(parseTransactionLine("Date           Time      Card..."), null);
  assert.equal(classifyAction("Door Forced Open").type, "door.forced");
  assert.equal(classifyAction("Door Held Open").type, "door.held");
});

test("wider columns from the setting keep full names", () => {
  const cols = parseColumns("0/12 12/10 22/10 32/30 62/16 78/30 108/25");
  const c = (s: string, w: number) => s.padEnd(w);
  const l = c("10/09/2026", 12) + c("19:45.42", 10) + c("42349", 10) + c("Andrea Bishop CLEANING CREW", 30) + c("Worship Center", 16) + c("(3) WC West Lobby", 30) + c("Access Granted", 25);
  const tx = parseTransactionLine(l, cols)!;
  assert.equal(tx.point, "WC West Lobby");
  assert.equal(tx.holder, "Andrea Bishop CLEANING CREW");
  assert.equal(parseColumns("garbage"), parseColumns(undefined), "bad setting falls back to defaults");
});
