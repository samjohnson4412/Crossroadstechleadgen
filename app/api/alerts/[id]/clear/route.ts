import { route } from "@/lib/api";

/** All clear: {liftLockdown?: boolean} */
export const POST = route<{ id: string }>(async ({ runtime, request, params, operator }) => {
  const body = (await request.json().catch(() => ({}))) as { liftLockdown?: boolean };
  return runtime.clearAlert(params.id, operator, { liftLockdown: !!body.liftLockdown });
});
