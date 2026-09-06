import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const modulePath = fileURLToPath(new URL('../tools/audit-door-release.mjs', import.meta.url));
// Native Node handles a checked-out CRLF shebang; Vite's dynamic loader does not.
const { auditDoorRelease, SECTION_IDS, robotsAllows } = createRequire(import.meta.url)(modulePath);
const servers: Server[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => {
  server.closeAllConnections(); server.close(() => resolve());
}))); });

type Variant = 'good' | 'missing-page' | 'no-body' | 'relative-canonical' | 'wrong-image-size' |
  'missing-image' | 'corrupt-image' | 'wrong-image-mime' | 'external-redirect' | 'credential-link' | 'token-link' | 'missing-section' | 'pending-capability' | 'empty-sitemap' | 'preview-listed' | 'unexplained-sitemap-204';

async function fixture(variant: Variant = 'good', mode = 'preview') {
  const requests: string[] = [];
  let origin = '';
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVR4nGP4////fwAJ+wP9KobjigAAAABJRU5ErkJggg==', 'base64');
  const server = createServer((req, res) => {
    requests.push(req.url ?? '');
    expect(req.method).toBe('GET');
    expect(req.headers.authorization).toBeUndefined();
    expect(req.headers.cookie).toBeUndefined();
    const url = req.url ?? '';
    if (url === '/problems/ac-blowing-warm-air') {
      if (variant === 'missing-page') { res.writeHead(404); res.end('not here'); return; }
      if (variant === 'external-redirect') { res.writeHead(302, { location: 'https://outside.invalid/private?token=do-not-copy' }); res.end(); return; }
      res.setHeader('content-type', 'text/html');
      if (mode === 'preview') res.setHeader('x-robots-tag', 'noindex, nofollow');
      const image = `${origin}/image.png`;
      const sectionIds = variant === 'missing-section' ? SECTION_IDS.slice(1) : SECTION_IDS;
      const objects = Array.from({ length: 3 }, () => ({ '@type': 'ImageObject', contentUrl: image,
        width: variant === 'wrong-image-size' ? 1200 : 1, height: 1, encodingFormat: 'image/png' }));
      const badLink = variant === 'credential-link' ? `<a href="${origin.replace('://', '://user:never-copy@')}/private">bad</a>` :
        variant === 'token-link' ? '<a href="/private?token=never-copy">bad</a>' : '';
      const head = `<head><link rel="canonical" href="${variant === 'relative-canonical' ? '/problems/ac-blowing-warm-air' : origin + '/problems/ac-blowing-warm-air'}">
        <meta name="robots" content="${mode === 'preview' ? 'noindex,nofollow' : 'index,follow'}">
        <meta property="og:image" content="${image}"><meta property="og:image:width" content="1"><meta property="og:image:height" content="1"><meta property="og:image:type" content="image/png">
        <meta name="twitter:image" content="${image}"><meta name="twitter:title" content="Title"><meta name="twitter:description" content="Description">
        <script type="application/ld+json">${JSON.stringify({ '@graph': objects })}</script></head>`;
      res.end(`<html>${head}${variant === 'no-body' ? '' : `<body><h1>AC warm air</h1>${sectionIds.map((id: string) => `<section id="${id}">content</section>`).join('')}
        <p id="direct-answer">Answer</p><table><tr><td>Capability</td></tr></table><section id="sources-and-review">${Array.from({ length: 11 }, (_, i) => `<a id="src-${i + 1}">source</a>`).join('')}</section>
        <form id="home-problem-intake" action="/api/intake/start" method="post" enctype="multipart/form-data"><textarea name="problem_description"></textarea><button type="submit">Begin</button></form><a href="/cooling/">Cooling</a>${badLink}</body>`}</html>`);
    } else if (url === '/image.png') {
      res.writeHead(variant === 'missing-image' ? 404 : 200, { 'content-type': variant === 'wrong-image-mime' ? 'text/html' : 'image/png' });
      res.end(variant === 'missing-image' ? '' : variant === 'corrupt-image' ? png.subarray(0, 33) : png);
    } else if (url === '/robots.txt') {
      res.setHeader('content-type', 'text/plain'); res.end(`User-agent: *\n${mode === 'preview' ? 'Disallow: /' : 'Allow: /'}\nSitemap: ${origin}/sitemap.xml\n`);
    } else if (url === '/sitemap.xml') {
      if ((mode === 'preview' && variant !== 'preview-listed') || variant === 'empty-sitemap') {
        res.writeHead(204, variant === 'unexplained-sitemap-204' ? {} : { 'x-prn-publication-state': 'held-noindex', 'x-robots-tag': 'noindex, nofollow' });
        res.end(); return;
      }
      const listed = mode === 'production' || variant === 'preview-listed';
      res.setHeader('content-type', 'application/xml'); res.end(`<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">${listed ? `<url><loc>${origin}/problems/ac-blowing-warm-air</loc><image:image><image:loc>${origin}/image.png</image:loc></image:image></url>` : ''}</urlset>`);
    } else if (url === '/image-sitemap.xml') {
      res.writeHead(204, { 'x-prn-publication-state': 'held-noindex', 'x-robots-tag': 'noindex, nofollow' }); res.end();
    } else if (url === '/capabilities/home-problem-analyzer.json') {
      res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ capabilities: Array.from({ length: 9 }, (_, i) => ({ capability_id: `cap.${i}`, live_status: variant === 'pending-capability' ? 'PENDING_RUNTIME_VERIFICATION' : 'LIVE' })) }));
    } else if (url === '/cooling/') { res.setHeader('content-type', 'text/html'); res.end('<html><body>Cooling</body></html>'); }
    else { res.writeHead(404); res.end('missing'); }
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing fixture address');
  origin = `http://127.0.0.1:${address.port}`;
  return { origin, requests };
}

describe('read-only door HTTP release audit', () => {
  it.each(['preview', 'production'])('passes valid %s HTTP evidence without granting release approval', async (mode) => {
    const { origin } = await fixture('good', mode);
    const report = await auditDoorRelease({ origin, mode });
    expect(report.checks.filter((check: { passed: boolean }) => !check.passed)).toEqual([]);
    expect(report.http_checks_passed).toBe(true);
    expect(report.full_release_approved).toBe(false);
    expect(report.capabilities.actual_runtime_outcomes_verified).toBe(false);
    expect(report.unperformed_checks.length).toBeGreaterThan(0);
  });
  it.each([
    ['missing-page', 'page.http_200'], ['no-body', 'page.body_present'],
    ['relative-canonical', 'page.canonical_absolute_unique'], ['wrong-image-size', 'images.metadata_matches'],
    ['missing-image', 'images.target_200'], ['corrupt-image', 'images.png_decodable'],
    ['wrong-image-mime', 'images.mime_matches_bytes'], ['missing-section', 'page.section.hero'],
  ] as const)('fails %s with structured evidence', async (variant, checkId) => {
    const { origin } = await fixture(variant);
    const report = await auditDoorRelease({ origin, mode: 'preview' });
    expect(report.http_checks_passed).toBe(false);
    expect(report.checks.some((check: { id: string; passed: boolean }) => check.id === checkId && !check.passed)).toBe(true);
  });
  it('refuses external redirects without serializing their destination or token', async () => {
    const { origin } = await fixture('external-redirect');
    const report = await auditDoorRelease({ origin, mode: 'preview' });
    expect(report.http_checks_passed).toBe(false);
    expect(report.probes.some((probe: { error?: string }) => probe.error === 'off_origin_redirect_refused')).toBe(true);
    expect(JSON.stringify(report)).not.toMatch(/outside\.invalid|do-not-copy/);
  });
  it.each(['credential-link', 'token-link'] as const)('never requests or records secret-bearing %s', async (variant) => {
    const { origin, requests } = await fixture(variant);
    const report = await auditDoorRelease({ origin, mode: 'preview' });
    expect(report.http_checks_passed).toBe(false);
    expect(requests.some((path) => path.startsWith('/private'))).toBe(false);
    expect(JSON.stringify(report)).not.toContain('never-copy');
  });
  it('rejects credential-bearing input before making requests', async () => {
    const report = await auditDoorRelease({ origin: 'https://user:never-copy@example.com', mode: 'preview' });
    expect(report.probes).toEqual([]);
    expect(report.http_checks_passed).toBe(false);
    expect(JSON.stringify(report)).not.toContain('never-copy');
  });
  it('requires LIVE manifest flags for production but still does not verify the runtime', async () => {
    const { origin } = await fixture('pending-capability', 'production');
    const report = await auditDoorRelease({ origin, mode: 'production' });
    expect(report.http_checks_passed).toBe(false);
    expect(report.checks.some((check: { id: string; passed: boolean }) => check.id === 'capabilities.production_live_status' && !check.passed)).toBe(true);
  });
  it('accepts intentionally deferred preview inventories without claiming production membership', async () => {
    const { origin } = await fixture('empty-sitemap');
    const report = await auditDoorRelease({ origin, mode: 'preview' });
    expect(report.http_checks_passed).toBe(true);
    expect(report.checks).toContainEqual(expect.objectContaining({ id: 'sitemap.preview_inventory_empty', passed: true }));
    expect(report.checks).toContainEqual(expect.objectContaining({ id: 'sitemap.preview_intentionally_deferred', passed: true, production_membership_verified: false }));
    expect(report.checks.some((check: { id: string }) => check.id === 'sitemap.canonical_page_present')).toBe(false);
  });
  it('rejects unexplained empty HTTP responses instead of treating an outage as the hold', async () => {
    const { origin } = await fixture('unexplained-sitemap-204');
    const report = await auditDoorRelease({ origin, mode: 'preview' });
    expect(report.checks).toContainEqual(expect.objectContaining({ id: 'sitemap.preview_intentionally_deferred', passed: false }));
  });
  it('fails preview inventories that advertise noindexed pages', async () => {
    const { origin } = await fixture('preview-listed');
    const report = await auditDoorRelease({ origin, mode: 'preview' });
    expect(report.checks).toContainEqual(expect.objectContaining({ id: 'sitemap.preview_inventory_empty', passed: false }));
  });
  it('still requires the canonical page and every declared image in production', async () => {
    const { origin } = await fixture('empty-sitemap', 'production');
    const report = await auditDoorRelease({ origin, mode: 'production' });
    expect(report.checks).toContainEqual(expect.objectContaining({ id: 'sitemap.canonical_page_present', passed: false }));
    expect(report.checks).toContainEqual(expect.objectContaining({ id: 'sitemap.all_declared_images_present', passed: false }));
  });
  it('handles crawler-specific disallow and allow specificity', () => {
    expect(robotsAllows('User-agent: *\nDisallow: /\nUser-agent: Googlebot\nAllow: /problems/\n', 'Googlebot', '/problems/ac')).toBe(true);
    expect(robotsAllows('User-agent: *\nDisallow: /\n', 'Bingbot', '/problems/ac')).toBe(false);
    expect(robotsAllows('User-agent: *\nDisallow: /private*\nAllow: /private-public/\n', 'OAI-SearchBot', '/private-public/a')).toBe(true);
  });
});
