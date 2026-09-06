/** Exact filename rewrites in approved assets, including links built in script. */
const LINK_REWRITES: [string, string][] = [
  ["One Connected Home.dc.html", "/pages/overview"],
  ["Dashboard v3.dc.html", "/pages/dashboard"],
  ["Trust Network v3.dc.html", "/pages/trust-network"],
  ["SmartQuote v3.dc.html", "/pages/smartquote"],
  ["Home Memory v2.dc.html", "/pages/home-memory"],
  ["Provider OS v2.dc.html", "/pages/provider-os"],
  ["property-response-v2 (2).html", "/pages/overview"],
];

export function rewriteInterPageLinks(html: string): string {
  let out = html;
  for (const [from, to] of LINK_REWRITES) out = out.split(from).join(to);
  return out;
}
