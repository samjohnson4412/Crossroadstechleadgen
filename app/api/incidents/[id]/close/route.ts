import { route } from "@/lib/api";

export const POST = route<{ id: string }>(async ({ runtime, request, params, operator }) => {
  const { summary } = (await request.json().catch(() => ({}))) as { summary?: string };
  return runtime.closeIncident(params.id, String(summary ?? ""), operator);
});
