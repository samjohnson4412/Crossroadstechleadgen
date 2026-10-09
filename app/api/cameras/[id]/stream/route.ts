import { getRuntime } from "@/lib/core/runtime";

export const dynamic = "force-dynamic";

/** Proxies the vendor's MJPEG stream so camera credentials stay on the server. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const runtime = await getRuntime();
  try {
    return await runtime.proxyStream((await params).id, request.signal);
  } catch (err) {
    return new Response((err as Error).message, { status: 502 });
  }
}
