import { createServer, type Server } from "node:net";
import type { EventType, RawEvent, Severity } from "../core/events.ts";
import type { IntegrationDriver } from "./types.ts";

/**
 * IDenticard IDentiPASS 2.x (access control) — read-only event feed.
 *
 * IDentiPASS can "print" every transaction as it happens (Tools → Transaction Printer
 * Setup). Each transaction is one fixed-width text line. Instead of paper, that printer
 * output is sent to the console, which turns each line into a door event on the map:
 * badge swipes (feeding suspect tracking by card), denials, forced/held doors.
 *
 * Nothing is ever sent to IDentiPASS or its panels.
 *
 * Settings:
 *   listenPort   TCP port the console listens on for the printer feed (default 9100, "raw" printing)
 *   columns      the Transaction Printer Setup columns as start/width pairs, in its order
 *                (default "0/15 15/10 25/10 35/15 50/15 65/15 80/20" = IDentiPASS's defaults).
 *                Recommended wider layout so names aren't cut off:
 *                "0/12 12/10 22/10 32/30 62/16 78/30 108/25"
 *
 * Feed paths that work:
 *   - A Windows printer on the PC running the IDentiPASS client: driver "Generic / Text Only",
 *     port "Standard TCP/IP" → console server IP, raw port 9100. IDentiPASS prints to that port.
 *   - Or POST the text lines to /api/integrations/<id>/webhook (testing / relays).
 */

/** Column layout from IDentiPASS's Transaction Printer Setup (start, width). */
export type Columns = Record<"date" | "time" | "card" | "holder" | "panel" | "point" | "action", readonly [number, number]>;

export const DEFAULT_COLUMNS: Columns = {
  date: [0, 15],
  time: [15, 10],
  card: [25, 10],
  holder: [35, 15],
  panel: [50, 15],
  point: [65, 15],
  action: [80, 20],
};

/**
 * Column layout from the setting, written like IDentiPASS's setup screen, in its order
 * (Date, Time, Card Number, Card Holder, Panel, Point, Action), as start/width pairs:
 * "0/15 15/10 25/10 35/15 50/15 65/15 80/20".
 */
export function parseColumns(spec: unknown): Columns {
  if (!spec) return DEFAULT_COLUMNS;
  const pairs = String(spec).trim().split(/[\s,;]+/).map((p) => p.split("/").map(Number));
  const keys = ["date", "time", "card", "holder", "panel", "point", "action"] as const;
  if (pairs.length !== 7 || pairs.some((p) => p.length !== 2 || p.some((n) => !Number.isFinite(n) || n < 0))) return DEFAULT_COLUMNS;
  return Object.fromEntries(keys.map((k, i) => [k, [pairs[i][0], pairs[i][1]] as const])) as Columns;
}

export interface IdentipassTransaction {
  at: Date;
  card: string;
  holder: string;
  panel: string;
  point: string;
  action: string;
}

const cut = (line: string, [start, width]: readonly [number, number]) => line.slice(start, start + width).trim();

/** Parse one printed transaction line. Returns null for blank/heading/garbage lines. */
export function parseTransactionLine(raw: string, columns: Columns = DEFAULT_COLUMNS): IdentipassTransaction | null {
  const line = raw.replace(/[\f\r\x00-\x08\x0b-\x1f]/g, "").replace(/\t/g, " ");
  const dateMatch = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(line);
  if (!dateMatch) return null;

  let date = cut(line, columns.date);
  let time = cut(line, columns.time);
  let card = cut(line, columns.card);
  let holder = cut(line, columns.holder);
  let panel = cut(line, columns.panel);
  let point = cut(line, columns.point);
  let action = cut(line, columns.action);

  // If the columns don't line up (different tab stops), fall back to splitting on runs of spaces.
  if (!/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(date) || !/^\d{1,2}[:.]\d{2}/.test(time)) {
    const parts = line.trim().split(/\s{2,}/);
    if (parts.length < 6) return null;
    [date, time, card, holder, panel, point] = parts;
    action = parts.slice(6).join(" ");
  }

  const [m, d, yRaw] = date.split("/").map(Number);
  const y = yRaw < 100 ? 2000 + yRaw : yRaw;
  // IDentiPASS shows time as HH:MM.SS
  const t = /^(\d{1,2})[:.](\d{2})(?:[:.](\d{2}))?/.exec(time);
  if (!t) return null;
  const at = new Date(y, m - 1, d, Number(t[1]), Number(t[2]), Number(t[3] ?? 0));
  if (Number.isNaN(at.getTime())) return null;

  return { at, card, holder, panel, point: point.replace(/^\(\d+\)\s*/, ""), action };
}

export function classifyAction(action: string): { type: EventType; severity: Severity } {
  if (/granted/i.test(action)) return { type: "access.granted", severity: "info" };
  if (/forced/i.test(action)) return { type: "door.forced", severity: "critical" };
  if (/held|ajar|propped/i.test(action)) return { type: "door.held", severity: "warning" };
  if (/denied|fail|invalid|unknown|expired|void|not valid|lockout|time ?zone|anti.?pass/i.test(action)) return { type: "access.denied", severity: "warning" };
  if (/restor|secure|closed|normal/i.test(action)) return { type: "door.closed", severity: "info" };
  if (/open/i.test(action)) return { type: "door.opened", severity: "info" };
  return { type: "access.other", severity: "notice" };
}

export function toRawEvent(tx: IdentipassTransaction, rawLine: string): RawEvent {
  const { type, severity } = classifyAction(tx.action);
  // Unknown cards print the card number as the holder name.
  const hasPerson = !!tx.holder && !/^\d+$/.test(tx.holder);
  return {
    type,
    severity,
    at: tx.at.toISOString(),
    summary: `${tx.point}: ${tx.action}${tx.holder ? ` — ${tx.holder}` : ""}${tx.card ? ` (card ${tx.card})` : ""}`,
    externalDoorId: tx.point,
    person: tx.card ? { id: tx.card, name: hasPerson ? tx.holder : undefined } : undefined,
    raw: { line: rawLine, panel: tx.panel },
  };
}

export const identipassDriver: IntegrationDriver = {
  id: "identipass",
  label: "IDentiPASS",
  capabilities: ["access-events"],
  requiredSettings: [],
  create(ctx) {
    const port = Number(ctx.settings.listenPort ?? 9100) || 9100;
    const columns = parseColumns(ctx.settings.columns);
    // Door names as placed on the map for this integration; the printer may cut names short.
    const pointNames = [...ctx.graph.doors.values()].filter((d) => d.source?.integration === ctx.config.id).map((d) => d.source!.externalId);
    const fullPointName = (printed: string) => {
      if (pointNames.includes(printed)) return printed;
      const matches = pointNames.filter((n) => n.toLowerCase().startsWith(printed.toLowerCase()));
      return matches.length === 1 ? matches[0] : printed;
    };
    let server: Server | undefined;
    let lastLineAt: string | undefined;
    let count = 0;

    function ingestText(text: string) {
      let n = 0;
      for (const line of text.split(/\r?\n|\r/)) {
        const tx = parseTransactionLine(line, columns);
        if (!tx) continue;
        tx.point = fullPointName(tx.point);
        ctx.emit(toRawEvent(tx, line));
        n++;
      }
      if (n) {
        count += n;
        lastLineAt = new Date().toISOString();
        ctx.setHealth("ok", `Receiving events · ${count} since start · last ${new Date(lastLineAt).toLocaleTimeString()}`);
      }
      return n;
    }

    return {
      async start() {
        server = createServer((socket) => {
          let buffer = "";
          socket.setEncoding("latin1");
          socket.on("data", (chunk: string) => {
            buffer += chunk;
            const lastBreak = Math.max(buffer.lastIndexOf("\n"), buffer.lastIndexOf("\r"), buffer.lastIndexOf("\f"));
            if (lastBreak >= 0) {
              ingestText(buffer.slice(0, lastBreak + 1));
              buffer = buffer.slice(lastBreak + 1);
            }
          });
          socket.on("end", () => buffer && ingestText(buffer));
          socket.on("error", () => {});
        });
        await new Promise<void>((resolve) => {
          server!.once("error", (err) => {
            ctx.setHealth("offline", `Can't listen on port ${port}: ${(err as Error).message}`);
            resolve();
          });
          server!.listen(port, () => {
            ctx.setHealth("connecting", `Listening for the IDentiPASS transaction printer on port ${port} — no events yet`);
            resolve();
          });
        });
      },
      async stop() {
        await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
      },
      async handleWebhook(request) {
        const n = ingestText(await request.text());
        return Response.json({ ok: true, events: n });
      },
    };
  },
};
