import { getRuntime } from "@/lib/core/runtime";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const runtime = await getRuntime();
  const cam = runtime.graph.cameras.get((await params).id);
  const cams = cam && runtime.integrations.get(cam.source.integration)?.instance.cameras;
  if (!cam || !cams?.snapshot) return new Response("No snapshot", { status: 404 });
  try {
    return await cams.snapshot(cam.source.externalId);
  } catch (err) {
    return new Response((err as Error).message, { status: 502 });
  }
}
