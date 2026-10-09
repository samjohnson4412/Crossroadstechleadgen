import { createHash } from "node:crypto";
import type { IntegrationDriver } from "./types.ts";

/**
 * Blue Iris (cameras) via its JSON API and MJPEG endpoints.
 *
 * Settings: url (e.g. http://10.0.0.20:81), user, password.
 *
 * Inbound alerts: in Blue Iris, add an alert action "Web request or MQTT" →
 *   POST {console}/api/integrations/<id>/webhook
 *   body: {"camera":"&CAM","memo":"&MEMO","type":"&TYPE"}
 * &MEMO carries AI labels such as "person:87%", which become person.detected events.
 */
export const blueIrisDriver: IntegrationDriver = {
  id: "blueiris",
  label: "Blue Iris",
  capabilities: ["cameras"],
  requiredSettings: ["url", "user", "password"],
  create(ctx) {
    const base = String(ctx.settings.url).replace(/\/$/, "");
    const user = String(ctx.settings.user);
    const password = String(ctx.settings.password);
    let session: string | null = null;
    let timer: ReturnType<typeof setInterval> | undefined;

    async function call(body: Record<string, unknown>) {
      const res = await fetch(`${base}/json`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`Blue Iris HTTP ${res.status}`);
      return (await res.json()) as { result: string; session?: string; data?: unknown };
    }

    async function login(): Promise<string> {
      // Challenge-response: first call returns a session, second proves the password.
      const first = await call({ cmd: "login" });
      const challenge = first.session!;
      const response = createHash("md5").update(`${user}:${challenge}:${password}`).digest("hex");
      const second = await call({ cmd: "login", session: challenge, response });
      if (second.result !== "success") throw new Error("Blue Iris login rejected");
      session = challenge;
      return challenge;
    }

    async function authed(body: Record<string, unknown>) {
      if (!session) await login();
      let out = await call({ ...body, session });
      if (out.result !== "success") {
        await login();
        out = await call({ ...body, session });
      }
      return out;
    }

    async function healthCheck() {
      try {
        await authed({ cmd: "status" });
        ctx.setHealth("ok");
      } catch (err) {
        session = null;
        ctx.setHealth("offline", (err as Error).message);
      }
    }

    async function proxy(path: string, signal?: AbortSignal) {
      if (!session) await login();
      let res = await fetch(`${base}${path}?session=${session}`, { signal });
      if (res.status === 401 || res.status === 403) {
        await login();
        res = await fetch(`${base}${path}?session=${session}`, { signal });
      }
      return new Response(res.body, {
        status: res.status,
        headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/octet-stream", "Cache-Control": "no-store" },
      });
    }

    return {
      async start() {
        await healthCheck();
        timer = setInterval(healthCheck, 60_000);
      },
      async stop() {
        clearInterval(timer);
      },
      cameras: {
        async listCameras() {
          const out = await authed({ cmd: "camlist" });
          const list = (out.data ?? []) as { optionValue: string; optionDisplay: string; isOnline?: boolean; group?: unknown }[];
          // camlist also returns groups ("Index", "@all"); real cameras don't start with "@"/"Index".
          return list
            .filter((c) => !c.optionValue.startsWith("@") && c.optionValue !== "Index" && !c.group)
            .map((c) => ({ externalId: c.optionValue, name: c.optionDisplay, online: c.isOnline !== false }));
        },
        streamInfo(_externalId, cameraId) {
          return { kind: "mjpeg", url: `/api/cameras/${cameraId}/stream` };
        },
        proxyStream(externalId, signal) {
          return proxy(`/mjpg/${encodeURIComponent(externalId)}/video.mjpg`, signal);
        },
        snapshot(externalId) {
          return proxy(`/image/${encodeURIComponent(externalId)}`);
        },
      },
      async handleWebhook(request) {
        const body = (await request.json().catch(() => ({}))) as { camera?: string; memo?: string; type?: string };
        if (!body.camera) return Response.json({ error: "camera required" }, { status: 400 });
        const memo = body.memo ?? "";
        const isPerson = /person/i.test(memo);
        ctx.emit({
          type: isPerson ? "person.detected" : "motion.detected",
          severity: "info",
          summary: isPerson ? `Person detected (${memo})` : `Motion${memo ? ` (${memo})` : ""}`,
          externalCameraId: body.camera,
          raw: body,
        });
        return Response.json({ ok: true });
      },
    };
  },
};
