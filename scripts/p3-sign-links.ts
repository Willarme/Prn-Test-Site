/* global process, console */
/**
 * Track P3 live check: mint the four scoped links for one request and print
 * them, so the flows can be clicked through with curl against a dev server
 * on the file store. Usage:
 *
 *   PRN_RUNTIME_STORE=file npx tsx scripts/p3-sign-links.ts <request_id> [base]
 *
 * Uses issueLink, so every link also lands in the request's ledger and shows
 * on /links/<request_id>. Prints paths only; no secret is read into the
 * output.
 */
import { issueLink } from "../src/platform/links/ledger";

const requestId = process.argv[2];
const base = process.argv[3] ?? "http://localhost:3113";
if (!requestId) {
  console.error("usage: tsx scripts/p3-sign-links.ts <request_id> [base]");
  process.exit(1);
}

const keep = issueLink({ scope: "keep", request_id: requestId });
const ask = issueLink({ scope: "ask", request_id: requestId });
const media = issueLink({ scope: "media", request_id: requestId });
const packet = issueLink({ scope: "packet", request_id: requestId });

console.log(
  JSON.stringify(
    {
      request_id: requestId,
      keep: { link_id: keep.link_id, url: `${base}/keep/${keep.token}`, token: keep.token },
      ask: { link_id: ask.link_id, url: `${base}/ask/${ask.token}`, token: ask.token },
      media: { link_id: media.link_id, url: `${base}/media/${media.token}`, token: media.token },
      packet: { link_id: packet.link_id, url: `${base}/p/${packet.token}`, token: packet.token },
      links: `${base}/links/${requestId}?k=${encodeURIComponent(keep.token)}`,
    },
    null,
    2
  )
);
