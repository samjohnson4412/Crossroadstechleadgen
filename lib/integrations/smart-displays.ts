import type { IntegrationDriver } from "./types.ts";

/**
 * SMART Boards via SMART Remote Management (smart.glbth.com — Radix "Viso" MDM).
 *
 * Auth: an API key made in SMART Remote Management (Settings → API keys), sent as
 * the `X-API-Key` header. Messages are the portal's "Send message" command
 * (CommandPopupMessage) sent to the boards' hardware ids.
 *
 * Settings: apiKey (required), url (default https://smart.glbth.com).
 */

interface ViSoResponse<T = unknown> {
  result?: string;
  message?: string;
  data?: T & { error?: string };
}
interface ViSoDevice {
  hardwareId?: string;
  id?: string;
  deviceName?: string;
  name?: string;
  online?: boolean;
  isOnline?: boolean;
  connected?: boolean;
}

export const smartDisplaysDriver: IntegrationDriver = {
  id: "smart-displays",
  label: "SMART Remote Management",
  capabilities: ["messaging"],
  requiredSettings: ["apiKey"],
  create(ctx) {
    const base = String(ctx.settings.url || "https://smart.glbth.com").replace(/\/+$/, "");
    const apiKey = String(ctx.settings.apiKey);
    let timer: ReturnType<typeof setInterval> | undefined;

    async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
      const res = await fetch(base + path, {
        method: init.method ?? (init.body ? "POST" : "GET"),
        headers: { "X-API-Key": apiKey, Accept: "application/json", ...(init.body ? { "Content-Type": "application/json; charset=UTF-8" } : {}) },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: AbortSignal.timeout(15_000),
      });
      const text = await res.text();
      let json: (ViSoResponse & T) | undefined;
      try {
        json = JSON.parse(text);
      } catch {
        /* not JSON */
      }
      if (res.status === 401 || json?.data?.error === "BAD_API_KEY") throw new Error("SMART rejected the API key (check it, and that it hasn't expired)");
      if (!res.ok) throw new Error(`SMART HTTP ${res.status}${json?.message ? `: ${json.message}` : ""}`);
      if (json?.result === "FAILURE") throw new Error(`SMART: ${json.message ?? json.data?.error ?? "request failed"}`);
      return (json ?? {}) as T;
    }

    async function listDisplays() {
      const out: { externalId: string; name: string; online?: boolean }[] = [];
      const size = 200;
      for (let start = 0; start < 5000; start += size) {
        const page = await call<{ Records?: ViSoDevice[]; TotalRecordCount?: number }>(
          `/rest/manager/getalldevices?jtStartIndex=${start}&jtPageSize=${size}&extended=false&calldbyuser=false`,
        );
        for (const d of page.Records ?? []) {
          const id = d.hardwareId ?? d.id;
          if (!id) continue;
          const online = d.online ?? d.isOnline ?? d.connected;
          out.push({ externalId: id, name: d.deviceName || d.name || id, ...(typeof online === "boolean" ? { online } : {}) });
        }
        if (!page.Records?.length || page.Records.length < size || out.length >= (page.TotalRecordCount ?? Infinity)) break;
      }
      return out;
    }

    async function check() {
      try {
        const boards = await listDisplays();
        ctx.setHealth("ok", `${boards.length} board${boards.length === 1 ? "" : "s"} in SMART Remote Management`);
      } catch (err) {
        ctx.setHealth("offline", (err as Error).message);
      }
    }

    async function popup(title: string, message: string, ids: string[]) {
      const deviceIds = ids.length ? ids : (await listDisplays()).map((d) => d.externalId);
      if (!deviceIds.length) throw new Error("No boards found in SMART Remote Management");
      await call("/rest/command/send/sendcommanddatatomany/", {
        body: { commandData: { "@class": "com.viso.entities.commands.CommandPopupMessage", title, message }, deviceIds },
      });
    }

    return {
      async start() {
        ctx.setHealth("connecting");
        await check();
        timer = setInterval(check, 5 * 60_000);
      },
      async stop() {
        if (timer) clearInterval(timer);
      },
      messaging: {
        listDisplays,
        send: (message, ids) => popup(message.title, message.body, ids),
        clear: (ids) => popup("All clear", "The alert has ended.", ids),
      },
      async diagnose() {
        const out: Record<string, unknown> = { server: base };
        try {
          const boards = await listDisplays();
          out.apiKey = "ok";
          out.boards = boards.length;
          out.examples = boards.slice(0, 5).map((b) => b.name).join(", ") || "—";
        } catch (err) {
          out.apiKey = `error: ${(err as Error).message}`;
        }
        return out;
      },
    };
  },
};
