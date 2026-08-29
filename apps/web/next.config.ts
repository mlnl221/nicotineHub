import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  ...(process.env.VERCEL ? {} : { output: "standalone" as const }),
};

export default nextConfig;
