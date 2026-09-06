#!/usr/bin/env node
/* global process, Buffer, URL, Headers, Response, AbortController, setTimeout, clearTimeout, console */
// HTTPS tunnel -> this loopback-only gateway -> a separate production Next process.
// Importing this module neither creates state nor opens a listener.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ACCESS_COOKIE = "__Host-prn_demo_access";
const DEFAULT_ENTRY = "/problems/ac-blowing-warm-air";
const READ = new Set(["GET", "HEAD"]);
const FIXED_PAGES = new Set(["/", "/demo", "/demo/all", DEFAULT_ENTRY, "/ac-blowing-warm-air", "/start", "/privacy", "/terms", "/what-this-tool-can-help-with", "/no-hot-water", "/link-off", "/cooling", "/local-records/methodology", "/favicon.ico"]);
const POST_APIS = new Set(["/demo/start", "/api/intake", "/api/intake/start", "/api/intake/media", "/api/intake/answer", "/api/intake/walkthrough", "/api/ask", "/api/keep", "/api/links/revoke", "/api/packet/address", "/api/packet-activity", "/api/results/email", "/api/feedback", "/api/feature-interest", "/api/signup"]);
const REQUEST_ID = "rq_[a-zA-Z0-9_-]{1,120}";
const TOKEN = "[a-zA-Z0-9_.-]{16,4096}";
const CUSTOMER_PAGE = new RegExp(`^/(?:complete|links)/${REQUEST_ID}$|^/results/${REQUEST_ID}(?:/(?:send|email|find))?$|^/packet/${REQUEST_ID}(?:/pdf)?$|^/mail/(?:em|sm)_[a-zA-Z0-9_-]{1,120}$|^/(?:keep|ask|p|claim)/${TOKEN}$|^/media/${TOKEN}(?:/ev_[a-zA-Z0-9_-]{1,120})?$`);
const ACTION_PAGE = new RegExp(`^/complete/${REQUEST_ID}$|^/results/${REQUEST_ID}(?:/(?:send|email|find))?$`);
const ASSET = /^\/_next\/static\/[a-zA-Z0-9_./()[\]-]+\.(?:js|css|woff2?|ttf|png|jpg|jpeg|svg|webp|avif)$/;
const IMAGE = /^\/images\/[a-zA-Z0-9_.-]+\.(?:png|jpg|jpeg|svg|webp|avif)$/;
const FEATURE = /^\/pages\/(?:overview|dashboard|trust-network|smartquote|home-memory|provider-os|support\.js|vendor\/(?:react|react-dom|babel)\.js)$/;
const FORWARD_HEADERS = new Set(["accept", "accept-language", "content-type", "cookie", "origin", "referer", "user-agent", "range", "if-none-match", "if-modified-since", "rsc", "next-router-state-tree", "next-router-prefetch", "next-router-segment-prefetch", "next-url", "next-action", "sec-fetch-mode", "sec-fetch-dest", "sec-fetch-site"]);
const RESPONSE_DROP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade", "content-encoding", "content-length", "set-cookie", "refresh", "server", "x-powered-by"]);

class GatewayError extends Error {
  constructor(status) { super("Request unavailable"); this.status = status; }
}

/** Validate the raw request target BEFORE URL parsing can normalize traversal. */
export function parseTarget(raw) {
  // eslint-disable-next-line no-control-regex -- Reject raw request controls before URL normalization.
  if (typeof raw !== "string" || raw.length > 8192 || !raw.startsWith("/") || raw.startsWith("//") || /[\\#\u0000-\u0020\u007f]/.test(raw)) return null;
  const rawPath = raw.split("?")[0];
  if (/%(?:2f|5c|25|00)/i.test(rawPath)) return null;
  let pathname;
  try { pathname = decodeURIComponent(rawPath); } catch { return null; }
  // eslint-disable-next-line no-control-regex -- Encoded controls are equally invalid routing input.
  if (/[\\\u0000-\u0020\u007f]/.test(pathname) || pathname.includes("//") || pathname.split("/").some(part => part === "." || part === "..")) return null;
  const url = new URL(raw, "https://gateway.invalid");
  return { pathname, search: url.search, params: url.searchParams };
}

export function routeAllowed(target, method) {
  if (!target) return false;
  const p = target.pathname.replace(/\/$/, "") || "/";
  if (method === "POST") return POST_APIS.has(p) || ACTION_PAGE.test(p);
  if (!READ.has(method)) return false;
  if (p === "/api/intake/media") {
    // This private route still requires the app's request owner capability.
    // Never let its file reference become a filesystem traversal input.
    return target.params.getAll("ref").length === 1 && /^local\/rq_[a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+\/ev_[a-zA-Z0-9_-]+\.(?:jpg|png|webp|heic|heif|mp4|mov|webm|m4a|mp3|ogg|wav)$/.test(target.params.get("ref"));
  }
  return FIXED_PAGES.has(p) || CUSTOMER_PAGE.test(p) || FEATURE.test(p) || IMAGE.test(p) ||
    (/^\/safety\/safety_[a-z0-9_]+$/.test(p)) || /^\/future\/[a-z0-9-]{1,100}$/.test(p) ||
    (ASSET.test(p) && !p.split("/").includes("admin"));
}

function digest(value) { return createHash("sha256").update(value).digest(); }
function sameSecret(a, b) { return typeof a === "string" && timingSafeEqual(digest(a), digest(b)); }
function signature(value, secret) { return createHmac("sha256", secret).update(value).digest("base64url"); }
function cookieValue(headers) {
  const matches = (headers.get("cookie") ?? "").split(";").map(s => s.trim()).filter(s => s.startsWith(`${ACCESS_COOKIE}=`));
  return matches.length === 1 ? matches[0].slice(ACCESS_COOKIE.length + 1) : null;
}
function mintSession(secret, now, ttl) {
  const value = `${now + ttl}.${randomBytes(18).toString("base64url")}`;
  return `${value}.${signature(value, secret)}`;
}
function validSession(value, secret, now, ttl) {
  if (!value || value.length > 200) return false;
  const parts = value.split(".");
  if (parts.length !== 3 || !/^\d+$/.test(parts[0])) return false;
  const expiry = Number(parts[0]);
  return Number.isSafeInteger(expiry) && expiry > now && expiry <= now + ttl && sameSecret(parts[2], signature(`${parts[0]}.${parts[1]}`, secret));
}

function securityHeaders(headers = new Headers()) {
  headers.set("cache-control", "private, no-store");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-robots-tag", "noindex, nofollow, noarchive");
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-frame-options", "DENY");
  return headers;
}
function refusal(status) { return new Response(status === 401 ? "Open the private invitation to enter this demo." : "Request unavailable.", { status, headers: securityHeaders() }); }

async function untilAbort(promise, signal) {
  if (signal.aborted) throw new GatewayError(504);
  let abort;
  const stopped = new Promise((_, reject) => { abort = () => reject(new GatewayError(504)); signal.addEventListener("abort", abort, { once: true }); });
  try { return await Promise.race([promise, stopped]); }
  finally { signal.removeEventListener("abort", abort); }
}
async function readLimited(source, maximum, signal, status) {
  if (!source) return new Uint8Array();
  if (source instanceof Uint8Array) {
    if (source.byteLength > maximum) throw new GatewayError(status);
    return source;
  }
  const iterator = source[Symbol.asyncIterator]();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const item = await untilAbort(iterator.next(), signal);
      if (item.done) break;
      const chunk = Buffer.from(item.value);
      size += chunk.byteLength;
      if (size > maximum) throw new GatewayError(status);
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, size);
  } catch (error) {
    // Cancellation must not wait forever for a broken upload/response stream.
    if (iterator.return) void Promise.resolve(iterator.return()).catch(() => {});
    throw error;
  }
}

function checkedOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Configure one HTTPS public origin.");
  return url;
}

/** Pure request boundary; injected fetch and clock make verification socket-free. */
export function createDemoGateway(options) {
  const publicUrl = checkedOrigin(options.publicOrigin);
  const upstream = new URL(options.upstream ?? "http://127.0.0.1:3189");
  if (upstream.protocol !== "http:" || upstream.hostname !== "127.0.0.1" || upstream.username || upstream.password || upstream.pathname !== "/" || upstream.search || upstream.hash) throw new Error("Upstream must be one loopback HTTP origin.");
  if (!/^[a-zA-Z0-9_-]{43}$/.test(options.inviteSecret) || typeof options.sessionSecret !== "string" || options.sessionSecret.length < 32) throw new Error("Fresh gateway secrets are required.");
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  const now = options.now ?? Date.now;
  const ttl = options.sessionTtlMs ?? 8 * 60 * 60 * 1000;
  const maximumBody = options.maxBodyBytes ?? 80 * 1024 * 1024;
  const maximumResponse = options.maxResponseBytes ?? 80 * 1024 * 1024;
  const maxConcurrent = options.maxConcurrent ?? 4;
  const timeoutMs = options.timeoutMs ?? 120_000;
  const maxMutations = options.maxMutationsPerMinute ?? 40;
  const maxInvites = options.maxInvitesPerMinute ?? 30;
  let active = 0;
  let inviteWindow = { start: now(), count: 0 };
  const mutationWindows = new Map();

  function redirectTarget(location) {
    const dest = new URL(location, publicUrl);
    if (dest.origin !== upstream.origin && dest.origin !== publicUrl.origin) throw new GatewayError(502);
    const local = `${dest.pathname}${dest.search}`;
    if (!routeAllowed(parseTarget(local), "GET")) throw new GatewayError(502);
    return `${publicUrl.origin}${local}${dest.hash}`;
  }

  return async function handle({ target: rawTarget, method = "GET", headers: rawHeaders, body = null }) {
    const headers = new Headers(rawHeaders);
    const target = parseTarget(rawTarget);
    if (!target || headers.get("host") !== publicUrl.host) return refusal(400);
    const invitation = /^\/invite\/([a-zA-Z0-9_-]{43})$/.exec(target.pathname);
    if (invitation && method === "GET") {
      if (now() - inviteWindow.start >= 60_000) inviteWindow = { start: now(), count: 0 };
      if (++inviteWindow.count > maxInvites) return refusal(429);
      const directory = target.params.getAll("to");
      const recognizedQuery = !target.search || (directory.length === 1 && directory[0] === "all" && [...target.params.keys()].length === 1);
      if (!recognizedQuery || !sameSecret(invitation[1], options.inviteSecret)) return refusal(401);
      const responseHeaders = securityHeaders(new Headers({ location: directory[0] === "all" ? "/demo/all" : "/demo" }));
      responseHeaders.append("set-cookie", `${ACCESS_COOKIE}=${mintSession(options.sessionSecret, now(), ttl)}; Path=/; Max-Age=${Math.floor(ttl / 1000)}; Secure; HttpOnly; SameSite=Lax`);
      return new Response(null, { status: 303, headers: responseHeaders });
    }
    if (!routeAllowed(target, method)) return refusal(404);
    const session = cookieValue(headers);
    if (!validSession(session, options.sessionSecret, now(), ttl)) return refusal(401);
    if (headers.has("content-encoding")) return refusal(415);
    if (headers.has("next-action") && (method !== "POST" || !ACTION_PAGE.test(target.pathname))) return refusal(403);
    if (headers.has("next-url") && !routeAllowed(parseTarget(headers.get("next-url")), "GET")) return refusal(403);
    if (method === "POST") {
      if (headers.get("origin") !== publicUrl.origin || ["cross-site", "none"].includes(headers.get("sec-fetch-site"))) return refusal(403);
      const time = now();
      for (const [key, entry] of mutationWindows) if (time - entry.start >= 60_000) mutationWindows.delete(key);
      const key = digest(session).toString("hex");
      if (!mutationWindows.has(key)) {
        if (mutationWindows.size >= 256) return refusal(429);
        mutationWindows.set(key, { start: time, count: 0 });
      }
      if (++mutationWindows.get(key).count > maxMutations) return refusal(429);
    }
    if (active >= maxConcurrent) return refusal(429);
    const cap = headers.get("content-type")?.startsWith("multipart/form-data") ? maximumBody : Math.min(maximumBody, 1024 * 1024);
    const length = headers.get("content-length");
    if (length && (!/^\d+$/.test(length) || Number(length) > cap)) return refusal(413);
    active += 1;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const bytes = await readLimited(body, cap, controller.signal, 413);
      if (READ.has(method) && bytes.byteLength) throw new GatewayError(400);
      const forwarded = new Headers();
      for (const [name, value] of headers) if (FORWARD_HEADERS.has(name)) forwarded.set(name, value);
      const cookies = (headers.get("cookie") ?? "").split(";").map(c => c.trim()).filter(c => {
        const name = c.slice(0, c.indexOf("=")).trim();
        return c && name !== ACCESS_COOKIE && name !== "prn_admin";
      });
      if (cookies.length) forwarded.set("cookie", cookies.join("; ")); else forwarded.delete("cookie");
      // Only this configured origin may influence Next server actions/share URLs.
      forwarded.set("host", publicUrl.host);
      forwarded.set("x-forwarded-host", publicUrl.host);
      forwarded.set("x-forwarded-proto", "https");
      forwarded.set("accept-encoding", "identity");
      if (headers.has("origin")) forwarded.set("origin", publicUrl.origin);
      if (headers.has("referer")) forwarded.set("referer", `${publicUrl.origin}${target.pathname}`);
      const destination = new URL(target.pathname, upstream);
      destination.search = target.search;
      const response = await untilAbort(fetchImpl(destination, { method, headers: forwarded, body: bytes.byteLength ? bytes : undefined, redirect: "manual", signal: controller.signal }), controller.signal);
      const resultHeaders = new Headers();
      for (const [name, value] of response.headers) if (!RESPONSE_DROP.has(name) && !name.startsWith("x-middleware-") && !name.startsWith("x-nextjs-")) resultHeaders.set(name, value);
      if (response.headers.has("location")) resultHeaders.set("location", redirectTarget(response.headers.get("location")));
      if (response.headers.has("content-location")) resultHeaders.set("content-location", redirectTarget(response.headers.get("content-location")));
      if (response.headers.has("x-action-redirect")) {
        const action = response.headers.get("x-action-redirect");
        const suffix = /;(push|replace)$/.exec(action)?.[0] ?? "";
        resultHeaders.set("x-action-redirect", redirectTarget(suffix ? action.slice(0, -suffix.length) : action) + suffix);
      }
      for (const cookie of response.headers.getSetCookie()) {
        if (cookie.startsWith(`${ACCESS_COOKIE}=`) || cookie.startsWith("prn_admin=")) continue;
        const hostOnly = cookie.replace(/;\s*Domain=[^;]*/gi, "");
        resultHeaders.append("set-cookie", /;\s*Secure(?:;|$)/i.test(hostOnly) ? hostOnly : `${hostOnly}; Secure`);
      }
      const responseBytes = await readLimited(response.body, maximumResponse, controller.signal, 502);
      const noBody = method === "HEAD" || [204, 205, 304].includes(response.status);
      return new Response(noBody ? null : responseBytes, { status: response.status, headers: securityHeaders(resultHeaders) });
    } catch (error) {
      return refusal(error instanceof GatewayError ? error.status : controller.signal.aborted ? 504 : 502);
    } finally { clearTimeout(timer); controller.abort(); active -= 1; }
  };
}

/** Explicit entry point only. No tunnel, installs, Next start, or outbound mail. */
export function startDemoGateway(env = process.env) {
  const publicUrl = checkedOrigin(env.PRN_DEMO_PUBLIC_ORIGIN);
  const base = path.resolve("data/runtime");
  const statePath = path.resolve(env.PRN_DEMO_GATEWAY_STATE_PATH ?? path.join(base, "client-demo-v1/gateway-access.json"));
  if (!statePath.toLowerCase().startsWith(base.toLowerCase() + path.sep)) throw new Error("Gateway state must remain under data/runtime.");
  const port = Number(env.PRN_DEMO_GATEWAY_PORT ?? 3190);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid gateway port.");
  const state = { inviteSecret: randomBytes(32).toString("base64url"), sessionSecret: randomBytes(32).toString("base64url"), public_origin: publicUrl.origin, created_at: new Date().toISOString() };
  state.invite_url = `${publicUrl.origin}/invite/${state.inviteSecret}`;
  const handle = createDemoGateway({ publicOrigin: publicUrl.origin, upstream: env.PRN_DEMO_UPSTREAM, ...state });
  const server = createServer({ maxHeaderSize: 16 * 1024, headersTimeout: 20_000, requestTimeout: 130_000 }, async (request, response) => {
    try {
      const result = await handle({ target: request.url, method: request.method, headers: request.headers, body: request });
      response.statusCode = result.status;
      for (const [name, value] of result.headers) if (name !== "set-cookie") response.setHeader(name, value);
      const cookies = result.headers.getSetCookie();
      if (cookies.length) response.setHeader("set-cookie", cookies);
      response.end(Buffer.from(await result.arrayBuffer()));
    } catch { response.writeHead(502, { "cache-control": "no-store" }); response.end("Request unavailable."); }
  });
  server.on("upgrade", (_request, socket) => socket.destroy());
  server.maxConnections = 32;
  server.on("clientError", (_error, socket) => socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n"));
  server.listen(port, "127.0.0.1", () => {
    mkdirSync(path.dirname(statePath), { recursive: true });
    const temporary = `${statePath}.${randomBytes(6).toString("hex")}.tmp`;
    writeFileSync(temporary, JSON.stringify(state, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    renameSync(temporary, statePath);
    console.log(`Private demo gateway is listening on loopback port ${port}. Invitation state: ${statePath}`);
  });
  server.on("error", () => { console.error("Private demo gateway could not start."); process.exitCode = 1; });
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { startDemoGateway(); } catch { console.error("Private demo gateway requires a valid HTTPS origin and isolated local state."); process.exitCode = 1; }
}
