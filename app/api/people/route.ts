import { route } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Badge holders, most recent first. ?q= matches name or card number. */
export const GET = route(async ({ runtime, request }) => runtime.searchPeople(new URL(request.url).searchParams.get("q") ?? ""));
