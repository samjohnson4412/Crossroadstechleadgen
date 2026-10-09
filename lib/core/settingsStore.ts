import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { IntegrationConfig } from "./site.ts";

/**
 * Connection settings entered on the console's Settings page (IP addresses,
 * usernames, passwords, tokens). Stored server-side in data/settings.<site>.json;
 * secrets are never sent back to the browser.
 *
 * Precedence for each setting: Settings page → .env.local → built-in default.
 */
export interface StoredSettings {
  integrations: Record<string, Record<string, string>>;
}

const file = () => path.join(process.cwd(), "data", `settings.${process.env.SENTINEL_SITE ?? "ccc"}.json`);

export function loadSettings(): StoredSettings {
  try {
    const parsed = JSON.parse(readFileSync(file(), "utf8")) as Partial<StoredSettings>;
    return { integrations: parsed.integrations ?? {} };
  } catch {
    return { integrations: {} };
  }
}

export function saveSettings(settings: StoredSettings) {
  mkdirSync(path.dirname(file()), { recursive: true });
  writeFileSync(file(), JSON.stringify(settings, null, 2));
}

export type SettingSource = "settings page" | ".env.local" | "default" | "not set";

/** Resolve one integration's settings, and where each value came from. */
export function resolveIntegrationSettings(config: IntegrationConfig, stored = loadSettings()) {
  const values: Record<string, string | number | boolean | undefined> = {};
  const sources: Record<string, SettingSource> = {};
  const saved = stored.integrations[config.id] ?? {};
  for (const [key, spec] of Object.entries(config.settings)) {
    if (saved[key] !== undefined && saved[key] !== "") {
      values[key] = saved[key];
      sources[key] = "settings page";
    } else if (typeof spec === "object") {
      const env = process.env[spec.env];
      if (env) (values[key] = env), (sources[key] = ".env.local");
      else if (spec.default !== undefined) (values[key] = spec.default), (sources[key] = "default");
      else (values[key] = undefined), (sources[key] = "not set");
    } else {
      values[key] = spec;
      sources[key] = "default";
    }
  }
  return { values, sources };
}
