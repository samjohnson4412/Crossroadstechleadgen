/**
 * How each driver's settings appear on the Settings page.
 * Anything not listed is shown as a plain text box (passwords/tokens/secrets are masked).
 */
export interface FieldInfo {
  label: string;
  type?: "text" | "password" | "boolean";
  placeholder?: string;
  help?: string;
}

export const DRIVER_FIELDS: Record<string, Record<string, FieldInfo>> = {
  blueiris: {
    url: { label: "Server address", placeholder: "http://192.168.200.55:19009", help: "Blue Iris → Settings → Web server (IP and port)." },
    user: { label: "Username", help: "A Blue Iris user that can view all cameras." },
    password: { label: "Password", type: "password" },
  },
  "unifi-access": {
    host: { label: "Controller IP", placeholder: "192.168.1.5", help: "The API listens on port 12445." },
    token: { label: "API token", type: "password", help: "UniFi Access → Settings → General → Advanced → API Token." },
    insecureTls: { label: "Accept self-signed certificate", type: "boolean", help: "Usually on for an on-site controller." },
  },
  identipass: {
    listenPort: { label: "Printer feed port", placeholder: "9100", help: "IDentiPASS's transaction printer is pointed at this console on this TCP port (raw printing)." },
    columns: {
      label: "Printer columns (start/width)",
      placeholder: "0/15 15/10 25/10 35/15 50/15 65/15 80/20",
      help: "Same numbers as IDentiPASS → Transaction Printer Setup, in its order: Date, Time, Card, Holder, Panel, Point, Action. Recommended: 0/12 12/10 22/10 32/30 62/16 78/30 108/25",
    },
  },
  saferwatch: {
    webhookSecret: { label: "Inbound webhook secret", type: "password", help: "SaferWatch (or a relay) sends this in the x-sentinel-secret header." },
    outboundUrl: { label: "Outbound alert URL", placeholder: "https://…", help: "Where console alerts are sent. Leave blank to only receive." },
    outboundToken: { label: "Outbound token", type: "password" },
  },
  "smart-displays": {
    sendUrl: { label: "Send URL", placeholder: "https://…", help: "SMART Remote Management endpoint (or relay) that shows messages on boards." },
    token: { label: "API token", type: "password" },
  },
  twilio: {
    accountSid: { label: "Account SID", placeholder: "AC…", help: "Twilio console → Account info." },
    authToken: { label: "Auth token", type: "password" },
    from: { label: "From number", placeholder: "+15551234567", help: "Your Twilio phone number." },
  },
  algo: {
    host: { label: "Device IP", placeholder: "192.168.1.60", help: "Algo paging adapter / speaker." },
    password: { label: "Admin password", type: "password" },
    toneEmergency: { label: "Emergency tone file", placeholder: "emergency.wav" },
    toneWarning: { label: "Warning tone file", placeholder: "warning.wav" },
    toneInfo: { label: "Announcement tone file", placeholder: "chime.wav" },
    tts: { label: "Also speak the message (text-to-speech)", type: "boolean" },
  },
};

export function fieldInfo(driver: string, key: string): FieldInfo {
  const known = DRIVER_FIELDS[driver]?.[key];
  if (known) return known;
  return { label: key, type: /pass|token|secret/i.test(key) ? "password" : "text" };
}
