import { cookies } from "next/headers";
import { HOSTED_SAMPLE_COOKIE, parseHostedSampleState, renderHostedSamplePacket } from "@/domain/demo/hosted-sample";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const state = parseHostedSampleState((await cookies()).get(HOSTED_SAMPLE_COOKIE)?.value);
  const rendered = renderHostedSamplePacket(new URL(request.url).origin, state);
  const toolbar = `<nav class="sample-toolbar" aria-label="Prepared sample packet"><strong>Prepared AC example</strong><span>${state.trail.length ? "This view includes your sample choices." : "An invented home and its example observations."} The download is the original prepared PDF.</span><a href="/demo/sample/results">Back to results</a><a href="/demo/sample/walkthrough">Try guided checks</a><a href="/demo/sample/packet.pdf">Download prepared PDF</a><button type="button" onclick="window.print()">Print this view</button></nav><style>.sample-toolbar{display:flex;flex-wrap:wrap;gap:12px 20px;align-items:center;padding:18px 24px;background:#eaf3f1;color:#234d54;font:14px/1.5 system-ui}.sample-toolbar a{color:inherit}.sample-toolbar button{font:inherit;padding:8px 12px;border:1px solid #285f68;background:white;border-radius:4px}.sample-toolbar span{flex-basis:100%}@media print{.sample-toolbar{display:none}}</style>`;
  return new Response(rendered.html.replace("<body>", `<body>${toolbar}`), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" } });
}
