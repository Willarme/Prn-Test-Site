import { NextResponse } from "next/server";
import { createDemoSample, demoSamplesEnabled } from "@/domain/demo/sample";
import { reserveDemoSample } from "@/domain/demo/admission";
import { demoAwareOrigin } from "@/platform/demo-origin";

export const dynamic = "force-dynamic";
const BODY_LIMIT = 1024;

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

async function boundedBody(request: Request): Promise<string | null> {
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > BODY_LIMIT)) return null;
  const reader = request.body?.getReader();
  if (!reader) return "";
  let total = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > BODY_LIMIT) { await reader.cancel(); return null; }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

export async function GET() {
  return new NextResponse(null, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  if (!demoSamplesEnabled()) return error("Not found.", 404);
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
  const text = await boundedBody(request).catch(() => null);
  if (text === null) return error("Sample form is too large.", 413);
  const form = new URLSearchParams(text);
  if ([...form.keys()].some(key => key !== "intent") || form.getAll("intent").length > 1) {
    return error("Invalid sample choice.", 400);
  }
  const intent = form.get("intent") ?? "results";
  if (intent !== "results" && intent !== "guided") return error("Invalid sample choice.", 400);
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
