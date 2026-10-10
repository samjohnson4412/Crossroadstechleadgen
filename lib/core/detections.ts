/**
 * AI detections (from Blue Iris / CodeProject.AI today, any analytics source later)
 * and the rules that decide which ones need a person to look.
 * Types and pure logic only — safe to import from the browser and easy to test.
 */

export interface DetectionLabel {
  label: string;
  /** 0–100 */
  confidence?: number;
}

export type RuleSeverity = "info" | "warning" | "critical";

export interface RuleHit {
  ruleId: string;
  name: string;
  severity: RuleSeverity;
}

export interface Detection {
  id: string;
  at: string;
  integration: string;
  externalCameraId?: string;
  cameraId?: string;
  zoneId?: string;
  labels: DetectionLabel[];
  summary: string;
  /** A still was saved for this detection. */
  hasSnapshot: boolean;
  ruleHits: RuleHit[];
  severity: RuleSeverity;
  status: "new" | "real" | "false";
  reviewedBy?: string;
  reviewedAt?: string;
}

export interface DetectionRule {
  id: string;
  name: string;
  enabled: boolean;
  /** Labels that trigger it (any of). Empty = any label. */
  labels: string[];
  /** Ignore labels below this confidence (0–100). */
  minConfidence: number;
  /** Only between these local times, "HH:MM" (wraps past midnight). Empty = any time. */
  from?: string;
  to?: string;
  /** Only on cameras covering these areas. Empty = everywhere. */
  zoneIds: string[];
  /** Loitering: needs this many matching detections on the same camera within `minutes`. 1 = every time. */
  count: number;
  minutes: number;
  severity: RuleSeverity;
}

export const WEAPON_LABELS = ["gun", "pistol", "handgun", "rifle", "firearm", "weapon", "knife"];

export const DEFAULT_RULES: DetectionRule[] = [
  { id: "weapon", name: "Possible weapon", enabled: true, labels: WEAPON_LABELS, minConfidence: 50, zoneIds: [], count: 1, minutes: 1, severity: "critical" },
  { id: "after-hours", name: "Person after hours", enabled: true, labels: ["person"], minConfidence: 60, from: "22:00", to: "05:00", zoneIds: [], count: 1, minutes: 1, severity: "warning" },
  { id: "loitering", name: "Loitering", enabled: true, labels: ["person"], minConfidence: 60, zoneIds: [], count: 6, minutes: 10, severity: "warning" },
  { id: "restricted", name: "Person in restricted area", enabled: false, labels: ["person"], minConfidence: 60, zoneIds: [], count: 1, minutes: 1, severity: "warning" },
];

/**
 * Read labels from a Blue Iris alert memo, e.g. "person:87%", "person:87%,car:61%",
 * "person 87% knife 55%". Also accepts "Nothing found" / "cancelled" (→ no labels).
 */
export function parseLabels(memo: string | undefined | null): DetectionLabel[] {
  if (!memo) return [];
  const out: DetectionLabel[] = [];
  const re = /([A-Za-z][A-Za-z _-]*?)\s*[:=]?\s*(\d{1,3}(?:\.\d+)?)\s*%/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(memo))) out.push({ label: m[1].trim().toLowerCase(), confidence: Math.min(100, Number(m[2])) });
  if (!out.length && !/nothing|cancel|none/i.test(memo)) {
    for (const word of memo.split(/[,;]/).map((w) => w.trim().toLowerCase()).filter(Boolean)) if (/^[a-z][a-z _-]*$/.test(word)) out.push({ label: word });
  }
  return out;
}

function minutesOfDay(hhmm: string) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + (m || 0);
}

export function withinHours(at: Date, from?: string, to?: string) {
  if (!from || !to) return true;
  const now = at.getHours() * 60 + at.getMinutes();
  const a = minutesOfDay(from);
  const b = minutesOfDay(to);
  return a <= b ? now >= a && now < b : now >= a || now < b;
}

/** Which rules a new detection triggers. `recent` = earlier detections (any order). */
export function evaluateRules(rules: DetectionRule[], det: Detection, recent: Detection[], cameraZones: string[]): RuleHit[] {
  const hits: RuleHit[] = [];
  const at = new Date(det.at);
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const matches = (d: Detection) =>
      d.labels.some((l) => (rule.labels.length === 0 || rule.labels.includes(l.label)) && (l.confidence === undefined || l.confidence >= rule.minConfidence));
    if (!matches(det)) continue;
    if (!withinHours(at, rule.from, rule.to)) continue;
    if (rule.zoneIds.length && !cameraZones.some((z) => rule.zoneIds.includes(z))) continue;
    if (rule.count > 1) {
      const since = at.getTime() - rule.minutes * 60_000;
      const n = recent.filter((d) => d.cameraId === det.cameraId && Date.parse(d.at) >= since && d.id !== det.id && matches(d)).length + 1;
      if (n < rule.count) continue;
      // Fire once per window, not on every further detection.
      const alreadyFired = recent.some((d) => d.cameraId === det.cameraId && Date.parse(d.at) >= since && d.ruleHits.some((h) => h.ruleId === rule.id));
      if (alreadyFired) continue;
    }
    hits.push({ ruleId: rule.id, name: rule.name, severity: rule.severity });
  }
  return hits;
}

export function topSeverity(hits: RuleHit[]): RuleSeverity {
  return hits.some((h) => h.severity === "critical") ? "critical" : hits.some((h) => h.severity === "warning") ? "warning" : "info";
}
