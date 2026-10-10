import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { Building, ParkedDevices, Passage } from "./site.ts";

/**
 * Edits operators make from the console (e.g. renaming rooms), stored outside
 * the site config so they survive updates to the code.
 */
export type NamedKind = "zone" | "camera" | "door" | "display";

export interface SiteLayout {
  buildings: Building[];
  passages: Passage[];
  parked?: ParkedDevices;
}

export interface SiteOverrides {
  names: Record<string, string>; // "zone:e-101" -> "Mrs. Smith's Room"
  /** The whole map as drawn in the console's map editor; replaces the config file's layout. */
  layout?: SiteLayout;
}

const file = () => path.join(process.cwd(), "data", `site-overrides.${process.env.SENTINEL_SITE ?? "ccc"}.json`);

export function loadOverrides(): SiteOverrides {
  try {
    const parsed = JSON.parse(readFileSync(file(), "utf8")) as Partial<SiteOverrides>;
    return { names: parsed.names ?? {}, layout: parsed.layout };
  } catch {
    return { names: {} };
  }
}

export function saveOverrides(overrides: SiteOverrides) {
  mkdirSync(path.dirname(file()), { recursive: true });
  writeFileSync(file(), JSON.stringify(overrides, null, 2));
}
