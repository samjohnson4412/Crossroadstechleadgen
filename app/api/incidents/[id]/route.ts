import { route } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Everything for the incident report. */
export const GET = route<{ id: string }>(async ({ runtime, params }) => runtime.incidentReport(params.id));
