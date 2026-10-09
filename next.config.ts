import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Integrations talk to on-prem devices (Blue Iris, UniFi) — this app runs as a
  // long-lived Node server on the site network, not as serverless functions.
  output: "standalone",
};

export default nextConfig;
