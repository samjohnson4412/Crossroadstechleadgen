import { route } from "@/lib/api";

export const POST = route<{ id: string }>(async ({ runtime, request, params, operator }) => {
  const { text } = (await request.json()) as { text: string };
  return runtime.addIncidentNote(params.id, String(text ?? ""), operator);
});
