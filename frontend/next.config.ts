import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactCompiler: true,
  reactStrictMode: false,
  output: process.env.NODE_ENV === "production" ? "standalone" : undefined,
  // Allow LAN devices (friends on the same WiFi) to load dev resources/HMR.
  allowedDevOrigins: ["192.168.86.35"],
};

export default nextConfig;
