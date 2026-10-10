/** Staff who get text messages, and which kinds. Types only — safe in the browser. */

export type NotifyTopic = "alerts" | "critical" | "doors" | "watchlist" | "system";

export const TOPIC_LABELS: Record<NotifyTopic, string> = {
  alerts: "Alerts sent from the Alert Center (when “Text message” is ticked)",
  critical: "Critical detections (possible weapon)",
  doors: "Door forced open / held open",
  watchlist: "Watch-list badge used",
  system: "A system went offline (cameras, doors, feeds)",
};

export interface Contact {
  id: string;
  name: string;
  phone: string;
  topics: NotifyTopic[];
  enabled: boolean;
}

/** US-friendly: 10 digits → +1XXXXXXXXXX; anything starting with + kept. Null if it can't be a phone number. */
export function normalizePhone(input: string): string | null {
  const trimmed = input.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (trimmed.startsWith("+") && digits.length >= 8 && digits.length <= 15) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return null;
}
