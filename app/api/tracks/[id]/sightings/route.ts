import { route } from "@/lib/api";

/** Operator says "I see them here" on a camera, door, or area. */
export const POST = route<{ id: string }>(async ({ runtime, request, params, operator }) => {
  const loc = (await request.json()) as { cameraId?: string; doorId?: string; zoneId?: string };
  const sighting = runtime.tracker.addSighting(params.id, loc, "operator", operator.name);
  runtime.trackChanged(params.id);
  return sighting;
});
