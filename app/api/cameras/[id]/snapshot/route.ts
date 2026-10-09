import { getRuntime } from "@/lib/core/runtime";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const runtime = await getRuntime();
  try {
    return await runtime.cameraSnapshot((await params).id);
  } catch (err) {
    return new Response((err as Error).message, { status: 502 });
  }
}
