import { rect, type SiteConfig } from "../../lib/core/site.ts";

/**
 * CCC — first client site.
 *
 * PLACEHOLDER LAYOUT: rooms, camera positions and door ids below are a stand-in
 * until we have CCC's real floor plans and device lists. To map the real site:
 *   1. Drop floor plan images in /public/floorplans and set `background`.
 *   2. Trace zones over them (rect() for simple rooms, or point lists).
 *   3. Set each camera's `source.externalId` to its Blue Iris short name and each
 *      door's to its UniFi Access door id (the console's Integrations page lists both).
 */

const blueiris = (externalId: string) => ({ integration: "cameras", externalId });
const unifi = (externalId: string) => ({ integration: "doors", externalId });
const smart = (externalId: string) => ({ integration: "displays", externalId });

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
      id: "displays",
      driver: "smart-displays",
      name: "SMART Boards",
      settings: { sendUrl: { env: "SMART_SEND_URL" }, token: { env: "SMART_TOKEN" } },
    },
  ],
  passages: [
    { between: ["hall-1w", "hall-1e"], seconds: 10 },
    { between: ["hall-2w", "hall-2e"], seconds: 10 },
    { between: ["stair-1", "stair-2"], seconds: 20 },
  ],
  buildings: [
    {
      id: "main",
      name: "Main Building",
      floors: [
        {
          id: "f1",
          name: "Floor 1",
          width: 1000,
          height: 700,
          zones: [
            { id: "front-drive", name: "Front Drive", kind: "outdoor", polygon: rect(40, 610, 920, 80) },
            { id: "lobby", name: "Main Lobby", kind: "entry", polygon: rect(420, 480, 160, 120) },
            { id: "office", name: "Front Office", kind: "office", polygon: rect(260, 480, 160, 120) },
            { id: "nurse", name: "Nurse", kind: "office", polygon: rect(60, 480, 200, 120) },
            { id: "room-103", name: "Room 103", kind: "room", polygon: rect(580, 480, 180, 120) },
            { id: "room-104", name: "Room 104", kind: "room", polygon: rect(760, 480, 180, 120) },
            { id: "hall-1w", name: "Main Hall West", kind: "hall", polygon: rect(60, 380, 440, 100) },
            { id: "hall-1e", name: "Main Hall East", kind: "hall", polygon: rect(500, 380, 440, 100) },
            { id: "gym", name: "Gymnasium", kind: "common", polygon: rect(60, 60, 300, 320) },
            { id: "room-101", name: "Room 101", kind: "room", polygon: rect(360, 60, 140, 320) },
            { id: "room-102", name: "Room 102", kind: "room", polygon: rect(500, 60, 140, 320) },
            { id: "kitchen", name: "Kitchen", kind: "room", polygon: rect(640, 60, 80, 200) },
            { id: "stair-1", name: "Stairwell A", kind: "stair", polygon: rect(640, 260, 80, 120) },
            { id: "cafeteria", name: "Cafeteria", kind: "common", polygon: rect(720, 60, 220, 320) },
            { id: "west-lot", name: "West Lot", kind: "outdoor", polygon: rect(0, 60, 40, 320) },
            { id: "east-yard", name: "East Yard", kind: "outdoor", polygon: rect(960, 60, 40, 320) },
          ],
          doors: [
            { id: "d-main", name: "Main Entrance", position: { x: 500, y: 600 }, between: ["front-drive", "lobby"], exterior: true, source: unifi("door-main-entrance") },
            { id: "d-vestibule", name: "Lobby → Hall", position: { x: 470, y: 480 }, between: ["lobby", "hall-1w"], source: unifi("door-lobby-inner") },
            { id: "d-office-lobby", name: "Office (lobby side)", position: { x: 420, y: 540 }, between: ["office", "lobby"] },
            { id: "d-office-hall", name: "Office (hall side)", position: { x: 340, y: 480 }, between: ["office", "hall-1w"], source: unifi("door-office") },
            { id: "d-nurse", name: "Nurse", position: { x: 160, y: 480 }, between: ["nurse", "hall-1w"] },
            { id: "d-103", name: "Room 103", position: { x: 670, y: 480 }, between: ["room-103", "hall-1e"] },
            { id: "d-104", name: "Room 104", position: { x: 850, y: 480 }, between: ["room-104", "hall-1e"] },
            { id: "d-gym", name: "Gym (hall)", position: { x: 210, y: 380 }, between: ["gym", "hall-1w"] },
            { id: "d-gym-ext", name: "Gym Exterior", position: { x: 40, y: 220 }, between: ["gym", "west-lot"], exterior: true, source: unifi("door-gym-exterior") },
            { id: "d-101", name: "Room 101", position: { x: 430, y: 380 }, between: ["room-101", "hall-1w"] },
            { id: "d-102", name: "Room 102", position: { x: 570, y: 380 }, between: ["room-102", "hall-1e"] },
            { id: "d-stair-1", name: "Stairwell A (F1)", position: { x: 680, y: 380 }, between: ["stair-1", "hall-1e"] },
            { id: "d-cafe", name: "Cafeteria", position: { x: 830, y: 380 }, between: ["cafeteria", "hall-1e"] },
            { id: "d-kitchen", name: "Kitchen", position: { x: 720, y: 160 }, between: ["kitchen", "cafeteria"] },
            { id: "d-cafe-ext", name: "Cafeteria Exterior", position: { x: 960, y: 220 }, between: ["cafeteria", "east-yard"], exterior: true, source: unifi("door-cafeteria-exterior") },
          ],
          cameras: [
            { id: "c-front-drive", name: "Front Drive", position: { x: 500, y: 690 }, heading: 0, fov: 120, covers: ["front-drive"], source: blueiris("FrontDrive") },
            { id: "c-lobby", name: "Lobby", position: { x: 575, y: 595 }, heading: 315, fov: 90, covers: ["lobby"], source: blueiris("Lobby") },
            { id: "c-office", name: "Front Office", position: { x: 265, y: 595 }, heading: 45, fov: 90, covers: ["office"], source: blueiris("Office") },
            { id: "c-hall-1w", name: "Main Hall West", position: { x: 65, y: 430 }, heading: 90, fov: 60, covers: ["hall-1w"], source: blueiris("HallWest") },
            { id: "c-hall-1e", name: "Main Hall East", position: { x: 935, y: 430 }, heading: 270, fov: 60, covers: ["hall-1e"], source: blueiris("HallEast") },
            { id: "c-gym", name: "Gymnasium", position: { x: 210, y: 65 }, heading: 180, fov: 100, covers: ["gym"], source: blueiris("Gym") },
            { id: "c-cafeteria", name: "Cafeteria", position: { x: 830, y: 65 }, heading: 180, fov: 100, covers: ["cafeteria"], source: blueiris("Cafeteria") },
            { id: "c-stair-1", name: "Stairwell A (F1)", position: { x: 715, y: 265 }, heading: 225, fov: 80, covers: ["stair-1"], source: blueiris("StairA1") },
            { id: "c-west-lot", name: "West Lot", position: { x: 20, y: 65 }, heading: 180, fov: 70, covers: ["west-lot"], source: blueiris("WestLot") },
            { id: "c-east-yard", name: "East Yard", position: { x: 980, y: 375 }, heading: 0, fov: 70, covers: ["east-yard"], source: blueiris("EastYard") },
          ],
          displays: [
            { id: "s-101", name: "Room 101 Board", position: { x: 430, y: 70 }, zoneId: "room-101", source: smart("room-101") },
            { id: "s-102", name: "Room 102 Board", position: { x: 570, y: 70 }, zoneId: "room-102", source: smart("room-102") },
            { id: "s-103", name: "Room 103 Board", position: { x: 670, y: 590 }, zoneId: "room-103", source: smart("room-103") },
            { id: "s-104", name: "Room 104 Board", position: { x: 850, y: 590 }, zoneId: "room-104", source: smart("room-104") },
            { id: "s-cafe", name: "Cafeteria Board", position: { x: 900, y: 200 }, zoneId: "cafeteria", source: smart("cafeteria") },
          ],
        },
        {
          id: "f2",
          name: "Floor 2",
          width: 1000,
          height: 700,
          zones: [
            { id: "room-201", name: "Room 201", kind: "room", polygon: rect(60, 60, 290, 320) },
            { id: "room-202", name: "Room 202", kind: "room", polygon: rect(350, 60, 290, 320) },
            { id: "stair-2", name: "Stairwell A (F2)", kind: "stair", polygon: rect(640, 260, 80, 120) },
            { id: "library", name: "Library", kind: "common", polygon: rect(720, 60, 220, 320) },
            { id: "hall-2w", name: "Upper Hall West", kind: "hall", polygon: rect(60, 380, 440, 100) },
            { id: "hall-2e", name: "Upper Hall East", kind: "hall", polygon: rect(500, 380, 440, 100) },
            { id: "room-203", name: "Room 203", kind: "room", polygon: rect(60, 480, 440, 120) },
            { id: "room-204", name: "Room 204", kind: "room", polygon: rect(500, 480, 440, 120) },
          ],
          doors: [
            { id: "d-201", name: "Room 201", position: { x: 200, y: 380 }, between: ["room-201", "hall-2w"] },
            { id: "d-202", name: "Room 202", position: { x: 490, y: 380 }, between: ["room-202", "hall-2w"] },
            { id: "d-stair-2", name: "Stairwell A (F2)", position: { x: 680, y: 380 }, between: ["stair-2", "hall-2e"] },
            { id: "d-library", name: "Library", position: { x: 830, y: 380 }, between: ["library", "hall-2e"] },
            { id: "d-203", name: "Room 203", position: { x: 280, y: 480 }, between: ["room-203", "hall-2w"] },
            { id: "d-204", name: "Room 204", position: { x: 720, y: 480 }, between: ["room-204", "hall-2e"] },
          ],
          cameras: [
            { id: "c-hall-2w", name: "Upper Hall West", position: { x: 65, y: 430 }, heading: 90, fov: 60, covers: ["hall-2w"], source: blueiris("UpperHallWest") },
            { id: "c-hall-2e", name: "Upper Hall East", position: { x: 935, y: 430 }, heading: 270, fov: 60, covers: ["hall-2e"], source: blueiris("UpperHallEast") },
            { id: "c-stair-2", name: "Stairwell A (F2)", position: { x: 715, y: 265 }, heading: 225, fov: 80, covers: ["stair-2"], source: blueiris("StairA2") },
            { id: "c-library", name: "Library", position: { x: 830, y: 65 }, heading: 180, fov: 100, covers: ["library"], source: blueiris("Library") },
          ],
          displays: [
            { id: "s-201", name: "Room 201 Board", position: { x: 200, y: 70 }, zoneId: "room-201", source: smart("room-201") },
            { id: "s-202", name: "Room 202 Board", position: { x: 490, y: 70 }, zoneId: "room-202", source: smart("room-202") },
            { id: "s-203", name: "Room 203 Board", position: { x: 280, y: 590 }, zoneId: "room-203", source: smart("room-203") },
            { id: "s-204", name: "Room 204 Board", position: { x: 720, y: 590 }, zoneId: "room-204", source: smart("room-204") },
            { id: "s-library", name: "Library Board", position: { x: 900, y: 200 }, zoneId: "library", source: smart("library") },
          ],
        },
      ],
    },
  ],
};
