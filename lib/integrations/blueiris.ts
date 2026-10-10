import { createHash } from "node:crypto";
import { parseLabels } from "../core/detections.ts";
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
        signal: AbortSignal.timeout(8000),
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

    const basic = `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

    /** Blue Iris versions/settings differ in which auth they accept for video; try session first, then user/password. */
    async function fetchAuthed(path: string, signal?: AbortSignal) {
      if (!session) await login();
      const sep = path.includes("?") ? "&" : "?";
      let res = await fetch(`${base}${path}${sep}session=${session}`, { signal, headers: { Cookie: `session=${session}` } });
      if (res.status === 401 || res.status === 403) {
        await login();
        res = await fetch(`${base}${path}${sep}session=${session}`, { signal, headers: { Cookie: `session=${session}` } });
      }
      if (!res.ok) {
        res.body?.cancel().catch(() => {});
        res = await fetch(`${base}${path}${sep}user=${encodeURIComponent(user)}&pw=${encodeURIComponent(password)}`, { signal, headers: { Authorization: basic } });
      }
      return res;
    }

    async function proxy(paths: string[], signal?: AbortSignal) {
      let res: Response | undefined;
      let detail = "";
      for (const path of paths) {
        res = await fetchAuthed(path, signal);
        if (res.ok) break;
        detail = (await res.text().catch(() => "")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
        ctx.log(`${path} → HTTP ${res.status}${detail ? `: ${detail}` : ""}`);
      }
      if (!res!.ok) return new Response(`Blue Iris HTTP ${res!.status}${detail ? `: ${detail}` : ""}`, { status: 502 });
      return new Response(res!.body, {
        status: res!.status,
        headers: { "Content-Type": res!.headers.get("Content-Type") ?? "application/octet-stream", "Cache-Control": "no-store" },
      });
    }

    /** Step-by-step connection check, shown at /api/integrations/<id>/check. */
    async function diagnose() {
      const out: Record<string, unknown> = { url: base, user };
      try {
        session = null;
        await login();
        out.login = "ok";
      } catch (err) {
        out.login = (err as Error).message;
        return out;
      }
      const list = await authed({ cmd: "camlist" }).catch((e) => ({ result: String(e), data: [] }));
      const cams = ((list.data ?? []) as { optionValue: string; group?: unknown }[]).filter((c) => !c.optionValue.startsWith("@") && c.optionValue !== "Index" && !c.group);
      out.cameras = cams.length;
      const first = cams[0]?.optionValue;
      if (!first) return out;
      out.testCamera = first;
      for (const [label, path] of [
        ["snapshot", `/image/${encodeURIComponent(first)}`],
        ["mjpeg", `/mjpg/${encodeURIComponent(first)}/video.mjpg`],
        ["mjpeg (short path)", `/mjpg/${encodeURIComponent(first)}`],
      ]) {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 5000);
        try {
          const res = await fetchAuthed(path, ctrl.signal);
          out[label] = res.ok ? `ok (${res.headers.get("Content-Type")})` : `HTTP ${res.status}: ${(await res.text()).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200)}`;
        } catch (err) {
          out[label] = (err as Error).message;
        } finally {
          clearTimeout(timer);
          ctrl.abort();
        }
      }
      return out;
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
          const id = encodeURIComponent(externalId);
          return proxy([`/mjpg/${id}/video.mjpg`, `/mjpg/${id}`], signal);
        },
        snapshot(externalId, width) {
          const scale = width ? `?w=${Math.round(width)}&q=70` : "";
          return proxy([`/image/${encodeURIComponent(externalId)}${scale}`]);
        },
      },
      diagnose,
      async handleWebhook(request) {
        const body = (await request.json().catch(() => ({}))) as { camera?: string; memo?: string; type?: string };
        if (!body.camera) return Response.json({ error: "camera required" }, { status: 400 });
        const memo = body.memo ?? "";
        const labels = parseLabels(memo);
        const isPerson = labels.some((l) => l.label === "person");
        ctx.emit({
          type: isPerson ? "person.detected" : labels.length ? "object.detected" : "motion.detected",
          severity: "info",
          summary: labels.length ? `Detected ${labels.map((l) => `${l.label}${l.confidence !== undefined ? ` ${Math.round(l.confidence)}%` : ""}`).join(", ")}` : `Motion${memo ? ` (${memo})` : ""}`,
          externalCameraId: body.camera,
          labels,
          raw: body,
        });
        return Response.json({ ok: true });
      },
    };
  },
};
