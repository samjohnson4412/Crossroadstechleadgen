import { getRuntime } from "@/lib/core/runtime";

export const dynamic = "force-dynamic";

/** Still image of any vendor camera, including ones not placed on the map yet. ?w= sets the width. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; externalId: string }> }) {
  const { id, externalId } = await params;
  const runtime = await getRuntime();
  const cams = runtime.integrations.get(id)?.instance.cameras;
  if (!cams?.snapshot) return new Response("This camera system has no snapshots", { status: 404 });
  const w = Number(new URL(request.url).searchParams.get("w")) || undefined;
  try {
    return await cams.snapshot(decodeURIComponent(externalId), w);
  } catch (err) {
    return new Response((err as Error).message, { status: 502 });
  }
}
