import { route } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Troubleshooting: GET /api/integrations/cameras/check */
export const GET = route<{ id: string }>(async ({ runtime, params }) => runtime.checkIntegration(params.id));
