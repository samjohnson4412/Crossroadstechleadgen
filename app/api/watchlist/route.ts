import { route } from "@/lib/api";
import type { WatchEntry } from "@/lib/core/watchlist";

export const dynamic = "force-dynamic";

export const GET = route(async ({ runtime }) => runtime.watchlist);

/** Replace the watch list: {entries: [{cardId, name?, reason}]} */
export const PUT = route(async ({ runtime, request, operator }) => {
  const { entries } = (await request.json()) as { entries: WatchEntry[] };
  if (!Array.isArray(entries)) throw new Error("entries are required");
  return runtime.setWatchlist(entries, operator);
});
