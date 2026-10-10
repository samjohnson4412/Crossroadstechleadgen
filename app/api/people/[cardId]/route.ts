import { route } from "@/lib/api";

export const dynamic = "force-dynamic";

/** One card's swipes for a day. ?date=YYYY-MM-DD (default today). */
export const GET = route<{ cardId: string }>(async ({ runtime, request, params }) =>
  runtime.personHistory(decodeURIComponent(params.cardId), new URL(request.url).searchParams.get("date") ?? undefined),
);
