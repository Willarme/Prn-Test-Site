import { existsSync } from "node:fs";
import { join } from "node:path";

/**
 * THE PDF — a real one, rendered by a real Chrome (campaign track P1,
 * 2026-09-05; Melissa's checklist A1: "Is this a generated PDF or
 * window.print()?" — it is a generated PDF).
 *
 * The pinned project dependency `puppeteer-core` uses an installed Chrome or
 * Edge, or PRN_PDF_BROWSER_PATH when explicitly configured. No other checkout
 * or user's home path is needed. When the browser is missing this returns null and
 * the route falls back to the print view (`/packet/<id>?print=1`), so the
 * homeowner still gets a document. The browser is launched once per process
 * and reused; a disconnect resets the cache.
 *
 * THE BUNDLER SEAM. Next's webpack rewrites `require` and even parses the
 * argument of `createRequire` ("module.createRequire failed parsing
 * argument" — seen live on 2026-09-05), so the real Node `module` is reached
 * through `process.getBuiltinModule` (Node 22.3+), which the bundler cannot
 * see through, and puppeteer-core loads in Node's own module system outside
 * the bundle graph.
 */
export function pdfBrowserPath(): string | null {
  const configured = process.env.PRN_PDF_BROWSER_PATH;
  if (configured) return existsSync(configured) ? configured : null;
  const paths = process.platform === "win32" ? [
    join(process.env.PROGRAMFILES || "C:/Program Files", "Google/Chrome/Application/chrome.exe"),
    join(process.env["PROGRAMFILES(X86)"] || "C:/Program Files (x86)", "Microsoft/Edge/Application/msedge.exe"),
    ...(process.env.LOCALAPPDATA ? [join(process.env.LOCALAPPDATA, "Google/Chrome/Application/chrome.exe")] : []),
  ] : process.platform === "darwin" ? [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ] : ["/usr/bin/google-chrome", "/usr/bin/chromium", "/usr/bin/chromium-browser"];
  return paths.find(existsSync) ?? null;
}

interface PuppeteerPage {
  setContent(html: string, opts?: { waitUntil?: string; timeout?: number }): Promise<void>;
  emulateMediaType(type: string): Promise<void>;
  pdf(opts: Record<string, unknown>): Promise<Uint8Array>;
  close(): Promise<void>;
}
interface PuppeteerBrowser {
  newPage(): Promise<PuppeteerPage>;
  close(): Promise<void>;
  on(event: string, handler: () => void): void;
  connected?: boolean;
}
interface PuppeteerModule {
  launch(opts: Record<string, unknown>): Promise<PuppeteerBrowser>;
}

let browserPromise: Promise<PuppeteerBrowser> | null = null;

export function pdfRendererAvailable(): boolean {
  if (process.env.PRN_PDF_DISABLED === "1") return false;
  return Boolean(pdfBrowserPath() && loadPuppeteer());
}

function nodeRequire(): ((id: string) => unknown) | null {
  const proc = process as unknown as { getBuiltinModule?: (name: string) => unknown };
  const mod = proc.getBuiltinModule?.("node:module") as
    | { createRequire: (from: string) => (id: string) => unknown }
    | undefined;
  if (!mod) return null;
  return mod.createRequire(`${process.cwd()}/package.json`);
}

function loadPuppeteer(): PuppeteerModule | null {
  try {
    const req = nodeRequire();
    if (!req) return null;
    const specifier = "puppeteer-core";
    return req(specifier) as PuppeteerModule;
  } catch {
    return null;
  }
}

async function browser(): Promise<PuppeteerBrowser | null> {
  if (browserPromise) return browserPromise;
  const puppeteer = loadPuppeteer();
  if (!puppeteer) return null;
  browserPromise = puppeteer
    .launch({
      executablePath: pdfBrowserPath(),
      headless: true,
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--font-render-hinting=none"],
    })
    .then((b) => {
      b.on("disconnected", () => {
        browserPromise = null;
      });
      return b;
    })
    .catch((err) => {
      browserPromise = null;
      throw err;
    });
  return browserPromise;
}

/**
 * Render the packet HTML to PDF bytes. Letter, backgrounds on, the page's own
 * @page rules honoured. Null when the renderer is unavailable or fails —
 * never throws into the customer path.
 */
export async function renderPacketPdf(html: string): Promise<Buffer | null> {
  if (!pdfRendererAvailable()) return null;
  let page: PuppeteerPage | null = null;
  try {
    const b = await browser();
    if (!b) return null;
    page = await b.newPage();
    // "load" rather than networkidle: the Google Fonts link is optional
    // decoration and an offline machine must not hang the PDF on it.
    await page.setContent(html, { waitUntil: "load", timeout: 20_000 });
    await page.emulateMediaType("print");
    const bytes = await page.pdf({
      format: "Letter",
      printBackground: true,
      preferCSSPageSize: true,
      margin: { top: "0.4in", right: "0.4in", bottom: "0.4in", left: "0.4in" },
    });
    return Buffer.from(bytes);
  } catch {
    return null;
  } finally {
    if (page) await page.close().catch(() => {});
  }
}

/** Test/shutdown seam. */
export async function closePdfRenderer(): Promise<void> {
  const p = browserPromise;
  browserPromise = null;
  if (p) await p.then((b) => b.close()).catch(() => {});
}

/** Count `/Type /Page` objects (not `/Pages`) — how the live check counts pages. */
export function countPdfPages(pdf: Buffer): number {
  const text = pdf.toString("latin1");
  const matches = text.match(/\/Type\s*\/Page(?![s\w])/g);
  return matches ? matches.length : 0;
}
