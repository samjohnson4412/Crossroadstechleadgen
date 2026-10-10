import { route } from "@/lib/api";
import type { DetectionRule } from "@/lib/core/detections";

export const dynamic = "force-dynamic";

export const GET = route(async ({ runtime }) => runtime.rules);

export const PUT = route(async ({ runtime, request, operator }) => {
  const { rules } = (await request.json()) as { rules: DetectionRule[] };
  if (!Array.isArray(rules)) throw new Error("rules are required");
  await runtime.saveRules(rules, operator);
  return runtime.rules;
});
