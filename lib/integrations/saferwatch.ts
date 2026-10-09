import type { IntegrationDriver } from "./types.ts";

/**
 * SaferWatch (panic / emergency alerting).
 *
 * SaferWatch's partner API isn't public, so this driver is built around the two
 * things we can count on and will be filled in once CCC's SaferWatch account
 * details are in hand:
 *   - Inbound:  SaferWatch (or a relay) POSTs alerts to /api/integrations/<id>/webhook
 *               with header `x-sentinel-secret: <webhookSecret>`. The body is mapped
 *               leniently: {title|type, message|description, location, active}.
 *   - Outbound: if `outboundUrl` is set, console-raised alerts are POSTed there as JSON.
 *
 * Settings: webhookSecret (required), outboundUrl, outboundToken.
 */
export const saferWatchDriver: IntegrationDriver = {
  id: "saferwatch",
  label: "SaferWatch",
  capabilities: ["alerts"],
  requiredSettings: ["webhookSecret"],
  create(ctx) {
    const secret = String(ctx.settings.webhookSecret);
    const outboundUrl = ctx.settings.outboundUrl ? String(ctx.settings.outboundUrl) : undefined;
    const outboundToken = ctx.settings.outboundToken ? String(ctx.settings.outboundToken) : undefined;

    return {
      async start() {
        ctx.setHealth("ok", outboundUrl ? "Receiving + sending alerts" : "Receiving alerts (no outbound URL)");
      },
      async stop() {},
      alerts: outboundUrl
        ? {
            async raiseAlert(alert, actor) {
              const res = await fetch(outboundUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json", ...(outboundToken ? { Authorization: `Bearer ${outboundToken}` } : {}) },
                body: JSON.stringify({ ...alert, raisedBy: actor.name, at: new Date().toISOString() }),
              });
              if (!res.ok) throw new Error(`SaferWatch outbound HTTP ${res.status}`);
            },
          }
        : {},
      async handleWebhook(request) {
        if (request.headers.get("x-sentinel-secret") !== secret) return Response.json({ error: "unauthorized" }, { status: 401 });
        const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
        const title = String(body.title ?? body.type ?? "SaferWatch alert");
        const detail = String(body.message ?? body.description ?? "");
        const cleared = body.active === false || /clear|cancel|resolved/i.test(String(body.status ?? ""));
        ctx.emit({
          type: cleared ? "alert.cleared" : "alert.raised",
          severity: cleared ? "notice" : "critical",
          summary: `${title}${detail ? ` — ${detail}` : ""}${body.location ? ` @ ${body.location}` : ""}`,
          raw: body,
        });
        return Response.json({ ok: true });
      },
    };
  },
};
