import { route } from "@/lib/api";
import type { DoorAction } from "@/lib/core/runtime";

const ACTIONS: DoorAction[] = ["unlock", "hold-unlocked", "hold-locked", "reset"];

export const POST = route<{ id: string }>(async ({ runtime, request, params, operator }) => {
  const { action } = (await request.json()) as { action: DoorAction };
  if (!ACTIONS.includes(action)) throw new Error(`action must be one of ${ACTIONS.join(", ")}`);
  await runtime.doorAction(params.id, action, operator);
});
