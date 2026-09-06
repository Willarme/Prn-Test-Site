/** Deliberate live local-demo check. Uses synthetic data only; the running
 * `npm run demo` server owns credentials. No email is delivered in preview mode. */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { ACTIVE_DISCLOSURE } from "@/domain/privacy/disclosures";

async function main() {
  const origin = "http://localhost:3188";
  const root = path.join(process.cwd(), "data/runtime/missy-demo-20260905");
  const fixture = process.argv[2];
  if (!fixture) throw new Error("Pass a synthetic equipment-label JPEG path.");
  const startedAt = new Date().toISOString();
  const start = await fetch(`${origin}/api/intake`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ description: "My air conditioner is blowing warm air since yesterday.", disclosure_content_hash: ACTIVE_DISCLOSURE.content_hash,
      attribution: { page_id: null, intent_cluster_id: null, search_opportunity_id: null, problem_family_hint: "hvac", experiment_id: null, variant: null, referrer: null, landing_path: "/problems/ac-blowing-warm-air" } }),
  });
  const started = await start.json();
  if (!start.ok || !started.request_id) throw new Error("Synthetic intake did not start.");
  const cookie = start.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
  const requestId = started.request_id as string;
  const upload = new FormData();
  upload.set("request_id", requestId); upload.set("target", "unit_model_serial");
  upload.set("file", new File([readFileSync(fixture)], "synthetic-nameplate.jpg", { type: "image/jpeg" }));
  const attached = await fetch(`${origin}/api/intake/media`, { method: "POST", headers: { Cookie: cookie }, body: upload });
  const attachedBody = await attached.json();
  const complete = await fetch(`${origin}/complete/${requestId}`, { headers: { Cookie: cookie } });
  const html = await complete.text();
  const labelFile = path.join(root, "label-reads", `${requestId}.json`);
  const labels = (() => { try { return JSON.parse(readFileSync(labelFile, "utf8")); } catch { return []; } })();
  const runs = readdirSync(path.join(root, "agent-runs")).map(file => JSON.parse(readFileSync(path.join(root, "agent-runs", file), "utf8")))
    .filter(run => run.created_at >= startedAt.slice(0, 19) && run.tool_provider === "openrouter")
    .map(run => ({ run_id: run.run_id, capability: run.capabilities_used, model: run.tool_model_version, latency_ms: run.latency_ms, cost_usd: run.cost_usd }));
  const report = { started_at: startedAt, request_id: requestId, intake_status: start.status, upload_status: attached.status, upload_saved: attachedBody.ok === true,
    complete_status: complete.status, label_confidence: labels.map((entry: { run_id: string; confidence: unknown }) => ({ run_id: entry.run_id, confidence: entry.confidence })),
    held: { brand: /carrier/i.test(html), model: html.includes("24ABC636A003"), serial: html.includes("4021E19845") }, model_runs: runs };
  writeFileSync(path.join(root, "live-loop-proof.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (!report.upload_saved || !labels.length || !report.held.brand || !report.held.model || !report.held.serial) process.exitCode = 1;
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Live check failed"); process.exitCode = 1; });
