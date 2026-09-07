import { existsSync } from "node:fs";
import { join } from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer-core";

/**
 * THE PDF — a real one, rendered by a real Chrome (campaign track P1,
 * 2026-09-05; Melissa's checklist A1: "Is this a generated PDF or
 * window.print()?" — it is a generated PDF).
 *
 * The pinned Puppeteer/Chromium pair uses bundled Linux x64 headless Chromium
 * on Vercel/Lambda, or installed Chrome/Edge locally. An explicit
 * PRN_PDF_BROWSER_PATH takes precedence. No browser downloads occur here.
 * When the browser is missing this returns null and
 * the route falls back to the print view (`/packet/<id>?print=1`), so the
 * homeowner still gets a document. The browser is launched once per process
 * and reused; a disconnect resets the cache.
 *
 * Both packages are explicit external imports in Next, with their runtime
 * closure and Chromium assets included by tools/pdf-runtime-tracing.mjs.
 * The bundled browser requires Node 22.17+ or Node 24+ and Linux x64.
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

let browserPromise: Promise<Browser> | null = null;

/** An explicit missing local path is an error, never a silent backend change. */
export function pdfRuntimeKind(): "local" | "serverless" | "unavailable" {
  if (process.env.PRN_PDF_DISABLED === "1") return "unavailable";
  if (process.env.PRN_PDF_BROWSER_PATH) return pdfBrowserPath() ? "local" : "unavailable";
  const serverless = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME || process.env.AWS_EXECUTION_ENV);
  if (serverless) {
    const [major, minor] = process.versions.node.split(".").map(Number);
    const supportedNode = major >= 24 || (major === 22 && minor >= 17);
    return supportedNode && process.platform === "linux" && process.arch === "x64" ? "serverless" : "unavailable";
  }
  return pdfBrowserPath() ? "local" : "unavailable";
}

export function pdfRendererAvailable(): boolean {
  return pdfRuntimeKind() !== "unavailable";
}

async function browser(): Promise<Browser | null> {
  if (browserPromise) return browserPromise;
  const kind = pdfRuntimeKind();
  if (kind === "unavailable") return null;
  browserPromise = (async () => {
    if (kind === "serverless") {
      const { default: chromium } = await import("@sparticuz/chromium");
      return puppeteer.launch({
        executablePath: await chromium.executablePath(),
        headless: "shell",
        args: await puppeteer.defaultArgs({ args: chromium.args, headless: "shell" }),
      });
    }
    return puppeteer.launch({
      executablePath: pdfBrowserPath()!, headless: true,
      args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage", "--font-render-hinting=none"],
    });
  })()
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
  let page: Page | null = null;
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
