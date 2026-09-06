#!/usr/bin/env node
/** Bounded browser evidence for the frozen door. Never submits an intake or approves release. */
/* global window, document, getComputedStyle, Element, innerWidth, innerHeight, matchMedia, fetch, AbortSignal */
import puppeteer from 'puppeteer-core';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import process from 'node:process';
import { SECTION_IDS, validateOrigin } from './audit-door-release.mjs';

const PAGE_PATH = '/problems/ac-blowing-warm-air';
// The frozen AC page has five FAQ answers (the generic template permits four to six).
const FAQ_COUNT = 5;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sha256 = value => createHash('sha256').update(value).digest('hex');
export const MATRIX = [
  ...[320, 360, 375, 390, 412, 430, 768, 1024, 1280, 1440, 1920, 2560].map(width => ({
    name: `width-${width}`, width, height: width < 500 ? 812 : width < 1280 ? 1024 : 900,
    touch: width < 1180, js: true, reduced: false,
  })),
  ...[{ width: 812, height: 375 }, { width: 1024, height: 768 }, { width: 1440, height: 720 }].map(size => ({
    name: `landscape-${size.width}x${size.height}`, ...size, touch: size.width < 1180, js: true, reduced: false,
  })),
  ...['no-js', 'reduced-motion', 'injected-exception'].flatMap(mode => [375, 1280].map(width => ({
    name: `${mode}-${width}`, width, height: width === 375 ? 812 : 900, touch: width === 375,
    js: mode !== 'no-js', reduced: mode === 'reduced-motion',
    fault: mode === 'injected-exception' ? width === 375 ? 'tagged-init' : 'deck-active' : null,
  }))),
];

/** Modify only the intercepted response, after real reveal/deck state was introduced. */
export function injectDeckFailure(html, mode) {
  const anchors = {
    'tagged-init': '  chapters.forEach(tagChapter);',
    'deck-active': "      root.classList.add('deck');",
  };
  const anchor = anchors[mode];
  if (!anchor || html.split(anchor).length !== 2) throw new Error('fault_injection_anchor_not_unique');
  const marker = `window.__prnAuditInjected=${JSON.stringify(mode)};throw new Error('PRN_AUDIT_INJECTED_DECK_EXCEPTION');`;
  return {
    html: html.replace(anchor, `${anchor}\n${marker}`),
    evidence: { mode, anchor, original_sha256: sha256(html), modified_sha256: sha256(html.replace(anchor, `${anchor}\n${marker}`)),
      scope: 'One intercepted document response; no server or source file modification.' },
  };
}

async function inspect(page) {
  return page.evaluate(ids => {
    const visible = e => !!e && e.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    const form = document.querySelector('#home-problem-intake');
    const controls = [...(form?.querySelectorAll('textarea,input:not([type="hidden"]),button') ?? [])].map(e => {
      const box = e.getBoundingClientRect();
      const labels = [...(e.labels ?? [])].map(l => l.textContent.replace(/\s+/g, ' ').trim());
      // File inputs are intentionally visually hidden inside their visible, clickable native labels.
      const hit = e.type === 'file' ? e.labels?.[0] : e;
      const r = hit?.getBoundingClientRect();
      return { name: e.name || e.id, type: e.type, required: e.required, disabled: e.disabled,
        accessible_name: e.getAttribute('aria-label') || labels.join(' ') || (e.tagName === 'BUTTON' ? e.textContent.trim() : ''),
        labels, describedby_resolves: (e.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean).every(id => !!document.getElementById(id)),
        target_visible: visible(hit), target_width: Math.round(r?.width ?? 0), target_height: Math.round(r?.height ?? 0),
        raw_input_width: Math.round(box.width), raw_input_height: Math.round(box.height) };
    });
    return {
      html_classes: document.documentElement.className, width: innerWidth, height: innerHeight,
      document_width: document.documentElement.scrollWidth,
      horizontal_overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      deck: document.documentElement.classList.contains('deck'),
      engine_off: document.documentElement.classList.contains('eng-off'), injected_marker: window.__prnAuditInjected ?? null,
      fine_pointer: matchMedia('(pointer:fine)').matches, hover: matchMedia('(hover:hover)').matches,
      reduced_motion: matchMedia('(prefers-reduced-motion:reduce)').matches,
      sections: ids.map(id => ({ id, present: !!document.getElementById(id) })),
      form: { present: !!form, action: form?.getAttribute('action'), method: form?.getAttribute('method'), controls },
      faq_count: document.querySelectorAll('#faq details').length,
      source_count: Array.from({ length: 11 }, (_, i) => !!document.getElementById(`src-${i + 1}`)).filter(Boolean).length,
      running_animations: document.getAnimations().filter(a => a.playState === 'running').map(a => ({
        name: a.animationName || a.transitionProperty || '', target: a.effect?.target?.id || a.effect?.target?.className || '',
        infinite: a.effect?.getTiming().iterations === Infinity,
      })),
    };
  }, SECTION_IDS);
}

async function reachSection(page, id) {
  const mode = await page.evaluate(target => {
    const el = document.getElementById(target);
    return { deck: document.documentElement.classList.contains('deck'), chapter: el?.closest('.chapter')?.id,
      current: document.querySelector('.chapter.is-current')?.id };
  }, id);
  let keyboardSteps = 0;
  if (mode.deck) {
    // Native PageDown runs the existing engine's actual keyboard handler, without its test API.
    await page.evaluate(() => document.activeElement?.blur());
    while (keyboardSteps < 17) {
      const state = await page.evaluate(chapter => {
        const chapters = [...document.querySelectorAll('.chapter')];
        return { current: document.querySelector('.chapter.is-current')?.id,
          direction: chapters.findIndex(e => e.id === chapter) > chapters.findIndex(e => e.classList.contains('is-current')) ? 'PageDown' : 'PageUp' };
      }, mode.chapter);
      if (state.current === mode.chapter) break;
      await page.keyboard.press(state.direction);
      await delay(710);
      keyboardSteps++;
    }
  }
  await page.evaluate(target => document.getElementById(target)?.scrollIntoView({ behavior: 'instant', block: 'start' }), id);
  await delay(420);
  // A reveal may be staggered. Wait for its real visible state before recording a failure.
  await page.waitForFunction(target => {
    const e = document.getElementById(target);
    const title = e?.querySelector('h1,h2,h3,p') ?? e;
    if (!title) return false;
    for (let n = title; n instanceof Element; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) return false;
    }
    return true;
  }, { timeout: 2500, polling: 100 }, id).catch(() => {});
  return page.evaluate(({ target, keyboardSteps, deck }) => {
    const e = document.getElementById(target);
    const r = e?.getBoundingClientRect();
    const title = e?.querySelector('h1,h2,h3,p') ?? e;
    const reasons = [];
    for (let n = title; n instanceof Element; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.display === 'none' || s.visibility === 'hidden' || Number(s.opacity) === 0) reasons.push({ node: n.id || n.className || n.tagName, display: s.display, visibility: s.visibility, opacity: s.opacity });
    }
    return { id: target, present: !!e, navigation: deck ? 'native PageDown/PageUp then scroll within current card' : 'native document scroll',
      keyboard_steps: keyboardSteps, current_card: document.querySelector('.chapter.is-current')?.id,
      hidden_title_reasons: reasons, visible_box: !!r && r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0,
      horizontal_overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      section_horizontal_overflow: e ? Math.max(0, e.scrollWidth - e.clientWidth) : null };
  }, { target: id, keyboardSteps, deck: mode.deck });
}

async function callouts(page) {
  const read = () => page.evaluate(() => Object.fromEntries(['free-note', 'con-pop'].map(id => {
    const e = document.getElementById(id), s = e && getComputedStyle(e);
    return [id, { visible: !!e?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }), opacity: s?.opacity, position: s?.position }];
  })));
  await page.focus('input[name="video"]');
  await page.keyboard.press('Tab');
  await delay(380);
  const keyboard = { active: await page.evaluate(() => document.activeElement?.id), callouts: await read() };
  await page.evaluate(() => document.activeElement?.blur());
  const canHover = await page.evaluate(() => matchMedia('(hover:hover) and (pointer:fine)').matches);
  let hover = null;
  if (canHover) {
    // Leave and re-enter the console so the two-second native hover timer is armed.
    await page.mouse.move(1, 1);
    await page.hover('#intake .con-head');
    await delay(2380);
    hover = await read();
    await page.mouse.move(1, 1);
  }
  return { keyboard, hover, touch_static: canHover ? null : await read() };
}

async function disclosures(page) {
  const result = { faq: [] };
  for (let i = 0; i < FAQ_COUNT; i++) {
    const selector = `#faq details:nth-of-type(${i + 1}) summary`;
    const element = await page.$(selector);
    if (!element) { result.faq.push({ index: i + 1, missing: true }); continue; }
    await element.focus();
    await page.keyboard.press('Enter');
    await delay(320);
    result.faq.push(await element.evaluate(e => ({ open: e.parentElement.open,
      answer_visible: !!e.parentElement.querySelector('.faq-a')?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) })));
    await element.dispose();
  }
  result.source_navigation = await reachSection(page, 'sources-and-review');
  await page.focus('#sources-and-review summary');
  await page.keyboard.press('Enter');
  await delay(160);
  result.sources = await page.evaluate(() => ({
    open: document.querySelector('#sources-and-review details')?.open,
    visible_count: Array.from({ length: 11 }, (_, i) => document.getElementById(`src-${i + 1}`))
      .filter(e => e?.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })).length,
  }));
  return result;
}

export async function auditBrowser({ origin: givenOrigin, out, executablePath = CHROME, scenarioNames }) {
  const origin = validateOrigin(givenOrigin);
  if (!out) throw new Error('explicit_output_path_required');
  const scenarios = scenarioNames ? MATRIX.filter(s => scenarioNames.includes(s.name)) : MATRIX;
  if (!scenarios.length || scenarioNames?.some(name => !MATRIX.some(s => s.name === name))) throw new Error('unknown_scenario');
  if (scenarios.some(s => s.fault) && !['localhost', '127.0.0.1', '[::1]'].includes(new URL(origin).hostname)) throw new Error('fault_cases_require_a_local_test_origin');
  const target = origin + PAGE_PATH;
  const report = { checked_at_utc: new Date().toISOString(), origin, path: PAGE_PATH,
    harness_sha256: sha256(await readFile(fileURLToPath(import.meta.url))),
    scope: 'Read-only Chromium viewport and fallback evidence. No intake submissions, customer writes, model calls, performance certification, cross-browser certification, or release approval.',
    limitations: ['Viewport and touch emulation is not physical device testing.', 'Form checks cover labels, focus, visible targets, and disclosure semantics, not the ten-step hosted journey.', 'Controlled exceptions exercise two caught initialization guards, not every possible asynchronous failure.', 'The JavaScript hover popup is recorded but not required in no-JavaScript desktop cases; the native input form and disclosures are required.'],
    scenarios: [], checks: [] };
  const add = (scenario, id, pass, details = {}) => report.checks.push({ scenario, id, pass: Boolean(pass), ...details });
  let browser;
  try {
    browser = await puppeteer.launch({ executablePath, headless: true,
      args: ['--disable-background-networking', '--disable-sync', '--no-first-run'] });
    report.browser_version = await browser.version();
    report.started_browser_pid = browser.process()?.pid;
    for (const scenario of scenarios) {
      const page = await browser.newPage();
      const record = { ...scenario, page_errors: [], failed_requests: [], blocked_requests: [], requests: 0 };
      try {
        await page.setViewport({ width: scenario.width, height: scenario.height, deviceScaleFactor: 1, isMobile: false, hasTouch: scenario.touch });
        await page.setJavaScriptEnabled(scenario.js);
        await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: scenario.reduced ? 'reduce' : 'no-preference' }]);
        await page.setRequestInterception(true);
        page.on('request', async request => {
          try {
            const url = new URL(request.url());
            record.requests++;
            const embeddedImage = url.protocol === 'data:' && request.resourceType() === 'image';
            if (!['GET', 'HEAD'].includes(request.method()) || (!embeddedImage && ![origin, 'https://fonts.googleapis.com', 'https://fonts.gstatic.com'].includes(url.origin))) {
              record.blocked_requests.push({ method: request.method(), origin: url.origin, path: url.pathname });
              await request.abort(); return;
            }
            if (scenario.fault && request.isNavigationRequest() && request.frame() === page.mainFrame()) {
              if (url.href !== target) throw new Error('fault_navigation_must_remain_exact_target');
              const response = await fetch(target, { redirect: 'error', signal: AbortSignal.timeout(30000) });
              const source = await response.text();
              if (source.length > 2_000_000 || response.status !== 200) throw new Error('fault_original_response_invalid');
              const injected = injectDeckFailure(source, scenario.fault);
              record.injection = injected.evidence;
              const headers = Object.fromEntries(response.headers);
              for (const name of ['content-length', 'content-encoding', 'transfer-encoding']) delete headers[name];
              await request.respond({ status: response.status, headers, body: injected.html });
              return;
            }
            await request.continue();
          } catch (error) {
            record.interception_error = error instanceof Error ? error.message : 'interception_failed';
            if (!request.isInterceptResolutionHandled()) await request.abort();
          }
        });
        page.on('pageerror', error => record.page_errors.push(error.message.slice(0, 240)));
        page.on('requestfailed', request => record.failed_requests.push({ path: new URL(request.url()).pathname, reason: request.failure()?.errorText }));
        const response = await page.goto(target, { waitUntil: 'networkidle2', timeout: 45000 });
        record.status = response?.status();
        record.noindex = response?.headers()['x-robots-tag'] ?? null;
        record.document_sha256 = sha256(await response.text());
        await page.evaluate(() => document.fonts.ready);
        await delay(500);
        record.initial = await inspect(page);
        add(scenario.name, 'response.200', record.status === 200);
        add(scenario.name, 'preview.noindex', /noindex/i.test(record.noindex ?? ''));
        add(scenario.name, 'sections.all_15_present', record.initial.sections.every(s => s.present));
        add(scenario.name, 'form.named_enabled_targets', record.initial.form.controls.length >= 5 && record.initial.form.controls.every(c => c.accessible_name && c.describedby_resolves && !c.disabled && c.target_visible && c.target_width > 0 && c.target_height > 0));
        add(scenario.name, 'form.native_post_action_preserved', record.initial.form.action === '/api/intake/start' && record.initial.form.method === 'post');
        if (scenario.reduced || !scenario.js) add(scenario.name, 'fallback.deck_disabled', !record.initial.deck);
        if (scenario.reduced) add(scenario.name, 'motion.no_running_infinite_animation', record.initial.running_animations.every(a => !a.infinite));
        if (scenario.fault) add(scenario.name, 'injected_exception.recovered', record.initial.injected_marker === scenario.fault && record.initial.engine_off && !record.initial.deck && !!record.injection);
        record.callouts = await callouts(page);
        add(scenario.name, 'tooltip.keyboard_free_note', record.callouts.keyboard.active === 'startBtn' && record.callouts.keyboard.callouts['free-note'].visible);
        // The optional JS hover enhancement is absent without JS; record its state explicitly.
        if (record.initial.hover && scenario.js) add(scenario.name, 'tooltip.native_hover_popup', record.callouts.hover?.['con-pop'].visible);
        if (!record.initial.hover) add(scenario.name, 'tooltip.touch_static_copy', record.callouts.touch_static?.['con-pop'].visible);
        record.sections = [];
        for (const id of SECTION_IDS) record.sections.push(await reachSection(page, id));
        add(scenario.name, 'sections.all_15_reachable', record.sections.every(s => s.present && s.visible_box && s.hidden_title_reasons.length === 0), { failing: record.sections.filter(s => !s.visible_box || s.hidden_title_reasons.length) });
        add(scenario.name, 'layout.no_document_overflow', record.initial.horizontal_overflow <= 1 && record.sections.every(s => s.horizontal_overflow <= 1));
        // Return through native deck cycling or normal scrolling for actual keyboard disclosure checks.
        record.faq_navigation = await reachSection(page, 'faq');
        record.disclosures = await disclosures(page);
        add(scenario.name, 'faq.all_five_keyboard_open', record.initial.faq_count === FAQ_COUNT && record.disclosures.faq.length === FAQ_COUNT && record.disclosures.faq.every(f => f.open && f.answer_visible));
        add(scenario.name, 'sources.native_keyboard_all_11', record.disclosures.sources.open && record.disclosures.sources.visible_count === 11);
        add(scenario.name, 'runtime.no_uncaught_errors', record.page_errors.length === 0);
        add(scenario.name, 'network.no_mutations_attempted', record.blocked_requests.every(r => ['GET', 'HEAD'].includes(r.method)));
        add(scenario.name, 'network.no_unexpected_failure', !record.interception_error && record.failed_requests.length === 0 && record.blocked_requests.length === 0);
      } catch (error) {
        record.error = error instanceof Error ? error.message.slice(0, 350) : 'scenario_failed';
        add(scenario.name, 'scenario.completed', false, { error: record.error });
      } finally {
        await page.close();
        report.scenarios.push(record);
        await mkdir(dirname(resolve(out)), { recursive: true });
        await writeFile(resolve(out), JSON.stringify(report, null, 2) + '\n');
        process.stdout.write(`${scenario.name}: ${report.checks.filter(c => c.scenario === scenario.name && c.pass).length}/${report.checks.filter(c => c.scenario === scenario.name).length} checks\n`);
      }
    }
  } finally {
    if (browser) await browser.close();
    report.started_browser_closed = !browser || browser.process()?.exitCode !== null;
    report.summary = { scenarios: report.scenarios.length, checks: report.checks.length, passed: report.checks.filter(c => c.pass).length, failed: report.checks.filter(c => !c.pass).length };
    await mkdir(dirname(resolve(out)), { recursive: true });
    await writeFile(resolve(out), JSON.stringify(report, null, 2) + '\n');
  }
  return report;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    process.stdout.write('Usage: node tools/audit-door-browser.mjs --origin https://explicit-origin --out receipt.json [--chrome executable] [--scenarios comma,separated,names]\nDefault: all 21 scenarios, including two intercepted-response exceptions that require a loopback origin. For a deployed origin, select the 19 non-injected scenarios explicitly. Only GET/HEAD requests to the selected origin and public Google font assets are allowed. No intake is submitted.\nScenarios: ' + MATRIX.map(s => s.name).join(',') + '\n');
    return;
  }
  const allowed = new Set(['--origin', '--out', '--chrome', '--scenarios']);
  const config = {};
  for (let i = 0; i < args.length; i += 2) {
    if (!allowed.has(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Usage: --origin explicit-origin --out receipt.json [--chrome executable] [--scenarios comma,separated,names]');
    config[args[i]] = args[i + 1];
  }
  const report = await auditBrowser({ origin: config['--origin'], out: config['--out'], executablePath: config['--chrome'], scenarioNames: config['--scenarios']?.split(',') });
  process.stdout.write(JSON.stringify(report.summary) + '\n');
  if (report.summary.failed) process.exitCode = 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 2; });
}
