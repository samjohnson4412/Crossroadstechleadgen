import { route } from "@/lib/api";

/** Remove the latest sighting (wrong camera) — the track goes back to the one before. */
export const POST = route<{ id: string }>(async ({ runtime, params }) => {
  const removed = runtime.tracker.undoLastSighting(params.id);
  runtime.trackChanged(params.id);
  return { removed };
});
