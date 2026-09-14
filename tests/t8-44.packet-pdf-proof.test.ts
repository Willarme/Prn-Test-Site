import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, expect, it } from "vitest";
import { renderPacketHtml } from "@/domain/packet/render";
import { closePdfRenderer, countPdfPages, renderPacketPdf } from "@/domain/packet/pdf";
import { referenceInput, thinInput } from "./loop.p1.fixtures";
const output = mkdtempSync(join(tmpdir(), "d5-packet-proof-"));
afterAll(closePdfRenderer);
it.each(["rich", "thin"] as const)("hidden %s packet prints exactly three real Letter pages without keep/ask annotations", async name => {
  const input = name === "rich" ? referenceInput() : thinInput();
  input.config.owner_actions = true;
  input.config.qr_visibility = { keep: false, ask: false };
  const rendered = renderPacketHtml(input);
  expect(rendered.self_check.ok).toBe(true);
  // Offline print proof needs no server or network request for optional fonts.
  const html = rendered.html.replace(/<link\b[^>]*>/g, "");
  const pdf = await renderPacketPdf(html);
  expect(pdf, "A real local PDF must be generated; no silent skip").not.toBeNull();
  expect(countPdfPages(pdf!)).toBe(3);
  const raw = pdf!.toString("latin1");
  expect(raw).not.toMatch(/\/URI\s*\([^)]*\/(keep|ask)\//);
  const mediaBoxes = [...raw.matchAll(/\/MediaBox\s*\[\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\]/g)];
  expect(mediaBoxes).toHaveLength(3);
  for (const box of mediaBoxes) expect(box.slice(1).map(Number)).toEqual([0, 0, 612, 792]);
  writeFileSync(join(output, `${name}-hidden.html`), html);
  writeFileSync(join(output, `${name}-hidden.pdf`), pdf!);
  console.info(`D5 PDF proof: ${join(output, `${name}-hidden.pdf`)}`);
}, 20_000);
