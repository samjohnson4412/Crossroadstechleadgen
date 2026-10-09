/**
 * Site model: the physical layout of a campus and where every device sits in it.
 *
 * This is deliberately vendor-neutral. A camera on the map is just "a camera in
 * zone X"; which system actually serves its video (Blue Iris today, UniFi Protect
 * tomorrow) is a `DeviceRef` pointing at a configured integration. Swapping
 * vendors means changing refs, not the map or the tracking logic.
 */

/** A point in floor-plan units. Each floor defines its own width/height. */
export interface Point {
  x: number;
  y: number;
}

/** Points at a specific device inside a configured integration. */
export interface DeviceRef {
  /** Id of an entry in `SiteConfig.integrations`. */
  integration: string;
  /** The device's id in that vendor's system (Blue Iris short name, UniFi door id, ...). */
  externalId: string;
}

export type ZoneKind =
  | "room"
  | "hall"
  | "stair"
  | "entry"
  | "office"
  | "outdoor"
  | "common";

export interface Zone {
  id: string;
  name: string;
  kind: ZoneKind;
  polygon: Point[];
}

export interface CameraPlacement {
  id: string;
  name: string;
  position: Point;
  /** Direction the camera faces, degrees clockwise from "up" on the plan. */
  heading?: number;
  /** Horizontal field of view in degrees (for drawing the view cone). */
  fov?: number;
  /** Zones this camera can see. Drives "which cameras show this area" and tracking. */
  covers: string[];
  source: DeviceRef;
}

export interface DoorPlacement {
  id: string;
  name: string;
  position: Point;
  /** The two zones this door connects. Defines walkable adjacency. */
  between: [string, string];
  exterior?: boolean;
  /** Present when the door is wired to an access control system. */
  source?: DeviceRef;
}

export interface DisplayPlacement {
  id: string;
  name: string;
  position: Point;
  zoneId: string;
  source: DeviceRef;
}

export interface Floor {
  id: string;
  name: string;
  width: number;
  height: number;
  /** Optional floor plan image (URL under /public) drawn beneath the zones. */
  background?: string;
  zones: Zone[];
  cameras: CameraPlacement[];
  doors: DoorPlacement[];
  displays: DisplayPlacement[];
}

export interface Building {
  id: string;
  name: string;
  floors: Floor[];
}

/**
 * A walkable connection that isn't a door: an open archway, a hallway split
 * into two zones, a stairwell between floors.
 */
export interface Passage {
  between: [string, string];
  /** Roughly how long it takes to walk through, used for reachability. */
  seconds?: number;
}

/** A setting value may be literal or read from an environment variable at startup. */
export type SettingValue = string | number | boolean | { env: string; default?: string };

export interface IntegrationConfig {
  /** Stable id referenced by DeviceRefs. */
  id: string;
  /** Which driver implements it, e.g. "blueiris", "unifi-access". */
  driver: string;
  name: string;
  settings: Record<string, SettingValue>;
}

export interface SiteConfig {
  id: string;
  name: string;
  buildings: Building[];
  passages: Passage[];
  integrations: IntegrationConfig[];
}

/** What the browser receives: the layout without integration settings. */
export type PublicSite = Omit<SiteConfig, "integrations"> & {
  integrations: { id: string; driver: string; name: string }[];
};

export function toPublicSite(site: SiteConfig): PublicSite {
  return {
    ...site,
    integrations: site.integrations.map(({ id, driver, name }) => ({ id, driver, name })),
  };
}

/** Axis-aligned rectangle helper for authoring simple floor plans. */
export function rect(x: number, y: number, w: number, h: number): Point[] {
  return [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
}

export function centroid(polygon: Point[]): Point {
  const sum = polygon.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / polygon.length, y: sum.y / polygon.length };
}

export function bounds(polygon: Point[]) {
  const xs = polygon.map((p) => p.x);
  const ys = polygon.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  return { minX, minY, maxX: Math.max(...xs), maxY: Math.max(...ys), w: Math.max(...xs) - minX, h: Math.max(...ys) - minY };
}
