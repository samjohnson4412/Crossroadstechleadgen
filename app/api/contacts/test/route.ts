import { route } from "@/lib/api";

/** Send a test text to one saved contact: {id} */
export const POST = route(async ({ runtime, request, operator }) => {
  const { id } = (await request.json()) as { id: string };
  return runtime.testText(id, operator);
});
