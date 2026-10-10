import { route } from "@/lib/api";

export const dynamic = "force-dynamic";

/** Camera health for admins. ?refresh=1 re-reads the camera servers first. */
export const GET = route(async ({ runtime, request }) => {
  if (new URL(request.url).searchParams.get("refresh")) await runtime.refreshVendorCameras();
  return runtime.cameraHealth();
});
