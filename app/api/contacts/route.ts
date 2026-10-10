import { route } from "@/lib/api";
import type { Contact } from "@/lib/core/contacts";

export const dynamic = "force-dynamic";

export const GET = route(async ({ runtime }) => runtime.contacts);

export const PUT = route(async ({ runtime, request, operator }) => {
  const { contacts } = (await request.json()) as { contacts: Contact[] };
  if (!Array.isArray(contacts)) throw new Error("contacts are required");
  return runtime.saveContacts(contacts, operator);
});
