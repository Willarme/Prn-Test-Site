/**
 * Navigation around the approved concept artwork. Only this adapter's new
 * elements, the functional scope notice and annotated original navigation
 * receive styling; source style blocks, cards, diagrams, wording and handlers
 * pass through unchanged.
 * The restrained paper/teal treatment is inferred from the approved AC v43.
 */
const STAGES: Record<string, string> = {
  overview: "One Connected Home",
  dashboard: "Dashboard",
  "trust-network": "Trust Network",
  smartquote: "SmartQuote",
  "home-memory": "Home Memory",
  "provider-os": "Provider OS",
};

const CHROME_CSS = `
[data-preview-chrome="navigation"]{position:relative;z-index:10;display:block;margin:0;background:#F7F7F5;color:#12161A;border:0;border-bottom:1px solid rgba(18,22,26,.13);font:14px/1.4 "Public Sans",system-ui,sans-serif}
[data-preview-chrome="navigation"] .prn-preview-chrome-inner{width:100%;max-width:1160px;margin:0 auto;padding:8px 158px 8px 22px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:2px 24px}
[data-preview-chrome="navigation"] .prn-preview-stage{display:flex;align-items:center;gap:9px;font:500 11px/1.5 "JetBrains Mono",ui-monospace,monospace;letter-spacing:.05em}
[data-preview-chrome="navigation"] .prn-preview-mark{display:inline-block;width:9px;height:12px;background:#0F1114;clip-path:polygon(0 0,100% 18%,0 42%,0 100%,17% 100%,17% 0);flex:none}
[data-preview-chrome="navigation"] .prn-preview-links{display:flex;align-items:center;flex-wrap:wrap;gap:4px 14px}
[data-preview-chrome="navigation"] a{display:inline-flex;align-items:center;justify-content:center;min-height:44px;color:#12161A;font:600 13px/1.3 "Public Sans",system-ui,sans-serif;text-decoration:none;text-underline-offset:4px;white-space:nowrap}
[data-preview-chrome="navigation"] a:hover{text-decoration:underline}
[data-preview-chrome="navigation"] .prn-preview-ac{padding:9px 12px;border:1px solid transparent;border-radius:4px;background:#2D5C68;color:#fff}
[data-preview-chrome="navigation"] .prn-preview-ac:hover{background:#234853;text-decoration:none}
[data-preview-chrome="navigation"] a:focus-visible{outline:2px solid #FF2E7E;outline-offset:3px}
@media(max-width:900px){[data-preview-chrome="navigation"] .prn-preview-chrome-inner{padding-right:118px;gap:2px 14px}[data-preview-chrome="navigation"] .prn-preview-links{gap:4px 10px}}
@media(max-width:700px){
[data-preview-chrome="navigation"] .prn-preview-chrome-inner{padding-right:22px}
[data-preview-original-nav] > [data-preview-original-nav-bar]{height:auto!important;min-height:64px;display:flex!important;flex-wrap:wrap!important;align-items:center!important;padding:8px 22px!important;gap:4px 12px!important}
[data-preview-original-nav-bar] > a:first-child{order:1;min-height:44px}
[data-preview-original-nav-bar] > a[href="#pulse"]{order:2;margin-left:auto;min-height:44px}
[data-preview-original-nav-bar] > [data-preview-original-nav-links]{order:3;flex:0 0 100%!important;width:100%;min-width:0;margin-left:0!important;display:grid!important;grid-template-columns:repeat(3,minmax(0,1fr));gap:0 10px!important}
[data-preview-original-nav-links] > a{display:flex;align-items:center;justify-content:center;min-height:44px;text-align:center;white-space:normal;overflow-wrap:anywhere}
[data-preview-original-ribbon]{position:static!important;width:auto!important;height:auto!important;overflow:visible!important;padding:10px 22px;z-index:auto!important}
[data-preview-original-ribbon] > div{position:static!important;width:fit-content!important;max-width:100%;transform:none!important;padding:6px 10px!important;border-radius:4px;box-shadow:none!important;display:flex;align-items:center;gap:6px;text-align:left!important;font-size:12px!important;line-height:1.3!important;letter-spacing:.03em!important}
[data-preview-original-ribbon] > div > b{display:inline!important;font-size:inherit!important;letter-spacing:inherit!important}
}
@media print{[data-preview-chrome="navigation"],[data-preview-scope]{display:none!important}}
`;

const SCOPE_STYLE = 'position:relative;z-index:10;padding:12px 22px;border-bottom:1px solid rgba(45,92,104,.25);background:#F7F7F5;color:#2D5C68;font:14px/1.5 "Public Sans",system-ui,sans-serif';

// The six approved documents use this one precise navigation structure. Match
// the wrapper, fixed-height bar, six-link group and #pulse CTA together rather
// than applying responsive rules to every sticky panel or inline-style div.
const ORIGINAL_NAV = /(<div style="position:sticky;top:0;z-index:150;[^"\n]+">)(\s*)(<div style="width:100%;max-width:1180px;margin:0 auto;padding:0 26px;display:flex;align-items:center;gap:(?:20|22|26)px;height:64px">)([\s\S]*?)(<div style="display:flex;gap:(?:15|16|18)px;margin-left:auto;align-items:center;flex-wrap:wrap;font-size:\.\d+rem">)([\s\S]*?<\/div>\s*<a href="#pulse" style="display:inline-flex;[^"\n]+">[^<]+<\/a>\s*<\/div>\s*<\/div>)/g;
const ORIGINAL_RIBBON = /<div aria-hidden="true" style="position:fixed;top:0;right:0;width:190px;height:190px;overflow:hidden;pointer-events:none;z-index:400">(?=<div style="position:absolute;top:38px;right:-54px;width:230px;transform:rotate\(45deg\);)/g;

function annotateOriginalNavigation(source: string, stage: string): string {
  const matches = [...source.matchAll(ORIGINAL_NAV)];
  if (matches.length !== 1 || (matches[0]![6]!.match(/<a href=/g) ?? []).length !== 7) {
    throw new Error("Feature preview navigation structure changed");
  }
  const ribbons = [...source.matchAll(ORIGINAL_RIBBON)];
  if (ribbons.length !== (stage === "provider-os" ? 0 : 1)) {
    throw new Error("Feature preview ribbon structure changed");
  }
  return source.replace(ORIGINAL_NAV, (_match, outer: string, space: string, bar: string, brand: string, links: string, rest: string) =>
    outer.replace("<div ", "<div data-preview-original-nav ") + space +
    bar.replace("<div ", "<div data-preview-original-nav-bar ") + brand +
    links.replace("<div ", "<div data-preview-original-nav-links ") + rest)
    .replace(ORIGINAL_RIBBON, tag => tag.replace("<div ", "<div data-preview-original-ribbon "));
}

/** Idempotent so composing serving adapters cannot duplicate the navigation. */
export function addPreviewChrome(source: string, stage: string): string {
  if (!Object.hasOwn(STAGES, stage)) throw new Error("Unknown feature preview stage");
  if (/<nav\b[^>]*\bdata-preview-chrome="navigation"/i.test(source)) return source;
  if (!/<body\b[^>]*>/i.test(source) || !/<\/head>/i.test(source)) {
    throw new Error("Feature preview document shell is missing");
  }
  const chrome = `<nav data-preview-chrome="navigation" aria-label="Demo navigation"><div class="prn-preview-chrome-inner"><span class="prn-preview-stage" aria-current="page"><i class="prn-preview-mark" aria-hidden="true"></i>${STAGES[stage]}</span><div class="prn-preview-links"><a href="/demo">Demo</a><a href="/demo/all">All pages</a><a class="prn-preview-ac" href="/ac-blowing-warm-air">AC guide</a></div></div></nav>`;

  // This notice is generated by wirePreviewFeedback, not part of the frozen
  // source. Replace only its opening tag's presentation, retaining every word.
  const html = annotateOriginalNavigation(source, stage).replace(/<aside\b[^>]*\bdata-preview-scope\b[^>]*>/i, tag => {
    const withoutStyle = tag.replace(/\sstyle=(['"])[\s\S]*?\1/i, "");
    return withoutStyle.replace(/>$/, ` style='${SCOPE_STYLE}'>`);
  });
  return html.replace(/<\/head>/i, `<style data-preview-chrome-style>${CHROME_CSS}</style>$&`)
    .replace(/<body\b[^>]*>/i, `$&${chrome}`);
}
