import { getRuntime } from "@/lib/core/runtime";

export const dynamic = "force-dynamic";

/** A still image for a map camera. ?w=480 asks the camera server for a smaller image (camera tiles). */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const runtime = await getRuntime();
  const w = Number(new URL(request.url).searchParams.get("w")) || undefined;
  try {
    return await runtime.cameraSnapshot((await params).id, w && Math.min(w, 1920));
  } catch (err) {
    return new Response((err as Error).message, { status: 502 });
  }
}
