import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { HOSTED_SAMPLE_COOKIE, emptyHostedSampleState, hostedWalkthrough, parseHostedSampleState } from "@/domain/demo/hosted-sample";

async function readChoice(request: Request): Promise<URLSearchParams | null> {
  if (!(request.headers.get("content-type") ?? "").startsWith("application/x-www-form-urlencoded") || request.headers.has("content-encoding")) return null;
  const length = request.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > 1024)) return null;
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Choice timed out")), 5000); });
  try {
    while (true) {
      const part = await Promise.race([reader.read(), timeout]);
      if (part.done) break;
      total += part.value.byteLength;
      if (total > 1024) { void reader.cancel().catch(() => {}); return null; }
      chunks.push(part.value);
    }
    return new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
  } catch { void reader.cancel().catch(() => {}); return null; }
  finally { clearTimeout(timer); reader.releaseLock(); }
}

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin || request.headers.get("sec-fetch-site") === "cross-site") return new Response("Start from the sample page.", { status: 403 });
  const form = await readChoice(request);
  if (!form || [...form.keys()].some(key => !["action", "answer", "step"].includes(key) || form.getAll(key).length !== 1)) return new Response("Choose one of the sample options.", { status: 400 });
  const action = form.get("action");
  let state = parseHostedSampleState((await cookies()).get(HOSTED_SAMPLE_COOKIE)?.value);
  let destination = "/demo/sample/walkthrough";
  if (action === "reset") state = emptyHostedSampleState();
  else if (action === "keep") { state = { ...state, kept: true }; destination = "/demo/sample/keep"; }
  else if (action === "answer") {
    const current = hostedWalkthrough(state.trail);
    const answer = form.get("answer") ?? "";
    if (!current?.step || current.step.step_id !== form.get("step") || !current.choices.includes(answer) || state.trail.length >= 20 || !hostedWalkthrough([...state.trail, answer])) return new Response("This sample step has changed. Return to the walkthrough.", { status: 409 });
    state = { ...state, trail: [...state.trail, answer] };
  } else return new Response("Unknown sample action.", { status: 400 });
  const response = new NextResponse(null, { status: 303, headers: { Location: destination, "Cache-Control": "private, no-store" } });
  response.cookies.set(HOSTED_SAMPLE_COOKIE, JSON.stringify(state), { path: "/demo/sample", httpOnly: true, secure: new URL(request.url).protocol === "https:", sameSite: "lax", maxAge: 86400 });
  return response;
}
