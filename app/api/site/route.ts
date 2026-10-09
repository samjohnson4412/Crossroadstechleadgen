import { toPublicSite } from "@/lib/core/site";
import { route } from "@/lib/api";

export const dynamic = "force-dynamic";
export const GET = route(async ({ runtime }) => toPublicSite(runtime.site));
