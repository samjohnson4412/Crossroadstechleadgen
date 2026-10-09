import { route } from "@/lib/api";
import type { DisplayMessage } from "@/lib/integrations/types";

export const POST = route(async ({ runtime, request, operator }) => {
  const body = (await request.json()) as DisplayMessage & { displayIds?: string[] };
  if (!body.title?.trim()) throw new Error("title is required");
  const level = (["info", "warning", "emergency"] as const).includes(body.level) ? body.level : "info";
  await runtime.sendMessage({ title: body.title.trim(), body: body.body ?? "", level }, body.displayIds ?? [], operator);
});
