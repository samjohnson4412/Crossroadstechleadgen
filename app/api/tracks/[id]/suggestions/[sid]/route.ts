import { route } from "@/lib/api";

export const POST = route<{ id: string; sid: string }>(async ({ runtime, request, params, operator }) => {
  const { action } = (await request.json()) as { action: "confirm" | "reject" };
  if (action === "confirm") runtime.tracker.confirmSuggestion(params.id, params.sid, operator.name);
  else runtime.tracker.rejectSuggestion(params.id, params.sid);
  runtime.trackChanged(params.id);
});
