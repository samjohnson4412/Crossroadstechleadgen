import { NextResponse, type NextRequest } from "next/server";
import { checkBasic, parseUsers } from "./lib/auth";

export function middleware(request: NextRequest) {
  // Vendor webhooks authenticate with WEBHOOK_TOKEN (or their own secret) instead of a login.
  if (/^\/api\/integrations\/[^/]+\/webhook$/.test(request.nextUrl.pathname)) {
    const required = process.env.WEBHOOK_TOKEN;
    const given = request.nextUrl.searchParams.get("token") ?? request.headers.get("x-webhook-token");
    if (required && given !== required) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    return NextResponse.next();
  }

  const users = parseUsers();
  if (users.size === 0) {
    if (process.env.NODE_ENV === "production") {
      return new NextResponse("CONSOLE_USERS is not set. Refusing to serve an unauthenticated security console.", { status: 503 });
    }
    return NextResponse.next();
  }
  if (checkBasic(request.headers.get("authorization"), users)) return NextResponse.next();
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Campus Sentinel"' },
  });
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
