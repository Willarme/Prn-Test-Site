import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { FeatureStateRow } from "@/domain/features/types";

export const FEATURE_VISITOR_COOKIE = "prn_feature_visitor";
/** One consent-compatible prompt per feature/version in this browser for 30 days. */
export const FEATURE_INTEREST_TTL_SECONDS = 30 * 24 * 60 * 60;

function signingKey(): string {
  const key = process.env.LINK_SIGNING_SECRET;
  if (!key || key.length < 32) throw new Error("Feature interest is unavailable");
  return key;
}
function signature(value: string): string { return createHmac("sha256", signingKey()).update(`feature-visitor:${value}`).digest("base64url"); }

export function anonymousFeatureVisitor(request: Request, now = Date.now()): string | null {
  const value = (request.headers.get("cookie") ?? "").split(";").map(part => part.trim()).find(part => part.startsWith(`${FEATURE_VISITOR_COOKIE}=`))?.slice(FEATURE_VISITOR_COOKIE.length + 1);
  if (!value || !/^[A-Za-z0-9_-]{32}\.\d{10}\.[A-Za-z0-9_-]{43}$/.test(value)) return null;
  const [id, issued, mac] = value.split(".");
  const seconds = Math.floor(now / 1000);
  if (Number(issued) > seconds || seconds - Number(issued) >= FEATURE_INTEREST_TTL_SECONDS) return null;
  try {
    return timingSafeEqual(Buffer.from(mac!), Buffer.from(signature(`${id}.${issued}`))) ? id! : null;
  } catch { return null; }
}

export function featureVisitorCookie(request: Request, now = Date.now()): string | null {
  if (anonymousFeatureVisitor(request, now)) return null;
  const payload = `${randomBytes(24).toString("base64url")}.${Math.floor(now / 1000)}`;
  const value = `${payload}.${signature(payload)}`;
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${FEATURE_VISITOR_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${FEATURE_INTEREST_TTL_SECONDS}${secure}`;
}

export function interestHashes(visitor: string, tenant: string, feature: string, version: number): { visitor_hash: string; dedupe_key: string } {
  const hash = (parts: unknown[]) => createHash("sha256").update(JSON.stringify(parts)).digest("hex");
  return { visitor_hash: hash([tenant, visitor]), dedupe_key: hash([tenant, visitor, feature, version]) };
}

export function featureInterestOriginAllowed(request: Request): boolean {
  try {
    const source = request.headers.get("origin");
    if (!source || request.headers.get("sec-fetch-site") === "cross-site") return false;
    const parsed = new URL(source);
    const expected = new URL(process.env.PRN_ADMIN_ORIGIN || request.url);
    return ["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password && parsed.pathname === "/" && !parsed.search && !parsed.hash && parsed.origin === expected.origin;
  } catch { return false; }
}

/** Appended serving adapter. The approved product artwork remains byte-identical. */
export function addFeatureInterestPrompt(html: string, row: FeatureStateRow, page: string): string {
  if (row.state !== "PREVIEW") return html;
  const payload = JSON.stringify({ feature_id: row.feature_id, feature_version: row.version, page }).replace(/</g, "\\u003c");
  const markup = `<style>
#prn-interest{position:fixed;right:1rem;bottom:1rem;z-index:10000;max-width:min(25rem,calc(100vw - 2rem));padding:1.1rem;background:#fff;color:#182524;border:2px solid #207c70;border-radius:1rem;box-shadow:0 8px 28px #18252430;font:16px/1.5 system-ui,sans-serif}#prn-interest[hidden]{display:none}#prn-interest h2{font:700 1.1rem/1.4 system-ui;margin:0 1.5rem .5rem 0}#prn-interest p{margin:.5rem 0}#prn-interest button{min-height:44px;padding:.5rem .8rem;margin:.2rem;border:1px solid #207c70;border-radius:.5rem;background:#fff;color:#182524;font:inherit;cursor:pointer}#prn-interest button:focus-visible{outline:3px solid #154f47;outline-offset:3px}#prn-interest-close{position:absolute;right:.35rem;top:.25rem}#prn-interest-status{font-size:.9rem}
</style><section id="prn-interest" role="dialog" aria-modal="false" aria-labelledby="prn-interest-title" aria-describedby="prn-interest-detail" hidden>
<button id="prn-interest-close" type="button" aria-label="Dismiss feature interest question">×</button>
<h2 id="prn-interest-title">Not live yet, would you use this?</h2><p id="prn-interest-detail">This product is a preview. Your anonymous answer helps us decide what to build. You can keep reading without answering.</p>
<div><button type="button" data-interest-answer="yes">Yes</button><button type="button" data-interest-answer="maybe">Maybe</button><button type="button" data-interest-answer="no">No</button></div><p id="prn-interest-status" role="status" aria-live="polite"></p></section>
<script>(function(){
var data=${payload},box=document.getElementById('prn-interest'),status=document.getElementById('prn-interest-status');
var key='prn:feature-interest:'+data.feature_id+':'+data.feature_version,now=Date.now(),ttl=${FEATURE_INTEREST_TTL_SECONDS * 1000};
try{var until=Number(localStorage.getItem(key));if(until>now&&until<=now+ttl)return;localStorage.setItem(key,String(now+ttl));}catch(e){return;}
box.hidden=false;
function close(){var focused=box.contains(document.activeElement);box.hidden=true;if(focused){var target=document.querySelector('main')||document.body;var previous=target.getAttribute('tabindex');target.setAttribute('tabindex','-1');target.focus();if(previous===null)target.removeAttribute('tabindex');else target.setAttribute('tabindex',previous);}}
document.getElementById('prn-interest-close').addEventListener('click',close);
box.addEventListener('keydown',function(event){if(event.key==='Escape'){event.preventDefault();close();}});
box.querySelectorAll('[data-interest-answer]').forEach(function(button){button.addEventListener('click',async function(){
var buttons=box.querySelectorAll('[data-interest-answer]');buttons.forEach(function(item){item.disabled=true;});status.textContent='Saving your answer…';
try{var response=await fetch('/api/feature-interest',{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(Object.assign({},data,{answer:button.getAttribute('data-interest-answer')}))});var receipt=await response.json();if(!response.ok||receipt.recorded!==true)throw new Error('not saved');status.textContent='Thank you. Your answer was saved.';}
catch(e){status.textContent='Your answer could not be saved. Please try again.';buttons.forEach(function(item){item.disabled=false;});}
});});})();</script>`;
  return /<\/body>/i.test(html) ? html.replace(/<\/body>/i, `${markup}</body>`) : html + markup;
}
