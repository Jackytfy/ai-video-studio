import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  serverExternalPackages: [
    "better-sqlite3",
    "@prisma/adapter-better-sqlite3",
    "@prisma/client",
    ".prisma/client",
  ],
  experimental: {
    // `bodySizeLimit` applies ONLY to Server Actions (useFormState etc.).
    // It does NOT affect App Router Route Handlers — those must enforce
    // their own Content-Length / stream-size checks (e.g. upload route).
    serverActions: {
      bodySizeLimit: "100mb",
    },
  },
};

export default nextConfig;
