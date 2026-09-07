/** Responsive arrangement around the preserved concept artwork. */
const LAYOUTS: Record<string, Set<string>> = {
  overview: new Set(["1fr 92px 1fr", "1fr 42px 1fr", "1fr 1fr"]),
  "home-memory": new Set(["1.1fr .9fr", "1.35fr .95fr", "repeat(3,1fr)", "repeat(4,1fr)"]),
  "provider-os": new Set(["1.15fr .85fr", "repeat(2,1fr)", "repeat(4,1fr)", "1fr 80px 1fr", "1fr 1fr"]),
};

export const PREVIEW_RESPONSIVE_CSS = `
@media(max-width:700px){
  [data-preview-grid="stack"]{grid-template-columns:minmax(0,1fr)!important}
  [data-preview-grid="tiles"]{grid-template-columns:repeat(2,minmax(0,1fr))!important}
  [data-preview-grid] > *{min-width:0;max-width:100%}
  [data-preview-grid]{overflow-wrap:anywhere}
  [data-preview-grid] input{min-width:0;max-width:100%}
  [data-preview-fluid-copy]{min-width:0!important;flex-basis:100%!important}
}
@media(min-width:701px){[data-preview-scope]{padding-right:190px!important}}
`;

export function arrangePreviewForMobile(source: string, stage: string): string {
  if (stage === "smartquote" || stage === "dashboard") {
    return source.replace(/<p\b([^>]*\bstyle="[^"]*\bflex:1;min-width:(?:280|300)px(?:;[^"]*)?"[^>]*)>/g,
      (tag, attributes: string) => attributes.includes("data-preview-fluid-copy") ? tag : `<p data-preview-fluid-copy${attributes}>`);
  }
  const layouts = LAYOUTS[stage];
  if (!layouts) return source;
  return source.replace(/<div\b([^>]*\bstyle="([^"]*)"[^>]*)>/g, (tag, attributes: string, style: string) => {
    if (attributes.includes("data-preview-grid")) return tag;
    const columns = /(?:^|;)grid-template-columns:([^;]+)/.exec(style)?.[1];
    if (!columns || !layouts.has(columns)) return tag;
    // These six small document symbols remain a compact two-column group;
    // the larger evidence panels and comparisons receive the full measure.
    const kind = stage === "home-memory" && columns === "repeat(3,1fr)" && /(?:^|;)gap:10px(?:;|$)/.test(style) ? "tiles" : "stack";
    return `<div data-preview-grid="${kind}"${attributes}>`;
  });
}
