import type { IntegrationDriver } from "./types.ts";

/**
 * SMART Technologies interactive displays (classroom SMART Boards).
 *
 * Pushing a message onto a SMART Board goes through SMART's management tooling
 * (e.g. SMART Remote Management broadcast messages), whose API access depends on
 * CCC's licensing. Until that's confirmed this driver sends a plain JSON POST to
 * `sendUrl` — which can be SMART's endpoint once known, or a small relay — so the
 * console workflow (pick rooms → send → audit) is real today.
 *
 * Settings: sendUrl (required), token.
 * Body sent: {title, body, level, displays: [externalIds] (empty = all), sentBy}
 */
export const smartDisplaysDriver: IntegrationDriver = {
  id: "smart-displays",
  label: "SMART Boards",
  capabilities: ["messaging"],
  requiredSettings: ["sendUrl"],
  create(ctx) {
    const sendUrl = String(ctx.settings.sendUrl);
    const token = ctx.settings.token ? String(ctx.settings.token) : undefined;

    async function post(payload: unknown) {
      const res = await fetch(sendUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`SMART send HTTP ${res.status}`);
    }

    return {
      async start() {
        ctx.setHealth("ok");
      },
      async stop() {},
      messaging: {
        send: (message, displays, actor) => post({ ...message, displays, sentBy: actor.name }),
        clear: (displays, actor) => post({ clear: true, displays, sentBy: actor.name }),
      },
    };
  },
};
