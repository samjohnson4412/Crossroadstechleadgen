import { route } from "@/lib/api";
import type { AlertSpec } from "@/lib/core/alerts";

/** Send an alert: {presetId, level, title, message, zoneIds|null, scopeLabel, channels[]} */
export const POST = route(async ({ runtime, request, operator }) => {
  const spec = (await request.json()) as AlertSpec;
  return runtime.sendAlert(spec, operator);
});
