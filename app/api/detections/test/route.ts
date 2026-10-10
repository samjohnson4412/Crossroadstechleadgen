import { route } from "@/lib/api";

/** Push a made-up detection through the real pipeline: {cameraId, labels: [{label, confidence}]} */
export const POST = route(async ({ runtime, request }) => {
  const { cameraId, labels } = (await request.json()) as { cameraId: string; labels: { label: string; confidence?: number }[] };
  if (!labels?.length) throw new Error("labels are required");
  runtime.testDetection(cameraId, labels);
});
