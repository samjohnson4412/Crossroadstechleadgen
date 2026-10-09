import { route } from "@/lib/api";
import type { SiteLayout } from "@/lib/core/overrides";

export const dynamic = "force-dynamic";

/** Save the whole map as drawn in the editor. */
export const PUT = route(async ({ runtime, request, operator }) => {
  const layout = (await request.json()) as SiteLayout;
  if (!Array.isArray(layout?.buildings) || !Array.isArray(layout?.passages)) throw new Error("buildings and passages are required");
  await runtime.saveLayout(layout, operator);
});
