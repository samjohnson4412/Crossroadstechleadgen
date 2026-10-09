import { authConfigured, operatorFrom } from "./auth";
import { getRuntime, type Runtime } from "./core/runtime";

type Ctx<P> = { params: Promise<P> };

/** Wraps a route handler: gives it the runtime + operator, turns thrown errors into JSON. */
export function route<P = Record<string, string>>(
  fn: (args: { runtime: Runtime; request: Request; params: P; operator: { name: string } }) => Promise<Response | unknown>,
) {
  return async (request: Request, ctx: Ctx<P>) => {
    try {
      const runtime = await getRuntime();
      const out = await fn({ runtime, request, params: await ctx.params, operator: operatorFrom(request) });
      return out instanceof Response ? out : Response.json(out ?? { ok: true });
    } catch (err) {
      return Response.json({ error: (err as Error).message }, { status: 400 });
    }
  };
}

export { authConfigured };
