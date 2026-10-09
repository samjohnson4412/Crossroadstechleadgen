import { route } from "@/lib/api";

export const POST = route(async ({ runtime, request, operator }) => {
  const { active } = (await request.json()) as { active: boolean };
  await runtime.setLockdown(!!active, operator);
});
