import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A static site: every route is an HTML entry point for the same client app,
  // served from Firebase Hosting next to the Firestore backend.
  output: "export",
  images: { unoptimized: true },
  devIndicators: false,
  // A package-lock.json in a parent folder would otherwise be taken as the root.
  turbopack: { root: __dirname },
};

export default nextConfig;
