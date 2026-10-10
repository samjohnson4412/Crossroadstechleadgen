import { poly, rect, type CameraPlacement, type DoorPlacement, type SiteConfig } from "../../lib/core/site.ts";

/**
 * CCC campus: Y Building (gym), Education Building, and the Sanctuary building,
 * drawn over the campus aerial composites in /public/floorplans (one per level).
 * Coordinates are pixels on those images.
 *
 * Room shapes are traced from the plans and are approximate. Room names can be
 * changed from the console (they're saved in data/site-overrides.json).
 *
 * Cameras start empty: they're placed by hand in the console's Edit map, from the
 * "Blue Iris cameras not on the map yet" list (both Blue Iris servers). Controlled doors are the IDentiPASS points (events only
 * until UniFi Access replaces it).
 */

/** A Blue Iris camera, by its short name. Positions are best guesses from the camera names — drag to fix in Edit map. */
const cam = (externalId: string, name: string, x: number, y: number, heading: number, covers: string[], fov = 70): CameraPlacement => ({
  id: `bi-${externalId}`,
  name,
  position: { x, y },
  heading,
  fov,
  covers,
  source: { integration: "cameras", externalId },
});

/** A door on IDentiPASS, by its point name exactly as IDentiPASS prints it (without the "(n)" prefix). */
const ipass = (point: string, x: number, y: number, between: [string, string], exterior = false): DoorPlacement => ({
  id: `ip-${point.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
  name: point,
  position: { x, y },
  between,
  exterior,
  source: { integration: "identipass", externalId: point },
});

/** A camera on the second Blue Iris server. */
const cam2 = (externalId: string, name: string, x: number, y: number, heading: number, covers: string[], fov = 70): CameraPlacement => ({
  ...cam(externalId, name, x, y, heading, covers, fov),
  id: `bi2-${externalId}`,
  source: { integration: "cameras2", externalId },
});

const door = (id: string, name: string, x: number, y: number, between: [string, string], exterior = false): DoorPlacement => ({
  id,
  name,
  position: { x, y },
  between,
  exterior,
  source: { integration: "doors", externalId: id },
  placeholder: true,
});

const Y = "Y Building";
const EDU = "Education";
const SAN = "Sanctuary";

export const cccSite: SiteConfig = {
  id: "ccc",
  name: "CCC Campus",
  integrations: [
    {
      id: "cameras",
      driver: "blueiris",
      name: "Blue Iris",
      settings: { url: { env: "BLUEIRIS_URL" }, user: { env: "BLUEIRIS_USER" }, password: { env: "BLUEIRIS_PASSWORD" } },
    },
    {
      id: "cameras2",
      driver: "blueiris",
      name: "Blue Iris (server 2)",
      optional: true,
      settings: { url: { env: "BLUEIRIS2_URL" }, user: { env: "BLUEIRIS2_USER" }, password: { env: "BLUEIRIS2_PASSWORD" } },
    },
    {
      id: "doors",
      driver: "unifi-access",
      name: "UniFi Access",
      settings: {
        host: { env: "UNIFI_ACCESS_HOST" },
        token: { env: "UNIFI_ACCESS_TOKEN" },
        insecureTls: { env: "UNIFI_ACCESS_INSECURE_TLS", default: "true" },
      },
    },
    {
      id: "identipass",
      driver: "identipass",
      name: "IDentiPASS (door events)",
      settings: { listenPort: { env: "IDENTIPASS_PORT", default: "9100" }, columns: { env: "IDENTIPASS_COLUMNS" } },
    },
    {
      id: "saferwatch",
      driver: "saferwatch",
      name: "SaferWatch",
      settings: {
        webhookSecret: { env: "SAFERWATCH_WEBHOOK_SECRET" },
        outboundUrl: { env: "SAFERWATCH_OUTBOUND_URL" },
        outboundToken: { env: "SAFERWATCH_OUTBOUND_TOKEN" },
      },
    },
    {
      id: "paging",
      driver: "algo",
      name: "Algo paging (GoTo phones / horns)",
      settings: {
        host: { env: "ALGO_HOST" },
        password: { env: "ALGO_PASSWORD" },
        toneEmergency: { env: "ALGO_TONE_EMERGENCY", default: "emergency.wav" },
        toneWarning: { env: "ALGO_TONE_WARNING", default: "warning.wav" },
        toneInfo: { env: "ALGO_TONE_INFO", default: "chime.wav" },
        tts: { env: "ALGO_TTS", default: "false" },
      },
    },
    {
      id: "sms",
      driver: "twilio",
      name: "Text messages (Twilio)",
      settings: { accountSid: { env: "TWILIO_ACCOUNT_SID" }, authToken: { env: "TWILIO_AUTH_TOKEN" }, from: { env: "TWILIO_FROM" } },
    },
    {
      id: "displays",
      driver: "smart-displays",
      name: "SMART Boards",
      settings: { sendUrl: { env: "SMART_SEND_URL" }, token: { env: "SMART_TOKEN" } },
    },
  ],
  passages: [
    // ---- Level 1: Y Building ----
    { between: ["y-gym", "y-106"] },
    { between: ["y-gym", "y-105"] },
    { between: ["y-gym", "y-west"] },
    { between: ["y-gym", "y-lobby"] },
    { between: ["y-gym", "y-east-hall"] },
    { between: ["y-north", "y-106"] },
    { between: ["y-north", "y-west"] },
    { between: ["y-west", "y-offices"] },
    { between: ["y-offices", "y-lobby"] },
    { between: ["y-lobby", "y-cafe"] },
    { between: ["y-cafe", "y-east-hall"] },
    { between: ["y-east-hall", "y-restrooms"] },
    { between: ["y-105", "y-east-hall"] },
    // ---- Level 1: Education ----
    { between: ["e-connector", "e-east-hall"] },
    { between: ["e-connector", "e-north-offices"] },
    { between: ["e-north-offices", "e-north-hall"] },
    { between: ["e-offices", "e-north-hall"] },
    { between: ["e-north-hall", "e-west-hall"] },
    { between: ["e-north-hall", "e-east-hall"] },
    { between: ["e-west-hall", "e-utility"] },
    { between: ["e-west-hall", "e-104"] },
    { between: ["e-west-hall", "e-103"] },
    { between: ["e-west-hall", "e-102"] },
    { between: ["e-west-hall", "e-105"] },
    { between: ["e-west-hall", "e-108"] },
    { between: ["e-east-hall", "e-106"] },
    { between: ["e-east-hall", "e-107"] },
    { between: ["e-mid-hall", "e-west-hall"] },
    { between: ["e-mid-hall", "e-east-hall"] },
    { between: ["e-mid-hall", "e-restrooms"] },
    { between: ["e-west-hall", "e-101"] },
    { between: ["e-mid-hall", "e-100"] },
    // ---- Level 1: Sanctuary ----
    { between: ["o-north-parking", "o-north-canopy"] },
    { between: ["s-north-lobby", "s-cafe"] },
    { between: ["s-cafe", "s-west"] },
    { between: ["s-cafe", "s-sanctuary"] },
    { between: ["s-north-lobby", "s-east"] },
    { between: ["s-north-lobby", "s-sanctuary"] },
    { between: ["s-west", "s-sanctuary"] },
    { between: ["s-east", "s-sanctuary"] },
    { between: ["s-sanctuary", "s-stage"] },
    { between: ["s-west", "s-sw"] },
    { between: ["s-east", "s-se"] },
    { between: ["s-sw", "s-south-lobby"] },
    { between: ["s-se", "s-south-lobby"] },
    { between: ["s-stage", "s-south-lobby"] },
    { between: ["o-drive", "o-north-parking"] },
    // ---- Level 2: Education ----
    { between: ["e2-west-hall", "e2-kitchen"] },
    { between: ["e2-west-hall", "e2-215"] },
    { between: ["e2-215", "e2-216"] },
    { between: ["e2-west-hall", "e2-210"] },
    { between: ["e2-west-hall", "e2-209"] },
    { between: ["e2-west-hall", "e2-218"] },
    { between: ["e2-218", "e2-217"] },
    { between: ["e2-west-hall", "e2-south-hall"] },
    { between: ["e2-south-hall", "e2-221"] },
    { between: ["e2-south-hall", "e2-222"] },
    { between: ["e2-south-hall", "e2-restrooms"] },
    { between: ["e2-south-hall", "e2-storage"] },
    { between: ["e2-south-hall", "e2-203"] },
    { between: ["e2-south-hall", "e2-202"] },
    { between: ["e2-south-hall", "e2-201"] },
    { between: ["e2-south-hall", "e2-200"] },
    // ---- Level 2: Sanctuary ----
    { between: ["s2-north", "s2-west"] },
    { between: ["s2-north", "s2-east"] },
    { between: ["s2-north", "s2-balcony"] },
    { between: ["s2-west", "s2-balcony"] },
    { between: ["s2-east", "s2-balcony"] },
    { between: ["s2-west", "s2-west-rooms"] },
    { between: ["s2-east", "s2-east-rooms"] },
    { between: ["s2-west", "s2-sw"] },
    { between: ["s2-east", "s2-se"] },
    { between: ["s2-west-rooms", "s2-south-hall"] },
    { between: ["s2-east-rooms", "s2-south-hall"] },
    { between: ["s2-sw", "s2-south-hall"] },
    { between: ["s2-se", "s2-south-hall"] },
    { between: ["s2-south-hall", "s2-238"] },
    { between: ["s2-south-hall", "s2-236"] },
    { between: ["o-north-canopy", "s-north-lobby"] },
    { between: ["y-east-hall", "o-north-parking"] },
    { between: ["e2-south-hall", "e2-bridge"] },
    { between: ["e2-bridge", "s2-west"] },
    // ---- Stairs / elevators between levels ----
    { between: ["e-utility", "e2-west-hall"], seconds: 25 },
    { between: ["s-west", "s2-west"], seconds: 25 },
    { between: ["s-east", "s2-east"], seconds: 25 },
    { between: ["s-north-lobby", "s2-north"], seconds: 25 },
    { between: ["s-south-lobby", "s2-south-hall"], seconds: 25 },
    { between: ["s-sw", "s2-sw"], seconds: 25 },
    { between: ["s-se", "s2-se"], seconds: 25 },
  ],
  buildings: [
    {
      id: "campus",
      name: "CCC Campus",
      floors: [
        {
          id: "l1",
          name: "Level 1",
          width: 726,
          height: 722,
          background: "/floorplans/ccc-level1.webp",
          zones: [
            // Y Building
            { id: "y-gym", name: "Gym (Y-142 Multipurpose)", kind: "common", building: Y, polygon: rect(150, 85, 138, 130) },
            { id: "y-106", name: "Y-106 (40 cap.)", kind: "room", building: Y, polygon: rect(205, 35, 55, 50) },
            { id: "y-105", name: "Y-105 Meeting Room (125 cap.)", kind: "room", building: Y, polygon: poly(260, 35, 335, 35, 354, 62, 354, 110, 288, 110, 288, 85, 260, 85) },
            { id: "y-restrooms", name: "Y Restrooms", kind: "room", building: Y, polygon: rect(288, 110, 40, 42) },
            { id: "y-east-hall", name: "Y East Hall", kind: "hall", building: Y, polygon: poly(328, 110, 354, 110, 354, 218, 288, 218, 288, 152, 328, 152) },
            { id: "y-cafe", name: "Y Café / Lounge", kind: "common", building: Y, polygon: rect(255, 218, 99, 67) },
            { id: "y-lobby", name: "Y Lobby", kind: "entry", building: Y, polygon: rect(200, 215, 55, 70) },
            { id: "y-offices", name: "Y South Offices", kind: "office", building: Y, polygon: rect(90, 215, 110, 70) },
            { id: "y-west", name: "Y West Rooms", kind: "room", building: Y, polygon: rect(90, 85, 60, 130) },
            { id: "y-north", name: "Y North Rooms", kind: "room", building: Y, polygon: rect(90, 35, 115, 50) },
            // Education — level 1
            { id: "e-offices", name: "Lounge / Receiving / Store", kind: "office", building: EDU, polygon: rect(48, 305, 52, 60) },
            { id: "e-north-offices", name: "Education Front Offices", kind: "office", building: EDU, polygon: rect(100, 305, 110, 40) },
            { id: "e-north-hall", name: "Education North Hall", kind: "hall", building: EDU, polygon: rect(100, 345, 115, 15) },
            { id: "e-utility", name: "Elevator / Stairs (Education)", kind: "stair", building: EDU, polygon: rect(48, 365, 52, 35) },
            { id: "e-104", name: "E104", kind: "room", building: EDU, polygon: rect(48, 400, 52, 50) },
            { id: "e-103", name: "E103", kind: "room", building: EDU, polygon: rect(48, 450, 52, 50) },
            { id: "e-102", name: "E102", kind: "room", building: EDU, polygon: rect(48, 500, 52, 48) },
            { id: "e-west-hall", name: "Education West Hall", kind: "hall", building: EDU, polygon: rect(100, 360, 30, 140) },
            { id: "e-105", name: "E105", kind: "room", building: EDU, polygon: rect(130, 360, 35, 55) },
            { id: "e-106", name: "E106", kind: "room", building: EDU, polygon: rect(165, 360, 35, 55) },
            { id: "e-108", name: "E108", kind: "room", building: EDU, polygon: rect(130, 415, 35, 42) },
            { id: "e-107", name: "E107", kind: "room", building: EDU, polygon: rect(165, 415, 35, 42) },
            { id: "e-mid-hall", name: "Education Center Hall", kind: "hall", building: EDU, polygon: rect(130, 457, 85, 13) },
            { id: "e-restrooms", name: "Education Restrooms", kind: "room", building: EDU, polygon: rect(130, 470, 70, 30) },
            { id: "e-east-hall", name: "Education East Hall", kind: "hall", building: EDU, polygon: rect(200, 360, 15, 97) },
            { id: "e-101", name: "E101", kind: "room", building: EDU, polygon: rect(100, 500, 65, 48) },
            { id: "e-100", name: "E100", kind: "room", building: EDU, polygon: rect(165, 500, 50, 48) },
            { id: "e-connector", name: "Education Connector (IDF I)", kind: "hall", building: EDU, polygon: rect(215, 288, 40, 82) },
            // Sanctuary — level 1
            { id: "s-north-lobby", name: "Sanctuary North Lobby", kind: "entry", building: SAN, polygon: rect(330, 300, 340, 58) },
            { id: "s-cafe", name: "Café", kind: "common", building: SAN, polygon: poly(330, 358, 430, 358, 382, 410, 382, 420, 330, 420) },
            { id: "s-west", name: "West Concourse", kind: "hall", building: SAN, polygon: rect(330, 420, 52, 143) },
            { id: "s-east", name: "East Concourse", kind: "hall", building: SAN, polygon: rect(618, 358, 52, 205) },
            { id: "s-sanctuary", name: "Sanctuary (Main Floor)", kind: "common", building: SAN, polygon: poly(430, 358, 570, 358, 618, 410, 618, 480, 560, 522, 440, 522, 382, 480, 382, 410) },
            { id: "s-stage", name: "Stage / Platform", kind: "common", building: SAN, polygon: rect(440, 522, 120, 45) },
            { id: "s-sw", name: "Southwest Wing", kind: "room", building: SAN, polygon: rect(330, 563, 140, 105) },
            { id: "s-south-lobby", name: "South Lobby", kind: "entry", building: SAN, polygon: rect(470, 567, 60, 101) },
            { id: "s-se", name: "Southeast Wing", kind: "room", building: SAN, polygon: rect(530, 563, 140, 105) },
            // Outside
            { id: "o-north-parking", name: "North Parking", kind: "outdoor", polygon: rect(380, 95, 320, 140) },
            { id: "o-north-canopy", name: "Sanctuary Drop-off Canopy", kind: "outdoor", polygon: rect(470, 235, 85, 65) },
            { id: "o-drive", name: "West Drive (between buildings)", kind: "outdoor", polygon: rect(256, 290, 70, 175) },
            { id: "o-south-entrance", name: "South Entrance", kind: "outdoor", polygon: rect(478, 668, 50, 50) },
            { id: "o-playground", name: "Playground", kind: "outdoor", polygon: rect(60, 555, 200, 160) },
          ],
          cameras: [],
          doors: [
            // IDentiPASS controlled doors (positions approximate — drag to fix in Edit map).
            // For exterior doors list [outside, inside]: a badge swipe places the person inside.
            ipass("WC West Lobby", 330, 420, ["o-drive", "s-west"], true),
            ipass("WC South Lobby", 503, 668, ["o-south-entrance", "s-south-lobby"], true),
            ipass("EB/YC Breezeway", 230, 287, ["y-lobby", "e-connector"]),
            ipass("EB Academy Door", 255, 330, ["o-drive", "e-connector"], true),
            ipass("YC Break Room", 200, 250, ["y-offices", "y-lobby"]),
            ipass("YC Reception Desk", 120, 215, ["y-west", "y-offices"]),
            ipass("YC Cafe Entry", 354, 250, ["o-north-parking", "y-cafe"], true),
          ],
          displays: [],
        },
        {
          id: "l2",
          name: "Level 2",
          width: 709,
          height: 708,
          background: "/floorplans/ccc-level2.webp",
          zones: [
            // Education — level 2
            { id: "e2-kitchen", name: "Kitchen", kind: "room", building: EDU, polygon: rect(48, 300, 52, 65) },
            { id: "e2-215", name: "E215", kind: "room", building: EDU, polygon: rect(100, 300, 53, 65) },
            { id: "e2-216", name: "E216", kind: "room", building: EDU, polygon: rect(153, 300, 60, 65) },
            { id: "e2-210", name: "E210", kind: "room", building: EDU, polygon: rect(48, 365, 37, 45) },
            { id: "e2-209", name: "E209", kind: "room", building: EDU, polygon: rect(48, 410, 37, 45) },
            { id: "e2-west-hall", name: "Education Upper West Hall", kind: "hall", building: EDU, polygon: rect(85, 365, 23, 105) },
            { id: "e2-218", name: "E218", kind: "room", building: EDU, polygon: rect(108, 365, 45, 45) },
            { id: "e2-217", name: "E217", kind: "room", building: EDU, polygon: rect(153, 365, 60, 45) },
            { id: "e2-221", name: "E221", kind: "room", building: EDU, polygon: rect(108, 410, 45, 45) },
            { id: "e2-222", name: "E222", kind: "room", building: EDU, polygon: rect(153, 410, 60, 45) },
            { id: "e2-restrooms", name: "Upper Restrooms", kind: "room", building: EDU, polygon: rect(108, 455, 45, 15) },
            { id: "e2-storage", name: "Upper Storage (XDF-L)", kind: "room", building: EDU, polygon: rect(153, 455, 60, 15) },
            { id: "e2-south-hall", name: "Education Upper South Hall", kind: "hall", building: EDU, polygon: rect(48, 470, 165, 15) },
            { id: "e2-203", name: "E203", kind: "room", building: EDU, polygon: rect(48, 485, 47, 50) },
            { id: "e2-202", name: "E202", kind: "room", building: EDU, polygon: rect(95, 485, 33, 50) },
            { id: "e2-201", name: "E201", kind: "room", building: EDU, polygon: rect(128, 485, 37, 50) },
            { id: "e2-200", name: "E200", kind: "room", building: EDU, polygon: rect(165, 485, 48, 50) },
            { id: "e2-bridge", name: "Skybridge", kind: "hall", polygon: rect(213, 470, 105, 20) },
            // Sanctuary — level 2
            { id: "s2-north", name: "Upper North Hall", kind: "hall", building: SAN, polygon: rect(318, 268, 359, 50) },
            { id: "s2-balcony", name: "Balcony", kind: "common", building: SAN, polygon: poly(345, 318, 655, 318, 655, 470, 605, 470, 560, 420, 440, 420, 395, 470, 345, 470) },
            { id: "s2-west", name: "Upper West Concourse", kind: "hall", building: SAN, polygon: rect(318, 318, 27, 222) },
            { id: "s2-east", name: "Upper East Concourse", kind: "hall", building: SAN, polygon: rect(655, 318, 22, 222) },
            { id: "s2-west-rooms", name: "MDF / West Upper Rooms", kind: "room", building: SAN, polygon: rect(345, 470, 80, 70) },
            { id: "s2-east-rooms", name: "S232 / East Upper Rooms", kind: "room", building: SAN, polygon: rect(575, 470, 80, 70) },
            { id: "s2-south-hall", name: "Upper South Hall", kind: "hall", building: SAN, polygon: rect(425, 520, 150, 40) },
            { id: "s2-sw", name: "Tiered Classroom (SW)", kind: "room", building: SAN, polygon: rect(318, 540, 110, 115) },
            { id: "s2-238", name: "S238/239", kind: "room", building: SAN, polygon: rect(428, 560, 90, 95) },
            { id: "s2-236", name: "S236/237", kind: "room", building: SAN, polygon: rect(518, 560, 80, 95) },
            { id: "s2-se", name: "S228 / S233/235", kind: "room", building: SAN, polygon: rect(598, 540, 79, 115) },
          ],
          cameras: [],
          doors: [
          ],
          displays: [],
        },
      ],
    },
  ],
};
