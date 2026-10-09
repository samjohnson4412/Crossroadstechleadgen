import type { SiteConfig } from "../../lib/core/site.ts";
import { cccSite } from "./ccc.ts";

export const sites: Record<string, SiteConfig> = { ccc: cccSite };
