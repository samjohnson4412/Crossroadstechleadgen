import { route } from "@/lib/api";

/** Acknowledge a watch-list hit (clears its banner). */
export const POST = route<{ id: string }>(async ({ runtime, params, operator }) => runtime.acknowledgeWatchHit(params.id, operator));
