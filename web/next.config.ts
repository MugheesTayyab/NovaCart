import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  // The policy files live one level up, in /policies. Let file tracing see them.
  outputFileTracingRoot: path.join(__dirname, ".."),
  outputFileTracingIncludes: { "/**": ["../policies/**/*.md"] },
};

export default nextConfig;
