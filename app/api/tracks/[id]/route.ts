import { route } from "@/lib/api";
import type { Track } from "@/lib/tracking/tracker";

export const PATCH = route<{ id: string }>(async ({ runtime, request, params }) => {
  const body = (await request.json()) as Partial<Pick<Track, "label" | "description" | "appearance" | "credentialIds" | "status" | "lostAt">>;
  const { label, description, appearance, credentialIds, status, lostAt } = body;
  const patch = Object.fromEntries(Object.entries({ label, description, appearance, credentialIds, status, lostAt }).filter(([, v]) => v !== undefined));
  const track = runtime.tracker.update(params.id, patch);
  runtime.trackChanged(track.id);
  return track;
});
