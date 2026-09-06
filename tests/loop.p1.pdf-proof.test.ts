import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { renderPacketHtml } from "@/domain/packet/render";
import { closePdfRenderer, countPdfPages, pdfRendererAvailable, renderPacketPdf } from "@/domain/packet/pdf";
import { referenceInput, thinInput } from "./loop.p1.fixtures";
import type { DirectionsInput } from "@/domain/packet/types";

const envKeys = ["PRN_DEV_DB_PATH", "PRN_RUNTIME_STORE", "LINK_SIGNING_SECRET"] as const;
const saved = Object.fromEntries(envKeys.map(k => [k, process.env[k]]));
let tokens: typeof import("@/platform/links/tokens");
const out = process.env.PRN_PACKET_PROOF_DIR || mkdtempSync(join(tmpdir(), "prn-packet-proof-"));
const origin = process.env.PRN_PACKET_PROOF_ORIGIN || "http://localhost:3210";

beforeAll(async () => {
  mkdirSync(out, { recursive: true });
  process.env.PRN_RUNTIME_STORE = "file";
  process.env.PRN_DEV_DB_PATH = join(out, "fixture-db.json");
  process.env.LINK_SIGNING_SECRET = "synthetic-packet-proof-not-a-deploy-key-2026";
  // A revocation ledger must exist before verifying links; missing durable
  // state is intentionally fail-closed in the repaired runtime store.
  const db = await import("@/platform/stores/dev-db");
  db.updateDevDb(() => {});
  const runtime = await import("@/platform/stores/runtime");
  runtime.resetRuntimeStore();
  tokens = await import("@/platform/links/tokens");
});
afterAll(async () => {
  await closePdfRenderer();
  for (const key of envKeys) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

/** Real paper counts: print columns and spacing must satisfy the contract. */
describe("actual PDF acceptance: rich / thin / halted, request-bound QR links", () => {
  for (const [name, pages] of [["rich", 3], ["thin", 3], ["halted", 1]] as const) {
    it(`${name} emits exactly ${pages} real PDF page(s) with the expected scoped targets`, async () => {
      expect(pdfRendererAvailable(), "Install the configured PDF runtime; this proof must not silently skip").toBe(true);
      const input: DirectionsInput = name === "thin" ? thinInput() : referenceInput();
      const requestId = `rq_pdf_proof_${name}`;
      if (name === "halted") input.problem.homeowner_words = "I smell gas near the furnace.";
      const keep = tokens.signLink({ scope: "keep", request_id: requestId });
      const ask = tokens.signLink({ scope: "ask", request_id: requestId });
      const media = tokens.signLink({ scope: "media", request_id: requestId });
      input.config.link_base = origin;
      input.config.home_memory_url = `${origin}/keep/${keep}`;
      input.config.trust_network_url = `${origin}/ask/${ask}`;
      input.config.media_link = `${origin}/media/${media}`;
      for (const [scope, token] of [["keep", keep], ["ask", ask], ["media", media]] as const) {
        const decoded = await tokens.verifyLink(token, scope);
        expect(decoded.ok).toBe(true);
        if (decoded.ok) expect(decoded.request_id).toBe(requestId);
      }
      const rendered = renderPacketHtml(input);
      expect(rendered.self_check).toMatchObject({ ok: true, failures: [] });
      expect(rendered.halted).toBe(name === "halted");
      writeFileSync(join(out, `${name}.html`), rendered.html);
      writeFileSync(join(out, `${name}-links.json`), JSON.stringify({ request_id: requestId, keep: input.config.home_memory_url, ask: input.config.trust_network_url }, null, 2));
      const pdf = await renderPacketPdf(rendered.html);
      expect(pdf).not.toBeNull();
      writeFileSync(join(out, `${name}.pdf`), pdf!);
      expect(pdf!.subarray(0, 4).toString()).toBe("%PDF");
      expect(countPdfPages(pdf!)).toBe(pages);
    }, 60_000);
  }
});
