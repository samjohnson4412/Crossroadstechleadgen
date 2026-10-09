import { algoDriver } from "./algo.ts";
import { blueIrisDriver } from "./blueiris.ts";
import { identipassDriver } from "./identipass.ts";
import { saferWatchDriver } from "./saferwatch.ts";
import { simulatorDriver } from "./simulator.ts";
import { smartDisplaysDriver } from "./smart-displays.ts";
import type { IntegrationDriver } from "./types.ts";
import { unifiAccessDriver } from "./unifi-access.ts";

/**
 * Every driver the platform knows. To support a new product (UniFi Protect,
 * Verkada, Genetec, Milestone, a PA system, ...) implement IntegrationDriver
 * and add it here; sites then reference it by `driver` id in their config.
 */
export const drivers: Record<string, IntegrationDriver> = Object.fromEntries(
  [blueIrisDriver, unifiAccessDriver, identipassDriver, algoDriver, saferWatchDriver, smartDisplaysDriver, simulatorDriver].map((d) => [d.id, d]),
);
