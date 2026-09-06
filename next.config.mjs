/* global process */
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Per-track build directories (campaign track F2b, 2026-09-05): parallel dev
  // servers compiling against the SAME .next directory contend and time out,
  // so each one sets NEXT_DIST_DIR=.next-<track>. Unset means the default.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Runtime-read data files must ship inside the serverless bundle. The door
  // page (GET /problems/ac-blowing-warm-air) is read from content/doors/ at
  // request time and would otherwise be missing from the deploy (F1 flagged it).
  outputFileTracingIncludes: {
    "/**": ["./data/seo-factory-policy.json", "./content/doors/**", "./content/door-template/v43/**"],
  },
};

export default nextConfig;
