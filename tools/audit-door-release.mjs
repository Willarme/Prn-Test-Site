#!/usr/bin/env node
/** Read-only HTTP evidence, never release approval. Native Node; no credentials or POSTs. */
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { inflateSync } from 'node:zlib';
import { Buffer } from 'node:buffer';
import process from 'node:process';

export const SECTION_IDS = ['hero', 'intake', 'stats', 'observations-that-matter', 'common-causes',
  'what-to-check', 'visual-explainers', 'why-this-is-different', 'general-vs-yours',
  'what-this-tool-can-answer', 'job-packet', 'repair-record', 'faq', 'related', 'related-closer'];
const CRAWLERS = ['Googlebot', 'Bingbot', 'OAI-SearchBot'];
const MAX_LINKS = 64;
const MAX_IMAGES = 16;
const MAX_SITEMAPS = 8;
const SECRET_KEYS = /^(?:access[_-]?token|token|key|api[_-]?key|secret|password|authorization|signature|sig|code|session|credential|jwt|owner[_-]?token)$/i;
const TOKEN_MARKER = /\{\{[^}]+\}\}|\{%[\s\S]*?%\}/;
const LIMITS = { document: 2_000_000, image: 12_000_000 };

function decode(value = '') {
  return String(value).replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>');
}
function attrs(tag) {
  const found = {};
  for (const match of tag.matchAll(/([^\s=<>/]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g)) {
    found[match[1].toLowerCase()] = decode(match[2] ?? match[3] ?? match[4]);
  }
  return found;
}
function tags(html, name) {
  return [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'gi'))].map((x) => attrs(x[0]));
}
function ids(html) { return new Set([...html.matchAll(/\bid\s*=\s*["']([^"']+)["']/gi)].map((x) => x[1])); }
function mime(value = '') { return String(value ?? '').split(';')[0].trim().toLowerCase(); }
function number(value) { return Number(typeof value === 'object' ? value?.value : value); }
function normalPath(path) { return path.replace(/\/+$/, '') || '/'; }
function isAbsolute(value) { return /^https?:\/\//i.test(value ?? ''); }

export function validateOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('origin_must_be_an_explicit_http_origin'); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('origin_must_not_contain_credentials_path_query_or_fragment');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) {
    throw new Error('origin_requires_https_except_local_test_servers');
  }
  return url.origin;
}

function safeTarget(raw, origin, base = origin) {
  let url;
  try { url = new URL(decode(raw), base); } catch { return { error: 'invalid_url' }; }
  if (url.username || url.password) return { error: 'credential_url_refused' };
  if (url.origin !== origin) return { error: 'off_origin_url_refused' };
  if ([...url.searchParams.keys()].some((key) => SECRET_KEYS.test(key))) return { error: 'sensitive_query_refused' };
  // No query is forwarded: these probes inspect public resources, never token or campaign actions.
  if (url.search) return { error: 'query_url_refused' };
  url.hash = '';
  return { url };
}
function displayUrl(url, origin) {
  try { const parsed = new URL(url, origin); return parsed.origin === origin ? parsed.pathname : '[outside explicit origin]'; }
  catch { return '[invalid URL]'; }
}

async function boundedBody(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) throw new Error('response_too_large');
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > limit) throw new Error('response_too_large');
      chunks.push(Buffer.from(next.value));
    }
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  return Buffer.concat(chunks);
}

function pngSize(buffer) {
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    || buffer.toString('ascii', 12, 16) !== 'IHDR' || buffer.readUInt32BE(8) !== 13) return null;
  const width = buffer.readUInt32BE(16), height = buffer.readUInt32BE(20);
  if (!width || !height) return null;
  const bitDepth = buffer[24], colorType = buffer[25], interlace = buffer[28];
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 })[colorType];
  const legalDepths = ({ 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] })[colorType];
  if (!channels || !legalDepths.includes(bitDepth) || buffer[26] !== 0 || buffer[27] !== 0 || interlace > 1) return null;
  const compressed = [];
  let offset = 8, ended = false;
  while (offset + 12 <= buffer.length) {
    const length = buffer.readUInt32BE(offset), kind = buffer.toString('ascii', offset + 4, offset + 8);
    if (offset + 12 + length > buffer.length) return null;
    if (kind === 'IDAT') compressed.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
    if (kind === 'IEND') { ended = length === 0; break; }
  }
  if (!ended || offset !== buffer.length || !compressed.length) return null;
  try {
    const pixels = inflateSync(Buffer.concat(compressed), { maxOutputLength: 64_000_000 });
    const passes = interlace ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4],
      [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]];
    let pixelOffset = 0;
    for (const [x, y, dx, dy] of passes) {
      const passWidth = Math.max(0, Math.ceil((width - x) / dx));
      const passHeight = Math.max(0, Math.ceil((height - y) / dy));
      if (!passWidth || !passHeight) continue;
      const rowBytes = Math.ceil(passWidth * channels * bitDepth / 8) + 1;
      for (let row = 0; row < passHeight; row++) {
        if (pixelOffset >= pixels.length || pixels[pixelOffset] > 4) return null;
        pixelOffset += rowBytes;
      }
    }
    if (pixelOffset !== pixels.length) return null;
  } catch { return null; }
  return { width, height };
}

/** Select the most specific UA group and the longest matching rule; Allow wins ties. */
export function robotsAllows(body, agent, path) {
  const groups = [];
  let group = { agents: [], rules: [] }, hasRules = false;
  for (const original of body.split(/\r?\n/)) {
    const line = original.replace(/#.*$/, '').trim();
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const name = line.slice(0, colon).trim().toLowerCase(), value = line.slice(colon + 1).trim();
    if (name === 'user-agent') {
      if (hasRules) { groups.push(group); group = { agents: [], rules: [] }; hasRules = false; }
      group.agents.push(value.toLowerCase());
    } else if (['allow', 'disallow'].includes(name) && group.agents.length) {
      group.rules.push({ allow: name === 'allow', path: value }); hasRules = true;
    }
  }
  groups.push(group);
  const matching = groups.map((g) => ({ ...g, specificity: Math.max(-1, ...g.agents.map((a) =>
    a === '*' ? 0 : agent.toLowerCase().includes(a) ? a.length : -1)) })).filter((g) => g.specificity >= 0);
  const best = Math.max(-1, ...matching.map((g) => g.specificity));
  let winner = null;
  for (const rule of matching.filter((g) => g.specificity === best).flatMap((g) => g.rules)) {
    if (!rule.path) continue;
    const pattern = '^' + rule.path.replace(/[.+?^{}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\$$/, '$');
    let matches = false;
    try { matches = new RegExp(pattern).test(path); } catch { return false; }
    const length = rule.path.replace(/[*$]/g, '').length;
    if (matches && (!winner || length > winner.length || (length === winner.length && rule.allow))) {
      winner = { ...rule, length };
    }
  }
  return winner ? winner.allow : true;
}

function imageObjects(value, results = []) {
  if (!value || typeof value !== 'object') return results;
  if (value['@type'] === 'ImageObject' || (Array.isArray(value['@type']) && value['@type'].includes('ImageObject'))) results.push(value);
  for (const child of Object.values(value)) if (typeof child === 'object') imageObjects(child, results);
  return results;
}

export async function auditDoorRelease({ origin: givenOrigin, mode, pagePath = '/problems/ac-blowing-warm-air', timeoutMs = 15000 } = {}) {
  const report = { schema_version: 1, generated_at: new Date().toISOString(), mode,
    origin: null, page_path: null, http_checks_passed: false, full_release_approved: false,
    checks: [], probes: [], limits: { internal_links: MAX_LINKS, images: MAX_IMAGES, sitemaps: MAX_SITEMAPS },
    unperformed_checks: ['Rendered desktop/mobile device matrix and Core Web Vitals',
      'Accessibility tree, keyboard, no-JS, runtime-exception and reduced-motion behavior',
      'Real form submission, photo/audio/video interpretation and nine production capability outcomes',
      'Source/claim support and freshness, consent/privacy and real-data suppression evidence',
      'Domain/console ownership, launch authorization and deployment authority',
      'Production sitemap XSD validation and exact publication-store/renderer reconciliation',
      'Actual pinned-v43 verification on both Joshua and Melissa machines'],
    scope: 'GET-only public HTTP inspection. No model calls, credentials, form submissions, publication or configuration changes.' };
  const add = (id, passed, details = {}) => report.checks.push({ id, passed: Boolean(passed), ...details });
  let origin;
  try { origin = validateOrigin(givenOrigin); } catch (error) { add('configuration.origin', false, { reason: error.message }); return report; }
  report.origin = origin;
  if (!['preview', 'production'].includes(mode)) { add('configuration.mode', false, { reason: 'mode_must_be_preview_or_production' }); return report; }
  const pageTarget = safeTarget(pagePath, origin);
  if (pageTarget.error || !String(pagePath).startsWith('/') || String(pagePath).startsWith('//')) {
    add('configuration.page_path', false, { reason: pageTarget.error ?? 'page_path_must_be_origin_relative' }); return report;
  }
  const pageUrl = pageTarget.url.href;
  report.page_path = pageTarget.url.pathname;
  async function get(raw, { userAgent = 'PRN-Door-Release-Audit/1.0', image = false, purpose = 'resource' } = {}) {
    const target = safeTarget(raw, origin, pageUrl);
    const probe = { purpose, path: target.url ? displayUrl(target.url.href, origin) : '[refused URL]',
      user_agent: userAgent, status: null, content_type: null, redirect_count: 0 };
    report.probes.push(probe);
    if (target.error) { probe.error = target.error; return { ...probe, body: Buffer.alloc(0), headers: {} }; }
    let current = target.url;
    try {
      for (let redirects = 0; redirects <= 4; redirects++) {
        const response = await globalThis.fetch(current, { method: 'GET', redirect: 'manual', credentials: 'omit',
          headers: { 'user-agent': userAgent, accept: image ? 'image/png,image/*;q=0.8' : '*/*' },
          signal: globalThis.AbortSignal.timeout(timeoutMs) });
        probe.status = response.status; probe.content_type = mime(response.headers.get('content-type'));
        probe.redirect_count = redirects;
        if ([301, 302, 303, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          await response.body?.cancel();
          if (!location) throw new Error('redirect_missing_location');
          const next = safeTarget(location, origin, current.href);
          if (next.error) throw new Error(next.error === 'off_origin_url_refused' ? 'off_origin_redirect_refused' : next.error);
          if (redirects === 4) throw new Error('redirect_limit_exceeded');
          current = next.url; continue;
        }
        const body = await boundedBody(response, image ? LIMITS.image : LIMITS.document);
        return { ...probe, body, finalUrl: current.href, headers: {
          robots: response.headers.get('x-robots-tag') ?? '',
          publication_state: response.headers.get('x-prn-publication-state') ?? '',
        } };
      }
    } catch (error) {
      // Never serialize fetch errors, response text, Location, cookies or arbitrary URLs.
      const allowed = ['response_too_large', 'redirect_missing_location', 'off_origin_redirect_refused',
        'credential_url_refused', 'sensitive_query_refused', 'query_url_refused', 'redirect_limit_exceeded', 'invalid_url'];
      probe.error = allowed.includes(error.message) ? error.message : 'network_or_timeout_failure';
    }
    return { ...probe, body: Buffer.alloc(0), headers: {} };
  }
  const page = await get(pageUrl, { purpose: 'door_page' });
  add('page.http_200', page.status === 200 && !page.error, { status: page.status, error: page.error });
  add('page.html_content_type', ['text/html', 'application/xhtml+xml'].includes(page.content_type));
  const html = page.body.toString('utf8');
  const bodyMatch = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i.exec(html);
  const body = bodyMatch?.[1] ?? '';
  add('page.body_present', Boolean(bodyMatch && body.trim()));
  const metas = tags(html, 'meta');
  const metaValues = (name) => metas.filter((m) => (m.name ?? m.property ?? '').toLowerCase() === name).map((m) => m.content ?? '');
  const canonicalLinks = tags(html, 'link').filter((l) => l.rel?.toLowerCase().split(/\s+/).includes('canonical'));
  const canonical = canonicalLinks[0]?.href;
  const canonicalTarget = canonical ? safeTarget(canonical, origin, pageUrl) : {};
  add('page.canonical_absolute_unique', canonicalLinks.length === 1 && isAbsolute(canonical) && Boolean(canonicalTarget.url)
    && !new URL(canonical).hash && normalPath(canonicalTarget.url.pathname) === normalPath(pageTarget.url.pathname), { canonical_count: canonicalLinks.length });
  const robotMeta = [...metaValues('robots'), ...metaValues('googlebot'), ...metaValues('bingbot'), ...metaValues('oai-searchbot')].join(',');
  const headerNoindex = /\bnoindex\b|\bnone\b/i.test(page.headers.robots ?? '');
  const metaNoindex = /\bnoindex\b|\bnone\b/i.test(robotMeta);
  add('page.robots_mode', mode === 'preview' ? headerNoindex || metaNoindex : !headerNoindex && !metaNoindex,
    { header_noindex: headerNoindex, meta_noindex: metaNoindex, expected: mode === 'preview' ? 'noindex' : 'indexable' });
  add('page.one_h1', (body.match(/<h1\b/gi) ?? []).length === 1);
  const bodyIds = ids(body);
  for (const id of SECTION_IDS) add(`page.section.${id}`, bodyIds.has(id));
  add('page.direct_answer', bodyIds.has('direct-answer'));
  add('page.capability_initial_html', bodyIds.has('what-this-tool-can-answer') && /<table\b/i.test(body));
  add('page.source_initial_html', bodyIds.has('sources-and-review') && Array.from({ length: 11 }, (_, i) => `src-${i + 1}`).every((id) => bodyIds.has(id)));
  const forms = tags(body, 'form');
  const form = forms.find((f) => f.id === 'home-problem-intake');
  const action = form?.action ? safeTarget(form.action, origin, pageUrl) : {};
  add('page.actionable_form_markup', forms.length === 1 && action.url?.pathname === '/api/intake/start'
    && form?.method?.toLowerCase() === 'post' && form?.enctype?.toLowerCase() === 'multipart/form-data'
    && /\bname=["']problem_description["']/i.test(body) && /<button\b[^>]*\btype=["']submit["']/i.test(body));
  add('page.no_unresolved_tokens', !TOKEN_MARKER.test(html));

  const linkTargets = new Map();
  let unsafeLinks = 0;
  for (const link of tags(body, 'a')) {
    const href = link.href;
    if (!href || href.startsWith('#') || /^(?:mailto|tel|javascript|data):/i.test(href)) continue;
    let parsed;
    try { parsed = new URL(href, pageUrl); } catch { unsafeLinks++; continue; }
    if (parsed.origin !== origin) continue;
    const target = safeTarget(href, origin, pageUrl);
    if (target.error) { unsafeLinks++; continue; }
    linkTargets.set(target.url.href, target.url.pathname);
  }
  add('links.safe_public_targets', unsafeLinks === 0, { refused_count: unsafeLinks });
  add('links.bounded_inventory', linkTargets.size <= MAX_LINKS, { found: linkTargets.size, maximum: MAX_LINKS });
  for (const [url, path] of [...linkTargets].slice(0, MAX_LINKS)) {
    const result = await get(url, { purpose: 'internal_link' });
    add('links.target_200', result.status === 200 && !result.error, { path, status: result.status, error: result.error });
  }

  const objects = [];
  let jsonErrors = 0;
  for (const script of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)) {
    if (attrs(script[1]).type?.toLowerCase() !== 'application/ld+json') continue;
    try { imageObjects(JSON.parse(script[2]), objects); } catch { jsonErrors++; }
  }
  add('images.jsonld_parse', jsonErrors === 0, { parse_failures: jsonErrors });
  add('images.imageobject_present', objects.length >= 3, { count: objects.length });
  const images = new Map();
  function addImage(raw, expected, source) {
    const target = safeTarget(raw ?? '', origin, pageUrl);
    if (!raw || !isAbsolute(raw) || target.error) {
      add('images.absolute_safe_url', false, { source, reason: target.error ?? 'absolute_url_required' }); return;
    }
    const entry = images.get(target.url.href) ?? { path: target.url.pathname, metadata: [] };
    entry.metadata.push({ ...expected, source }); images.set(target.url.href, entry);
  }
  for (const object of objects) addImage(object.contentUrl ?? object.url, {
    width: number(object.width), height: number(object.height), type: object.encodingFormat,
  }, 'ImageObject');
  const og = metaValues('og:image'), twitter = metaValues('twitter:image');
  add('images.social_metadata_present', og.length === 1 && twitter.length === 1
    && metaValues('twitter:title').length === 1 && metaValues('twitter:description').length === 1);
  for (const raw of og) addImage(raw, { width: number(metaValues('og:image:width')[0]),
    height: number(metaValues('og:image:height')[0]), type: metaValues('og:image:type')[0] }, 'og:image');
  for (const raw of twitter) addImage(raw, {}, 'twitter:image');
  add('images.bounded_inventory', images.size <= MAX_IMAGES, { found: images.size, maximum: MAX_IMAGES });
  for (const [url, entry] of [...images].slice(0, MAX_IMAGES)) {
    const result = await get(url, { image: true, purpose: 'declared_image' });
    add('images.target_200', result.status === 200 && !result.error, { path: entry.path, status: result.status, error: result.error });
    const decoded = pngSize(result.body);
    add('images.png_decodable', Boolean(decoded), { path: entry.path });
    add('images.mime_matches_bytes', decoded && result.content_type === 'image/png', { path: entry.path, content_type: result.content_type });
    for (const expected of entry.metadata) {
      if (expected.source === 'twitter:image') continue; // Twitter supplies no independent size/type fields.
      add('images.metadata_matches', decoded && expected.width === decoded.width && expected.height === decoded.height
        && mime(expected.type) === result.content_type, { path: entry.path, source: expected.source,
        expected_width: Number.isFinite(expected.width) ? expected.width : null,
        expected_height: Number.isFinite(expected.height) ? expected.height : null,
        actual_width: decoded?.width ?? null, actual_height: decoded?.height ?? null });
    }
  }

  const sitemapQueue = new Set(['/sitemap.xml']);
  for (const crawler of CRAWLERS) {
    const robot = await get('/robots.txt', { userAgent: crawler, purpose: 'crawler_robots' });
    const text = robot.body.toString('utf8');
    const allowed = robotsAllows(text, crawler, pageTarget.url.pathname);
    add('robots.crawler_http_200', robot.status === 200 && !robot.error, { crawler, status: robot.status });
    add('robots.crawler_mode', mode === 'preview' ? !allowed : allowed, { crawler, allowed });
    for (const match of text.matchAll(/^\s*sitemap\s*:\s*(\S+)\s*$/gim)) sitemapQueue.add(match[1]);
    const crawled = await get(pageUrl, { userAgent: crawler, purpose: 'crawler_page' });
    const crawledHtml = crawled.body.toString('utf8');
    add('crawler.page_200_content', crawled.status === 200 && !crawled.error && /<h1\b/i.test(crawledHtml)
      && ids(crawledHtml).has('direct-answer') && ids(crawledHtml).has('sources-and-review'), { crawler, status: crawled.status });
  }
  const visitedSitemaps = new Set(), sitemapLocations = new Set(), sitemapImages = new Set();
  let sitemapPageEntries = 0, sitemapImageEntries = 0;
  async function visitSitemap(raw) {
    const target = safeTarget(raw, origin);
    if (target.error) { add('sitemap.safe_target', false, { reason: target.error }); return; }
    if (visitedSitemaps.has(target.url.href)) return;
    visitedSitemaps.add(target.url.href);
    const result = await get(target.url.href, { purpose: 'sitemap' });
    if (mode === 'preview' && result.status === 204) {
      add('sitemap.preview_intentionally_deferred', !result.error && result.body.length === 0 &&
        result.headers.publication_state === 'held-noindex' && /\bnoindex\b/i.test(result.headers.robots ?? ''),
      { path: target.url.pathname, status: result.status, production_membership_verified: false });
      return;
    }
    if (mode === 'preview') add('sitemap.preview_explicit_hold', false,
      { path: target.url.pathname, status: result.status, expected: 'HTTP 204 with explicit held-noindex headers' });
    add('sitemap.http_200', result.status === 200 && !result.error, { path: target.url.pathname, status: result.status });
    const xml = result.body.toString('utf8');
    add('sitemap.xml', /<(?:urlset|sitemapindex)\b/i.test(xml) && !/<html\b/i.test(xml), { path: target.url.pathname });
    if (/<sitemapindex\b/i.test(xml)) {
      for (const match of xml.matchAll(/<loc\b[^>]*>([^<]+)<\/loc>/gi)) sitemapQueue.add(decode(match[1].trim()));
    } else {
      sitemapPageEntries += [...xml.matchAll(/<url\b/gi)].length;
      sitemapImageEntries += [...xml.matchAll(/<image:image\b/gi)].length;
      for (const match of xml.matchAll(/<loc\b[^>]*>([^<]+)<\/loc>/gi)) {
        const targetLoc = safeTarget(decode(match[1].trim()), origin);
        if (targetLoc.url && isAbsolute(decode(match[1].trim()))) sitemapLocations.add(targetLoc.url.href);
        else add('sitemap.absolute_same_origin_location', false);
      }
      for (const match of xml.matchAll(/<image:loc\b[^>]*>([^<]+)<\/image:loc>/gi)) {
        const targetImage = safeTarget(decode(match[1].trim()), origin);
        if (targetImage.url && isAbsolute(decode(match[1].trim()))) sitemapImages.add(targetImage.url.href);
        else add('sitemap.absolute_same_origin_image', false);
      }
    }
  }
  for (const raw of sitemapQueue) { if (visitedSitemaps.size >= MAX_SITEMAPS) break; await visitSitemap(raw); }
  if (!sitemapImages.size && visitedSitemaps.size < MAX_SITEMAPS) await visitSitemap('/image-sitemap.xml');
  add('sitemap.bounded_inventory', sitemapQueue.size <= MAX_SITEMAPS, { maximum: MAX_SITEMAPS });
  if (mode === 'preview') {
    // The held site is globally noindexed. Including its preview page merely
    // to pass a production-membership check would contradict that policy.
    // HTTP 204 with explicit hold headers is deferred, not a sitemap success.
    add('sitemap.preview_inventory_empty', sitemapPageEntries === 0 && sitemapImageEntries === 0 &&
      sitemapLocations.size === 0 && sitemapImages.size === 0,
    { page_entries: sitemapPageEntries, image_entries: sitemapImageEntries, production_schema_validated: false });
  } else {
    add('sitemap.canonical_page_present', [...sitemapLocations].some((url) => normalPath(new URL(url).pathname) === normalPath(pageTarget.url.pathname)));
    add('sitemap.all_declared_images_present', images.size > 0 && [...images.keys()].every((url) => sitemapImages.has(url)),
      { declared_images: images.size, found_image_entries: sitemapImages.size });
  }

  const manifest = await get('/capabilities/home-problem-analyzer.json', { purpose: 'capability_manifest' });
  add('capabilities.http_200', manifest.status === 200 && !manifest.error, { status: manifest.status });
  let registry;
  try { registry = JSON.parse(manifest.body.toString('utf8')); } catch { /* Failure recorded below. */ }
  const capabilities = Array.isArray(registry?.capabilities) ? registry.capabilities : [];
  add('capabilities.nine_unique_rows', capabilities.length === 9 && new Set(capabilities.map((row) => row.capability_id)).size === 9
    && capabilities.every((row) => typeof row.capability_id === 'string' && typeof row.live_status === 'string'));
  add('capabilities.no_unresolved_tokens', Boolean(registry) && !TOKEN_MARKER.test(JSON.stringify(registry)));
  report.capabilities = { declared: capabilities.length, marked_live: capabilities.filter((row) => row.live_status === 'LIVE').length,
    actual_runtime_outcomes_verified: false };
  if (mode === 'production') add('capabilities.production_live_status', capabilities.length === 9 && capabilities.every((row) => row.live_status === 'LIVE'));
  report.http_checks_passed = report.checks.length > 0 && report.checks.every((check) => check.passed);
  report.summary = { passed: report.checks.filter((check) => check.passed).length,
    failed: report.checks.filter((check) => !check.passed).length, requests: report.probes.length };
  return report;
}

async function main() {
  const options = {};
  const flags = new Map([['--origin', 'origin'], ['--mode', 'mode'], ['--page-path', 'pagePath'], ['--out', 'out']]);
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const key = flags.get(args[i]);
    if (!key || !args[i + 1] || args[i + 1].startsWith('--') || options[key]) {
      process.stderr.write('Usage: node tools/audit-door-release.mjs --origin https://host --mode preview|production [--page-path /problems/ac-blowing-warm-air] --out report.json\n');
      process.exitCode = 2; return;
    }
    options[key] = args[++i];
  }
  if (!options.origin || !options.mode || !options.out) {
    process.stderr.write('Required: --origin, --mode and --out. No credentials are accepted.\n'); process.exitCode = 2; return;
  }
  const report = await auditDoorRelease(options);
  const output = resolve(options.out);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', 'utf8');
  process.stdout.write(JSON.stringify({ http_checks_passed: report.http_checks_passed,
    full_release_approved: false, summary: report.summary, failed_checks: report.checks.filter((check) => !check.passed).map((check) => check.id) }) + '\n');
  process.exitCode = report.http_checks_passed ? 0 : 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => { process.stderr.write('Audit failed before writing its report; no private exception details emitted.\n'); process.exitCode = 2; });
}
