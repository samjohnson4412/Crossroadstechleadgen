/**
 * Mass notification: one alert, sent to chosen areas, over every channel at once
 * (SMART boards, speakers/horns, phone paging, SaferWatch, door lockdown).
 * Types only + presets — safe to import from the browser.
 */

export type AlertChannel = "displays" | "paging" | "sms" | "saferwatch" | "lockdown";
export type AlertLevel = "info" | "warning" | "emergency";

export interface AlertPreset {
  id: string;
  label: string;
  level: AlertLevel;
  title: string;
  message: string;
  /** Channels ticked by default for this kind of alert. */
  channels: AlertChannel[];
  color: string;
  icon: string;
}

export const ALERT_PRESETS: AlertPreset[] = [
  {
    id: "lockdown",
    label: "Lockdown",
    level: "emergency",
    title: "LOCKDOWN",
    message: "Lockdown. Locks, lights, out of sight. Do not open doors until released by staff or police.",
    channels: ["displays", "paging", "sms", "saferwatch", "lockdown"],
    color: "#a855f7",
    icon: "🔒",
  },
  {
    id: "secure",
    label: "Secure / Hold",
    level: "warning",
    title: "SECURE THE BUILDING",
    message: "Secure. Get inside, lock outside doors. Business as usual inside.",
    channels: ["displays", "paging"],
    color: "#f97316",
    icon: "🛡",
  },
  {
    id: "evacuate",
    label: "Evacuate",
    level: "emergency",
    title: "EVACUATE",
    message: "Evacuate the building now using the nearest safe exit. Go to your assembly area.",
    channels: ["displays", "paging", "sms", "saferwatch"],
    color: "#e5484d",
    icon: "🏃",
  },
  {
    id: "shelter",
    label: "Shelter in place",
    level: "emergency",
    title: "SHELTER IN PLACE",
    message: "Shelter in place. Move to an interior room away from windows and await instructions.",
    channels: ["displays", "paging", "sms", "saferwatch"],
    color: "#0ea5e9",
    icon: "🏠",
  },
  {
    id: "medical",
    label: "Medical",
    level: "warning",
    title: "MEDICAL EMERGENCY",
    message: "Medical emergency in progress. Keep hallways clear for responders.",
    channels: ["displays", "sms", "saferwatch"],
    color: "#22c55e",
    icon: "✚",
  },
  {
    id: "weather",
    label: "Severe weather",
    level: "warning",
    title: "SEVERE WEATHER",
    message: "Severe weather warning. Move to your designated shelter area now.",
    channels: ["displays", "paging"],
    color: "#eab308",
    icon: "⛈",
  },
  {
    id: "announcement",
    label: "Announcement",
    level: "info",
    title: "",
    message: "",
    channels: ["displays"],
    color: "#3d8bfd",
    icon: "📢",
  },
];

export const CHANNEL_LABELS: Record<AlertChannel, string> = {
  displays: "SMART Boards",
  paging: "Speakers / horns / phone paging",
  sms: "Text message to staff",
  saferwatch: "SaferWatch app",
  lockdown: "Lock all controlled doors",
};

export interface AlertSpec {
  presetId: string;
  level: AlertLevel;
  title: string;
  message: string;
  /** Rooms/areas targeted; null = the whole campus. */
  zoneIds: string[] | null;
  /** Human description of where, e.g. "Education, Level 2" — shown to people and logged. */
  scopeLabel: string;
  channels: AlertChannel[];
  /** A drill: marked DRILL on every channel and logged as a drill. */
  drill?: boolean;
}

export interface AlertDelivery {
  channel: AlertChannel;
  /** Which system (integration) delivered it. */
  system: string;
  status: "sent" | "simulated" | "failed" | "skipped";
  detail?: string;
}

export interface Alert extends AlertSpec {
  id: string;
  at: string;
  by: string;
  status: "active" | "cleared";
  clearedAt?: string;
  clearedBy?: string;
  deliveries: AlertDelivery[];
}
