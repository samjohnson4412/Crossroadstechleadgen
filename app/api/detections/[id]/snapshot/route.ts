import { getRuntime } from "@/lib/core/runtime";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const runtime = await getRuntime();
  const img = await runtime.detectionSnapshot((await params).id);
  if (!img) return new Response("No snapshot", { status: 404 });
  return new Response(new Uint8Array(img), { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" } });
}
