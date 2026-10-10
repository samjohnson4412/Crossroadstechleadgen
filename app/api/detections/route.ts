import { route } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Recent AI detections (newest last). */
export const GET = route(async ({ runtime }) => runtime.detections);
