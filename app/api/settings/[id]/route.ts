import { route } from "@/lib/api";

/** Save one integration's settings: {values: {key: "value" | "" (clear)}} — then reconnects. */
export const PUT = route<{ id: string }>(async ({ runtime, request, params, operator }) => {
  const { values } = (await request.json()) as { values: Record<string, string> };
  if (!values || typeof values !== "object") throw new Error("values are required");
  await runtime.saveIntegrationSettings(params.id, values, operator);
});
