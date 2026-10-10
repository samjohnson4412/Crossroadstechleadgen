import { route } from "@/lib/api";

export const dynamic = "force-dynamic";

/** All incidents, newest first (without full timelines). */
export const GET = route(async ({ runtime }) =>
  runtime.incidents
    .slice()
    .reverse()
    .map(({ timeline, ...rest }) => ({ ...rest, items: timeline.length })),
);

/** Start an incident: {title} */
export const POST = route(async ({ runtime, request, operator }) => {
  const { title } = (await request.json()) as { title?: string };
  return runtime.openIncidentNow(title ?? "Incident", operator);
});
