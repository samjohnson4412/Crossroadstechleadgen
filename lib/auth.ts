/**
 * Minimal operator auth: HTTP Basic against CONSOLE_USERS ("name:password,name2:password2").
 * Good enough to keep a site-network console from being open; to be replaced by
 * proper accounts/SSO and roles before production use.
 */

export function parseUsers(spec = process.env.CONSOLE_USERS ?? ""): Map<string, string> {
  const users = new Map<string, string>();
  for (const pair of spec.split(",")) {
    const i = pair.indexOf(":");
    if (i > 0) users.set(pair.slice(0, i).trim(), pair.slice(i + 1));
  }
  return users;
}

export function authConfigured(): boolean {
  return parseUsers().size > 0;
}

/** Returns the operator name for a valid Basic header, or null. */
export function checkBasic(header: string | null, users = parseUsers()): string | null {
  if (!header?.startsWith("Basic ")) return null;
  let decoded: string;
  try {
    decoded = atob(header.slice(6));
  } catch {
    return null;
  }
  const i = decoded.indexOf(":");
  const name = decoded.slice(0, i);
  return i > 0 && users.get(name) === decoded.slice(i + 1) ? name : null;
}

/** Operator identity for audit logging. Middleware has already enforced auth when it's configured. */
export function operatorFrom(request: Request): { name: string } {
  return { name: checkBasic(request.headers.get("authorization")) ?? "local operator" };
}
