/* global process */
import { ocrRuntimeTracePlan } from './tools/ocr-runtime-tracing.mjs';
import { pdfRuntimeTracePlan } from './tools/pdf-runtime-tracing.mjs';

const ocrRuntime = ocrRuntimeTracePlan();
const pdfRuntime = pdfRuntimeTracePlan();
/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['puppeteer-core', '@sparticuz/chromium'],
  // Per-track build directories (campaign track F2b, 2026-09-05): parallel dev
  // servers compiling against the SAME .next directory contend and time out,
  // so each one sets NEXT_DIST_DIR=.next-<track>. Unset means the default.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Local tests/development may leave files beside source. They are never
  // part of a serverless function, even when Next's file tracing sees them.
  outputFileTracingExcludes: {
    "**": ["./data/runtime/**/*", "./data/ai-policy.json", "./.env", "./.env.*", "./.private/**/*"],
  },
  // Runtime-read data files must ship inside the serverless bundle. The door
  // page (GET /problems/ac-blowing-warm-air) is read from content/doors/ at
  // request time and would otherwise be missing from the deploy (F1 flagged it).
  outputFileTracingIncludes: {
    "/**": ["./data/seo-factory-policy.json", "./content/doors/**", "./content/door-template/v43/**", "./content/door-template/amendments/**", "./config/ac-door*.json", "./content/source-evidence/**"],
    // Both upload paths can invoke the same isolated OCR child. Next cannot
    // follow that process into its worker, traineddata, WASM and native assets.
    ...Object.fromEntries(ocrRuntime.routes.map(route => [route, ocrRuntime.patterns])),
    ...Object.fromEntries(pdfRuntime.routes.map(route => [route, pdfRuntime.patterns])),
  },
};

export default nextConfig;
