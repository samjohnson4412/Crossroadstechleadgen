import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // ssh2 uses dynamic requires that break when bundled — load it natively
  serverExternalPackages: ["ssh2", "ssh2-sftp-client"],
};

export default nextConfig;
