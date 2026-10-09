import { request as httpsRequest } from "node:https";
import type { DoorStatus, IntegrationDriver } from "./types.ts";

/**
 * UniFi Access (door control) via the UniFi Access Developer API.
 *
 * Settings:
 *   host         controller address, e.g. 10.0.0.5 (API listens on :12445)
 *   token        API token from UniFi Access → Settings → General → Advanced → API Token
 *   insecureTls  true to accept the controller's self-signed certificate (typical on-prem)
 *
 * Door state is polled every few seconds. UniFi Access can also push webhooks
 * (access.door.unlock, access.device.dps_status, ...); point them at
 * /api/integrations/<id>/webhook and they're turned into events immediately.
 */

interface UnifiDoor {
  id: string;
  name: string;
  full_name?: string;
  door_lock_relay_status?: "lock" | "unlock";
  door_position_status?: "open" | "close" | null;
}

export const unifiAccessDriver: IntegrationDriver = {
  id: "unifi-access",
  label: "UniFi Access",
  capabilities: ["access-control"],
  requiredSettings: ["host", "token"],
  create(ctx) {
    const host = String(ctx.settings.host);
    const token = String(ctx.settings.token);
    const insecure = ctx.settings.insecureTls === true || ctx.settings.insecureTls === "true";
    const modes = new Map<string, DoorStatus["mode"]>();
    const last = new Map<string, string>();
    let timer: ReturnType<typeof setInterval> | undefined;

    function api<T>(method: string, path: string, body?: unknown): Promise<T> {
      return new Promise((resolve, reject) => {
        const payload = body === undefined ? undefined : JSON.stringify(body);
        const req = httpsRequest(
          {
            host,
            port: 12445,
            method,
            path: `/api/v1/developer${path}`,
            rejectUnauthorized: !insecure,
            timeout: 8000,
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
              ...(payload ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } : {}),
            },
          },
          (res) => {
            let data = "";
            res.on("data", (chunk) => (data += chunk));
            res.on("end", () => {
              try {
                const json = JSON.parse(data || "{}");
                if (res.statusCode && res.statusCode >= 400) return reject(new Error(`UniFi Access HTTP ${res.statusCode}: ${json.msg ?? data}`));
                if (json.code && json.code !== "SUCCESS") return reject(new Error(`UniFi Access: ${json.msg ?? json.code}`));
                resolve(json.data as T);
              } catch (err) {
                reject(err);
              }
            });
          },
        );
        req.on("timeout", () => req.destroy(new Error("UniFi Access request timed out")));
        req.on("error", reject);
        if (payload) req.write(payload);
        req.end();
      });
    }

    function toStatus(d: UnifiDoor): DoorStatus {
      return {
        lock: d.door_lock_relay_status === "lock" ? "locked" : d.door_lock_relay_status === "unlock" ? "unlocked" : "unknown",
        position: d.door_position_status === "open" ? "open" : d.door_position_status === "close" ? "closed" : "unknown",
        mode: modes.get(d.id) ?? "normal",
        updatedAt: new Date().toISOString(),
      };
    }

    async function poll() {
      try {
        const doors = await api<UnifiDoor[]>("GET", "/doors");
        for (const d of doors) {
          const status = toStatus(d);
          const key = `${status.lock}/${status.position}/${status.mode}`;
          if (last.get(d.id) !== key) {
            const prev = last.get(d.id);
            last.set(d.id, key);
            ctx.doorChanged(d.id, status);
            if (prev && prev.split("/")[1] !== status.position && status.position !== "unknown") {
              ctx.emit({
                type: status.position === "open" ? "door.opened" : "door.closed",
                severity: "info",
                summary: `${d.name} ${status.position}`,
                externalDoorId: d.id,
              });
            }
          }
        }
        ctx.setHealth("ok");
      } catch (err) {
        ctx.setHealth("offline", (err as Error).message);
      }
    }

    async function lockRule(id: string, type: string, mode: DoorStatus["mode"]) {
      await api("PUT", `/doors/${id}/lock_rule`, { type });
      modes.set(id, mode);
      await poll();
    }

    return {
      async start() {
        await poll();
        timer = setInterval(poll, 3000);
      },
      async stop() {
        clearInterval(timer);
      },
      access: {
        async listDoors() {
          const doors = await api<UnifiDoor[]>("GET", "/doors");
          return doors.map((d) => ({ externalId: d.id, name: d.full_name ?? d.name }));
        },
        async doorStatus(id) {
          return toStatus(await api<UnifiDoor>("GET", `/doors/${id}`));
        },
        async unlock(id, actor) {
          await api("PUT", `/doors/${id}/unlock`, { actor_id: "campus-sentinel", actor_name: actor.name });
          await poll();
        },
        holdUnlocked: (id) => lockRule(id, "keep_unlock", "held-unlocked"),
        holdLocked: (id) => lockRule(id, "keep_lock", "held-locked"),
        reset: (id) => lockRule(id, "reset", "normal"),
        async setLockdown(active) {
          await api("PUT", "/doors/settings/emergency", { lockdown: active, evacuation: false });
          await poll();
        },
      },
      async handleWebhook(request) {
        // Payload shape varies by Access version; keep it loose and keep the raw body.
        const body = (await request.json().catch(() => ({}))) as {
          event?: string;
          data?: { location?: { id?: string; name?: string }; actor?: { id?: string; display_name?: string }; object?: { result?: string } };
        };
        const event = body.event ?? "";
        const doorId = body.data?.location?.id;
        const actor = body.data?.actor;
        const person = actor?.id ? { id: actor.id, name: actor.display_name } : undefined;
        if (event.includes("door.unlock") || event.includes("access")) {
          const denied = /block|denied|fail/i.test(body.data?.object?.result ?? "");
          ctx.emit({
            type: denied ? "access.denied" : "access.granted",
            severity: denied ? "warning" : "info",
            summary: `${denied ? "Access denied" : "Access granted"}${person?.name ? ` — ${person.name}` : ""}`,
            externalDoorId: doorId,
            person,
            raw: body,
          });
        }
        await poll();
        return Response.json({ ok: true });
      },
    };
  },
};
