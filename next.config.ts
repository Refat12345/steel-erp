import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Allow mobile devices on the local network to access dev resources (HMR)
  allowedDevOrigins: ["10.1.2.24", "10.1.2.63", "10.2.0.2"],
};

export default nextConfig;
