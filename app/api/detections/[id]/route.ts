import { route } from "@/lib/api";

/** Review a detection: {status: "real" | "false" | "new"} */
export const POST = route<{ id: string }>(async ({ runtime, request, params, operator }) => {
  const { status } = (await request.json()) as { status: "real" | "false" | "new" };
  if (!["real", "false", "new"].includes(status)) throw new Error("status must be real, false or new");
  return runtime.reviewDetection(params.id, status, operator);
});
