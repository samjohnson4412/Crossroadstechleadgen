import { route } from "@/lib/api";

export const dynamic = "force-dynamic";

/** All integrations' settings for the Settings page (secrets reported only as set / not set). */
export const GET = route(async ({ runtime }) => runtime.settingsView());
