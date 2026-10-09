import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Edits operators make from the console (e.g. renaming rooms), stored outside
 * the site config so they survive updates to the code.
 */
export type NamedKind = "zone" | "camera" | "door" | "display";

export interface SiteOverrides {
  names: Record<string, string>; // "zone:e-101" -> "Mrs. Smith's Room"
}

const file = () => path.join(process.cwd(), "data", `site-overrides.${process.env.SENTINEL_SITE ?? "ccc"}.json`);

export function loadOverrides(): SiteOverrides {
  try {
    const parsed = JSON.parse(readFileSync(file(), "utf8")) as Partial<SiteOverrides>;
    return { names: parsed.names ?? {} };
  } catch {
    return { names: {} };
  }
}

export function saveOverrides(overrides: SiteOverrides) {
  mkdirSync(path.dirname(file()), { recursive: true });
  writeFileSync(file(), JSON.stringify(overrides, null, 2));
}
