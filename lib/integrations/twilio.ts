import type { IntegrationDriver } from "./types.ts";

/**
 * Twilio SMS — text messages to staff phones.
 *
 * Settings: accountSid, authToken (Twilio console → Account info), from (your Twilio number, +1…).
 * Who receives what is set on the Settings page under "Text-message contacts".
 */
export const twilioDriver: IntegrationDriver = {
  id: "twilio",
  label: "Twilio SMS",
  capabilities: ["sms"],
  requiredSettings: ["accountSid", "authToken", "from"],
  create(ctx) {
    const sid = String(ctx.settings.accountSid);
    const auth = `Basic ${Buffer.from(`${sid}:${ctx.settings.authToken}`).toString("base64")}`;
    const from = String(ctx.settings.from);
    const base = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}`;

    async function check() {
      try {
        const res = await fetch(`${base}.json`, { headers: { Authorization: auth }, signal: AbortSignal.timeout(10_000) });
        if (!res.ok) throw new Error(`Twilio HTTP ${res.status}`);
        ctx.setHealth("ok");
      } catch (err) {
        ctx.setHealth("offline", (err as Error).message);
      }
    }

    return {
      async start() {
        await check();
      },
      async stop() {},
      sms: {
        async send(to, body) {
          const failures: string[] = [];
          let sent = 0;
          for (const number of to) {
            const res = await fetch(`${base}/Messages.json`, {
              method: "POST",
              headers: { Authorization: auth, "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({ To: number, From: from, Body: body.slice(0, 1500) }),
              signal: AbortSignal.timeout(15_000),
            }).catch((err: Error) => ({ ok: false, status: 0, json: async () => ({ message: err.message }) }) as const);
            if (res.ok) sent++;
            else failures.push(`${number}: ${((await res.json().catch(() => ({}))) as { message?: string }).message ?? `HTTP ${res.status}`}`);
          }
          if (failures.length && !sent) throw new Error(failures.join("; "));
          return { sent, failed: failures };
        },
      },
    };
  },
};
