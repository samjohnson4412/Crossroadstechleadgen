import { route } from "@/lib/api";

export const dynamic = "force-dynamic";

/** What the vendor system reports, so devices can be matched to the floor plan. */
export const GET = route<{ id: string }>(async ({ runtime, params }) => runtime.listVendorDevices(params.id));
