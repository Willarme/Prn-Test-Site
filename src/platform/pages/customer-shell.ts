import { featureHref, type FeatureSnapshot } from "@/platform/features/state";

/** T6-29 / map 2.1. Shared by the app, approved-page adapter and the next door kit. */
export const PRODUCT_LINKS = [
  { label: "Dashboard", href: "/pages/dashboard" },
  { label: "Trust Network", href: "/pages/trust-network" },
  { label: "SmartQuote", href: "/pages/smartquote" },
  { label: "Home Memory", href: "/pages/home-memory" },
] as const;

export const HEADER_LINKS = [
  { label: "Issue Library", href: "/problems/" },
  ...PRODUCT_LINKS,
  { label: "About Us", href: "/about" },
  { label: "FAQ", href: "/faq" },
] as const;

export const FOOTER_LINKS = [
  ...HEADER_LINKS,
  { label: "One Connected Home", href: "/pages/overview" },
  { label: "What this tool can do", href: "/what-this-tool-can-help-with" },
  { label: "How our numbers work", href: "/local-records/methodology" },
  { label: "Start with what happened", href: "/start" },
  { label: "Terms", href: "/terms" },
  { label: "Privacy Notice", href: "/privacy" },
  { label: "Owner sign-in", href: "/admin" },
] as const;

const links = (snapshot: FeatureSnapshot, items: readonly { label: string; href: string }[]) =>
  items.flatMap(item => {
    const href = featureHref(snapshot, item.href);
    return href ? [`<a href="${href}">${item.label}</a>`] : [];
  }).join("");

// All strings above are source-owned. Request data never enters shell markup.
export function renderCustomerHeader(snapshot: FeatureSnapshot, intakeOnPage = false): string {
  const start = featureHref(snapshot, "/start");
  const cta = start ? `<a class="prn-shell-cta" href="${intakeOnPage ? "#intake" : start}">Start with what happened</a>` : "";
  return `<header class="prn-customer-shell prn-customer-header" data-customer-shell="header"><div class="prn-shell-inner"><a class="prn-shell-brand" href="/">Property Response <small>Network</small></a><nav aria-label="Main navigation">${links(snapshot, HEADER_LINKS)}${cta}</nav></div></header>`;
}

export function renderCustomerFooter(snapshot: FeatureSnapshot): string {
  return `<footer class="prn-customer-shell prn-customer-footer" data-customer-shell="footer"><div class="prn-shell-inner"><p class="prn-shell-brand">Property Response Network</p><nav aria-label="Footer directory">${links(snapshot, FOOTER_LINKS)}</nav></div></footer>`;
}

export const CUSTOMER_SHELL_CSS = `
.prn-customer-shell{position:relative;z-index:10;background:#f7f7f5;color:#12161a;font:14px/1.5 "Public Sans",system-ui,sans-serif;border-block:1px solid rgba(18,22,26,.13)}
.prn-customer-shell .prn-shell-inner{max-width:1160px;margin:0 auto;padding:16px 22px}
.prn-customer-shell .prn-shell-brand{font:700 17px/1.3 "Archivo",system-ui,sans-serif;text-decoration:none;color:inherit;display:block;margin:0 0 12px}
.prn-customer-shell .prn-shell-brand small{font-size:12px;color:#5a6462}
.prn-customer-shell nav{display:flex;flex-wrap:wrap;align-items:center;gap:4px 20px}
.prn-customer-shell nav a{display:inline-flex;align-items:center;min-height:44px;color:inherit;text-decoration:none;text-underline-offset:4px;font-weight:600}
.prn-customer-shell nav a:hover{text-decoration:underline}
.prn-customer-shell a:focus-visible{outline:2px solid #ff2e7e;outline-offset:3px}
.prn-customer-shell nav .prn-shell-cta{padding:10px 16px;background:#2d5c68;color:#fff;border-radius:4px}
.prn-customer-footer .prn-shell-inner{padding-block:30px}
.prn-customer-footer nav a:last-child{font-size:12px;color:#5a6462;flex-basis:100%}
@media(max-width:600px){.prn-customer-shell nav{gap:2px 16px}.prn-customer-shell nav a{font-size:13px}.prn-customer-header nav .prn-shell-cta{flex-basis:100%;justify-content:center;margin-top:8px}}
@media print{.prn-customer-shell{display:none!important}}
`;
