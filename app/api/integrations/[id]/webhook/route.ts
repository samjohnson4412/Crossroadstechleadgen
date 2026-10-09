import { getRuntime } from "@/lib/core/runtime";

export const dynamic = "force-dynamic";

/** Inbound vendor webhooks (Blue Iris alerts, UniFi Access events, SaferWatch alerts, ...). */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const runtime = await getRuntime();
  try {
    return await runtime.webhook((await params).id, request);
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 400 });
  }
}
