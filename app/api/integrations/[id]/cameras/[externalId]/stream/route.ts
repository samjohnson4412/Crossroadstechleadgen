import { getRuntime } from "@/lib/core/runtime";

export const dynamic = "force-dynamic";

/** Live stream of any vendor camera, including ones not placed on the map yet. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string; externalId: string }> }) {
  const { id, externalId } = await params;
  const runtime = await getRuntime();
  const cams = runtime.integrations.get(id)?.instance.cameras;
  if (!cams?.proxyStream) return new Response("This camera system has no live stream to show", { status: 404 });
  try {
    return await cams.proxyStream(decodeURIComponent(externalId), request.signal);
  } catch (err) {
    return new Response((err as Error).message, { status: 502 });
  }
}
