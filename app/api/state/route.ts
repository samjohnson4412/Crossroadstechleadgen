import { authConfigured, route } from "@/lib/api";

export const dynamic = "force-dynamic";
export const GET = route(async ({ runtime }) => runtime.snapshot(authConfigured()));
