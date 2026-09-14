import type { DoorV44Diagnostic } from "./types";

export type DoorV44Tag =
  | "main" | "header" | "footer" | "nav" | "section" | "article" | "aside"
  | "div" | "p" | "span" | "h1" | "h2" | "h3" | "h4" | "h5" | "h6"
  | "strong" | "em" | "b" | "i" | "small" | "mark" | "sup" | "sub" | "br" | "hr"
  | "ul" | "ol" | "li" | "dl" | "dt" | "dd"
  | "table" | "caption" | "colgroup" | "col" | "thead" | "tbody" | "tfoot" | "tr" | "th" | "td"
  | "a" | "form" | "label" | "input" | "textarea" | "button" | "fieldset" | "legend"
  | "select" | "option" | "optgroup" | "output"
  | "details" | "summary" | "figure" | "figcaption" | "picture" | "source" | "img"
  | "time" | "abbr" | "address" | "blockquote" | "cite" | "code" | "pre";
export interface DoorV44Element {
  tag: DoorV44Tag;
  attrs?: Record<string, string>;
  children?: Array<DoorV44Element | string>;
}
export interface DoorV44Document {
  title: string;
  description: string;
  canonical_url: string;
  robots: "noindex,nofollow" | "noindex,follow" | "index,follow";
  site_name: string;
  lang: "en-US";
  receipt_id: string;
  date_modified: string | null;
  social_image?: { url: string; alt: string; width: number; height: number; mime: string };
  structured_data: Record<string, unknown>[];
  body: DoorV44Element[];
}
export type DoorV44RenderResult =
  | { ok: true; html: string; html_hash: string; semantic_hash: string }
  | { ok: false; errors: DoorV44Diagnostic[] };
