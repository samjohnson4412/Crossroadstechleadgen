import { route } from "@/lib/api";

export const POST = route(async ({ runtime, request, operator }) => {
  const body = (await request.json()) as { title?: string; detail?: string; zoneId?: string };
  if (!body.title?.trim()) throw new Error("title is required");
  await runtime.raiseAlert({ title: body.title.trim(), detail: body.detail ?? "", zoneId: body.zoneId }, operator);
});
