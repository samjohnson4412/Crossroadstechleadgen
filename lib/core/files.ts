import { appendFile, mkdir, readdir, unlink, writeFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Small helpers for the console's data folder (data/), where everything it remembers lives. */
export const dataDir = (...parts: string[]) => path.join(process.cwd(), "data", ...parts);
const site = () => process.env.SENTINEL_SITE ?? "ccc";
export const siteFile = (name: string, ext = "json") => dataDir(`${name}.${site()}.${ext}`);

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

const pending = new Map<string, ReturnType<typeof setTimeout>>();
/** Write JSON at most once a second per file (many small updates collapse into one write). */
export function writeJsonSoon(file: string, value: () => unknown) {
  clearTimeout(pending.get(file));
  pending.set(
    file,
    setTimeout(async () => {
      pending.delete(file);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify(value(), null, 1));
    }, 1000),
  );
}

export async function appendLine(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  await appendFile(file, JSON.stringify(value) + "\n");
}

/** Last `max` JSON lines of a .jsonl file. */
export function readJsonLines<T>(file: string, max: number): T[] {
  if (!existsSync(file)) return [];
  const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
  const out: T[] = [];
  for (const line of lines.slice(-max)) {
    try {
      out.push(JSON.parse(line) as T);
    } catch {}
  }
  return out;
}

/** Keep only the newest `keep` files in a folder. */
export async function pruneFolder(dir: string, keep: number) {
  try {
    const files = (await readdir(dir)).sort();
    for (const f of files.slice(0, Math.max(0, files.length - keep))) await unlink(path.join(dir, f)).catch(() => {});
  } catch {}
}
