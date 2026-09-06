import { ACTIVE_DISCLOSURE } from '@/domain/privacy/disclosures';
import { adaptDoorMetadata, type DoorMetadataReceipt } from '@/platform/pages/door-metadata';

/** Shared runtime additions around the frozen template. Does not alter source files. */
const SITE_NAME = "Property Response Network";

/**
 * Styled to sit with the free-note line under the button: small, muted, no
 * colour of its own. The door's own tokens (`--dim`, `--mono`) are used so it
 * inherits the page rather than importing the app's stylesheet.
 */
function consentBlock(): string {
  return [
    `<input type="hidden" name="disclosure_content_hash" value="${escapeAttr(ACTIVE_DISCLOSURE.content_hash)}">`,
    `<p class="disclosure dim" style="font-size:.78rem;line-height:1.55;max-width:62ch;margin:10px 0 0">${escapeHtml(ACTIVE_DISCLOSURE.content_text)}</p>`,
  ].join("\n          ");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

const ERRORS: Record<string, string> = {
  needs_description: "Describe what is happening, then start again.",
  consent: "This page has been updated. Review the note below, then start again.",
  unavailable: "The walkthrough is unavailable right now. Your description is still here. Try again shortly.",
  try_again: "Your request could not be saved. Your description is still here. Try again.",
};

export function renderDoorDocument(source: string, request: Request, receipt?: DoorMetadataReceipt, canonicalPath?: string): string {
  let html = adaptDoorMetadata(source, new URL(request.url).origin, receipt, canonicalPath);
  // The deck intercepts anchors during capture and stops propagation. Open the
  // existing citation ledger in the earlier capture listener so a footnote
  // remains usable in the actual desktop deck as well as the flowing page.
  html = html.replace(/ {2}\}\);\r?\n {2}if\(location\.hash\.indexOf\('#src-'\)===0\) openSourceLedger\(\);/,
    "  },true);\n  if(location.hash.indexOf('#src-')===0) openSourceLedger();");
  // Verified at 375px: v43's 1fr tracks inherited nowrap captions, expanding
  // the upload row beyond its 250px container. Preserve the source and desktop
  // presentation; let these three mobile labels wrap inside their own tracks.
  html = html.replace("</head>", `<style id="door-mobile-upload-repair">
@media (max-width:700px){
  #home-problem-intake .field .media-row{grid-template-columns:repeat(3,minmax(0,1fr))!important;align-items:stretch!important;max-width:100%;min-width:0;}
  #home-problem-intake .field .media-row .cta-quiet{min-width:0!important;max-width:100%;height:auto!important;min-height:64px!important;flex-direction:column!important;gap:5px!important;padding:8px 4px!important;}
  #home-problem-intake .field .media-row .tip{white-space:normal!important;overflow-wrap:anywhere;max-width:100%;min-width:0;text-align:center;line-height:1.3;}
}
</style></head>`);
  html = html.split("{{site.name}}").join(SITE_NAME);
  const error = request ? new URL(request.url).searchParams.get("error") : null;
  const message = error ? ERRORS[error] : null;
  if (message) {
    html = html.replace(/(<form\b[^>]*>)/, `$1\n<p role="alert" class="dim" style="border-left:3px solid var(--pink);padding:12px;margin:0 0 14px">${escapeHtml(message)}</p>`);
  }
  // Session-only recovery; the draft never enters telemetry or a URL.
  html = html.replace("</body>", `<script>(function(){var f=document.getElementById('home-problem-intake'),t=f&&f.querySelector('textarea[name="problem_description"]');if(!t)return;var k='prn_door_draft';try{if(new URLSearchParams(location.search).has('error')){t.value=sessionStorage.getItem(k)||t.value;}else{sessionStorage.removeItem(k);}f.addEventListener('submit',function(){try{sessionStorage.setItem(k,t.value);}catch(e){}});}catch(e){}})();</script></body>`);

  // Injected before the FIRST closing </form> — the intake console's form is
  // the only form on the page, and anchoring to the closing tag keeps the
  // injection independent of the template's internal layout.
  const close = html.indexOf("</form>");
  if (close !== -1) {
    html = `${html.slice(0, close)}${consentBlock()}\n        ${html.slice(close)}`;
  }

  return html;
}
