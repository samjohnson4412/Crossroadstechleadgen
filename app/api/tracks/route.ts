import { route } from "@/lib/api";
import type { Appearance } from "@/lib/core/events";

export const POST = route(async ({ runtime, request, operator }) => {
  const body = (await request.json()) as { label?: string; description?: string; appearance?: Appearance; credentialIds?: string[]; cameraId?: string; zoneId?: string };
  const track = runtime.tracker.create({ ...body, label: body.label?.trim() || "Person of interest", by: operator.name });
  runtime.trackChanged(track.id);
  return track;
});
