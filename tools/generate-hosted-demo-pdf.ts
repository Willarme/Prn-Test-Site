import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { HOSTED_SAMPLE_NOW, renderHostedSamplePacket } from "../src/domain/demo/hosted-sample";
import { closePdfRenderer, countPdfPages, renderPacketPdf } from "../src/domain/packet/pdf";

/**
 * Regenerate the fixed public example with the application's real renderer:
 *   npx tsx tools/generate-hosted-demo-pdf.ts
 *
 * This is an offline document build, never a hosted request handler. It reads
 * no database or .env file. The prepared PDF has the initial synthetic values;
 * the interactive sample's later choices do not change this committed asset.
 */
async function main(): Promise<void> {
  const origin = "https://prn-test-site.vercel.app";
  const rendered = renderHostedSamplePacket(origin);
  const sampleLabels = rendered.html.match(/Prepared sample/g)?.length ?? 0;
  if (!rendered.self_check.ok || rendered.halted || sampleLabels !== 3) {
    throw new Error("Prepared sample must pass content checks and label all three pages");
  }

  try {
    const pdf = await renderPacketPdf(rendered.html);
    if (!pdf || pdf.subarray(0, 5).toString() !== "%PDF-" || countPdfPages(pdf) !== 3) {
      throw new Error("A working local PDF renderer must produce exactly three actual PDF pages");
    }
    const proof = resolve("data/runtime/hosted-demo-repair");
    await mkdir(proof, { recursive: true });
    await mkdir(resolve("public"), { recursive: true });
    await writeFile(resolve("public/sample-ac-job-packet.pdf"), pdf);
    await writeFile(resolve(proof, "sample-packet.html"), rendered.html);
    const receipt = {
      artifact: "public/sample-ac-job-packet.pdf",
      sha256: createHash("sha256").update(pdf).digest("hex"),
      bytes: pdf.byteLength,
      page_count: countPdfPages(pdf),
      sample_timestamp: HOSTED_SAMPLE_NOW,
      sample_origin: origin,
      prepared_initial_sample: true,
      content_check: rendered.self_check,
      visual_inspection_required: true,
    };
    await writeFile(resolve(proof, "sample-pdf-generation.json"), `${JSON.stringify(receipt, null, 2)}\n`);
    console.log(JSON.stringify(receipt, null, 2));
  } finally {
    await closePdfRenderer();
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Prepared PDF generation failed");
  process.exitCode = 1;
});
