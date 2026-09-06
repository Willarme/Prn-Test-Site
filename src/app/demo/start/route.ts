import { NextResponse } from "next/server";
import { createDemoSample, demoSamplesEnabled } from "@/domain/demo/sample";
import { reserveDemoSample } from "@/domain/demo/admission";
import { demoAwareOrigin } from "@/platform/demo-origin";

export const dynamic = "force-dynamic";
const BODY_LIMIT = 1024;
const BODY_TIMEOUT_MS = 10_000;
class SampleBodyTimeout extends Error {}

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

async function boundedBody(request: Request): Promise<string | null> {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > BODY_LIMIT)) return null;
  const reader = request.body?.getReader();
  if (!reader) return "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  const drain = async () => {
    let total = 0;
    const chunks: Uint8Array[] = [];
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > BODY_LIMIT) { void reader.cancel().catch(() => {}); return null; }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  };
  try {
    return await Promise.race([drain(), new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new SampleBodyTimeout());
        void reader.cancel().catch(() => {});
      }, BODY_TIMEOUT_MS);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (request.headers.get("sec-fetch-site") === "cross-site" || (origin && origin !== demoAwareOrigin(request))) {
    return error("Start the sample from this demo page.", 403);
  }
  if (request.headers.get("purpose") === "prefetch" || request.headers.get("sec-purpose")?.includes("prefetch")) {
    return error("Use the sample button to begin.", 405);
  }
  if ((request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase() !== "application/x-www-form-urlencoded") {
    return error("Use the sample form to begin.", 415);
  }
  let text: string | null;
  try { text = await boundedBody(request); }
  catch (failure) {
    return failure instanceof SampleBodyTimeout
      ? error("The sample form timed out. Please try again.", 408)
      : error("The sample form could not be read.", 400);
  }
  if (text === null) return error("Sample form is too large.", 413);
  const form = new URLSearchParams(text);
  if ([...form.keys()].some(key => key !== "intent") || form.getAll("intent").length > 1) {
    return error("Invalid sample choice.", 400);
  }
  const intent = form.get("intent") ?? "results";
  if (intent !== "results" && intent !== "guided") return error("Invalid sample choice.", 400);
  // A hosted prepared sample has no customer record or owner capability. It
  // must remain usable when the separate local, stateful demo is not enabled.
  // Validate the same bounded form before redirecting; never fall through to
  // production storage or enable a per-instance /tmp database on Vercel.
  if (!demoSamplesEnabled()) {
    return new NextResponse(null, { status: 303, headers: {
      Location: `/demo/sample/${intent === "guided" ? "walkthrough" : "results"}`,
      "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow",
      "Referrer-Policy": "no-referrer",
    } });
  }
  if (!reserveDemoSample()) return error("The sample limit has been reached. Please try again later.", 429);
  try {
    const { requestId, cookie } = await createDemoSample();
    const response = new NextResponse(null, { status: 303, headers: {
      Location: `/${intent === "guided" ? "complete" : "results"}/${requestId}`,
      "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer",
    } });
    response.cookies.set(cookie.name, cookie.value, cookie.options);
    return response;
  } catch {
    return error("The sample could not be prepared. Please try again shortly.", 503);
  }
}
