import type { IntegrationDriver } from "./types.ts";

/**
 * Algo IP paging adapters / speakers / strobes (e.g. Algo 8301 Paging Adapter, which
 * feeds the phone system's overhead paging), via the Algo device REST API.
 *
 * Settings:
 *   host            device IP
 *   password        admin password (user defaults to "admin")
 *   user            optional, default "admin"
 *   toneEmergency   audio file on the device to play for emergency alerts (default "emergency.wav")
 *   toneWarning     … for warnings (default "warning.wav")
 *   toneInfo        … for announcements (default "chime.wav")
 *   tts             "true" to also speak the alert text (device must support text-to-speech)
 *   zones           optional: comma-separated area ids this device covers; when set, it only sounds
 *                   for alerts aimed at those areas (or campus-wide alerts)
 *
 * In the device web UI: Advanced Settings → Admin → enable "RESTful API" with Basic authentication.
 * Upload the tone files under System → File Manager. Endpoint paths can vary by firmware; the
 * driver reports the device's own error text if a call is rejected.
 */
export const algoDriver: IntegrationDriver = {
  id: "algo",
  label: "Algo paging",
  capabilities: ["paging"],
  requiredSettings: ["host", "password"],
  create(ctx) {
    const base = `http://${String(ctx.settings.host).replace(/^https?:\/\//, "").replace(/\/$/, "")}`;
    const auth = `Basic ${Buffer.from(`${ctx.settings.user ?? "admin"}:${ctx.settings.password}`).toString("base64")}`;
    const coverage = String(ctx.settings.zones ?? "")
      .split(",")
      .map((z) => z.trim())
      .filter(Boolean);
    const tone = (level: string) =>
      String((level === "emergency" ? ctx.settings.toneEmergency : level === "warning" ? ctx.settings.toneWarning : ctx.settings.toneInfo) ?? `${level === "info" ? "chime" : level}.wav`);

    async function call(path: string, body?: unknown) {
      const res = await fetch(`${base}/api${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: { Authorization: auth, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`Algo HTTP ${res.status}: ${text.slice(0, 160)}`);
      return text;
    }

    async function health() {
      try {
        await call("/info/about");
        ctx.setHealth("ok");
      } catch (err) {
        ctx.setHealth("offline", (err as Error).message);
      }
    }
    let timer: ReturnType<typeof setInterval> | undefined;

    return {
      async start() {
        await health();
        timer = setInterval(health, 120_000);
      },
      async stop() {
        clearInterval(timer);
      },
      paging: {
        async announce(a) {
          if (coverage.length && a.zoneIds && !a.zoneIds.some((z) => coverage.includes(z))) return;
          await call("/controls/tone/start", { path: tone(a.level), loop: false });
          if (ctx.settings.tts === true || ctx.settings.tts === "true") {
            await call("/controls/speak/start", { text: `${a.title}. ${a.message}` });
          }
        },
        async stop() {
          await call("/controls/tone/stop", {});
        },
      },
    };
  },
};
