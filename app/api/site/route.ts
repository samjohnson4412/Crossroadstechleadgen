import { toPublicSite } from "@/lib/core/site";
import { route } from "@/lib/api";
import type { NamedKind } from "@/lib/core/overrides";

export const dynamic = "force-dynamic";
export const GET = route(async ({ runtime }) => toPublicSite(runtime.site));

const KINDS: NamedKind[] = ["zone", "camera", "door", "display"];

/** Rename something on the map: {kind: "zone", id: "e-101", name: "Mrs. Smith's Room"} */
export const PATCH = route(async ({ runtime, request, operator }) => {
  const { kind, id, name } = (await request.json()) as { kind: NamedKind; id: string; name: string };
  if (!KINDS.includes(kind)) throw new Error(`kind must be one of ${KINDS.join(", ")}`);
  await runtime.rename(kind, id, String(name ?? ""), operator);
});
