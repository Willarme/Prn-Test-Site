#!/usr/bin/env node
/** Explicit reviewed-source export. Never runs at request time or follows the vault automatically.
 * Sync: node tools/sync-door-template.mjs --source <kit> --reference <independent-v43.html>
 *       --date-evidence <reviewed-ac-door-assets.json>
 * Check a clean checkout: node tools/sync-door-template.mjs --check
 * Hashes normalize CRLF to LF, matching the independent fidelity contract.
 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import console from 'node:console';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const kit = path.join(root, 'content/door-template/v43');
const expectedReference = '756fb95907fd3fb21f7bc9a86e854d0e90f8ef35455776b83a17b4935f8d8843';
const args = process.argv.slice(2);
const arg = (key) => { const i = args.indexOf(key); return i < 0 ? null : args[i + 1]; };
const read = (p) => fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');
const sha = (value) => crypto.createHash('sha256').update(value).digest('hex');
const json = (p) => JSON.parse(read(p));
const write = (p, value) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, value); };
const writeJson = (p, value) => write(p, JSON.stringify(value, null, 2) + '\n');
const files = (dir, prefix = '') => fs.readdirSync(dir).sort().flatMap((name) => {
  const rel = prefix ? prefix + '/' + name : name;
  return fs.statSync(path.join(dir, name)).isDirectory() ? files(path.join(dir, name), rel) : [rel];
});
const text = (html) => html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
  .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([a-f\d]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&(amp|lt|gt|quot|apos|nbsp|rsquo|lsquo|ldquo|rdquo|ndash|mdash|middot|copy|rarr|deg);/g,
    (_, key) => ({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' ',rsquo:'’',lsquo:'‘',ldquo:'“',rdquo:'”',ndash:'–',mdash:'—',middot:'·',copy:'©',rarr:'→',deg:'°'})[key])
  .replace(/\s+/g, ' ').trim();

function derive(manifest) {
  const { build, render, SECTIONS } = require(path.join(kit, 'build.js'));
  const { compareV43 } = require(path.join(kit, 'tools/fidelity-v43.js'));
  const built = build(path.join(kit, 'spec/ac-blowing-warm-air'), path.join(kit, 'TEMPLATE_SECTION_ORDER.json'), { dateModified: manifest.content_date });
  const fidelity = compareV43(read(path.join(kit, 'reference/approved-v43.html')), built.html, manifest.content_date);
  if (!fidelity.pass) throw new Error('Frozen v43 fidelity failed at line ' + fidelity.line);
  const spec = built.spec;
  const partial = (file) => render(read(path.join(kit, 'template', file)), {}, spec);
  const sections = built.order.map((section_id) => {
    // INTAKE is physically inside HERO, as required by the frozen order.
    const html = section_id === 'INTAKE'
      ? (partial(SECTIONS.HERO.file).match(/<form\b[\s\S]*?<\/form>/i)?.[0] ?? '')
      : partial(SECTIONS[section_id].file);
    if (!html) throw new Error('Empty section: ' + section_id);
    return { section_id, heading: text(html.match(/<h[12]\b[^>]*>([\s\S]*?)<\/h[12]>/i)?.[1] ?? section_id.replaceAll('_', ' ')), text: text(html) };
  });
  const registry = json(path.join(kit, 'spec/ac-blowing-warm-air/capability-registry.json'));
  const source_bindings = spec.sources.list.map((source, i) => ({
    source_id: 'src-' + (i + 1), publisher: text(source.publisher), title: text(source.title), url: source.url,
    inherited_note: text(source.note), evidence_status: 'INHERITED_UNVERIFIED', verified_at: null,
    source_path: 'spec/ac-blowing-warm-air/sources.json', source_sha256: sha(read(path.join(kit, 'spec/ac-blowing-warm-air/sources.json'))),
  }));
  const citedSources = (html) => [...new Set([...html.matchAll(/<a\b[^>]*href=["']#(src-\d+)["'][^>]*>([\s\S]*?)<\/a>/g)].flatMap((m) => {
    const range = text(m[2]).match(/^(\d+)\s*[–-]\s*(\d+)$/);
    return range ? Array.from({ length: Number(range[2]) - Number(range[1]) + 1 }, (_, i) => 'src-' + (Number(range[1]) + i)) : [m[1]];
  }))];
  const metric_cards = spec.stats.cards.map((card, i) => ({
    metric_id: 'stat-' + (i + 1), value: text(card.value_html.replace(/<sup\b[\s\S]*?<\/sup>/g, '')),
    statement: text(card.statement), qualifier: text(card.note), source_class: text(card.source_class), source_ids: citedSources(card.value_html),
  }));
  const capability_questions = registry.capabilities.map((cap, i) => {
    const visible = spec.capability.rows[i];
    if (cap.visible_row_question !== visible.ask || cap.visible_row_answer !== visible.tells || cap.status !== visible.chip_label) {
      throw new Error('Capability registry differs from visible row ' + i);
    }
    if (cap.live_status !== 'CLAIMED_ON_PAGE_PENDING_RUNTIME_VERIFICATION') throw new Error('Export cannot manufacture runtime proof');
    return { capability_id: cap.capability_id, question: cap.visible_row_question, answer: cap.visible_row_answer,
      claimed_status: cap.status, required_inputs: cap.required_inputs, optional_inputs: cap.optional_inputs,
      possible_outputs: cap.possible_outputs, safety_class: cap.safety_class, runtime_status: cap.live_status };
  });
  const assetMap = json(path.join(kit, 'reference/content-date-evidence.json')).assets;
  const visual_assets = spec.visuals.plates.map((plate, i) => {
    const svg = read(path.join(kit, 'spec/ac-blowing-warm-air', plate.file));
    return { asset_id: 'plate-' + (i + 1), source_path: 'spec/ac-blowing-warm-air/' + plate.file,
      source_sha256: sha(svg), public_svg_path: assetMap[i].svg, raster_path: plate.png.path,
      width: plate.png.width, height: plate.png.height, title: text(svg.match(/<title[^>]*>([\s\S]*?)<\/title>/)?.[1] ?? ''),
      description: text(svg.match(/<desc[^>]*>([\s\S]*?)<\/desc>/)?.[1] ?? ''), caption: text(plate.caption_html),
      raster_evidence_status: 'REQUIRES_DEPLOYED_ASSET_CHECK', og_image: i === 1 };
  });
  const claim_bindings = [
    ...metric_cards.map((card) => ({ claim_id: card.metric_id, claim_type: 'quantitative', section_id: 'STAT_CARDS', text: `${card.value} ${card.statement} ${card.qualifier}`, source_ids: card.source_ids, capability_ids: [], evidence_status: 'PENDING_SOURCE_VERIFICATION' })),
    ...spec.common_causes.rows.map((row, i) => ({ claim_id: 'cause-' + (i + 1), claim_type: 'cost_and_guidance', section_id: 'COMMON_POSSIBILITIES',
      text: text(row.cause + '. ' + row.notice + ' ' + row.fix_label + '. ' + row.range_html),
      source_ids: citedSources(row.range_html), capability_ids: [], evidence_status: 'PENDING_SOURCE_VERIFICATION' })),
    ...capability_questions.map((cap) => ({ claim_id: cap.capability_id, claim_type: 'capability', section_id: 'CAPABILITY_QUESTIONS', text: cap.question + ' ' + cap.answer + ' ' + cap.claimed_status,
      source_ids: [], capability_ids: [cap.capability_id], evidence_status: 'PENDING_RUNTIME_VERIFICATION' })),
  ];
  const supporting_text = text(partial('chrome-top.html') + partial('colophon.html'));
  const content_blocks = [...sections, { section_id: 'SOURCES_AND_NOTICE', heading: 'Sources and review notes; informational and safety notice', text: supporting_text }].map((section) => ({
    block_id: 'v43_' + section.section_id.toLowerCase(), kind: section.section_id === 'HERO' ? 'intent_answer' : section.section_id === 'SAFE_OBSERVATIONS' ? 'safe_checks' : 'custom',
    heading: section.heading, body_md: section.text, source_fact_bundle_ids: ['fb_door_v43_ac_warm_air'],
  }));
  const internal_links = [...built.html.matchAll(/<a\b([^>]*\bhref=["'](\/[^\s"']*)["'][^>]*)>([\s\S]*?)<\/a>/gi)]
    .filter((m) => !m[2].startsWith('//')).map((m) => ({ label: text(m[3]) || m[1].match(/aria-label=["']([^"']+)/)?.[1] || m[2], path: m[2] }));
  const binding = {
    template_id: 'door-v43', template_version: '43.0.0', spec_id: 'ac-blowing-warm-air', spec_version: '43.0.0',
    reference_sha256: expectedReference, source_tree_sha256: manifest.source_tree_sha256,
    rendered_sha256: sha(built.html), content_date: manifest.content_date,
    canonical_path: '/problems/ac-blowing-warm-air', title: spec.page.title, meta_description: spec.page.meta_description,
    h1: text(spec.hero.h1_html), section_order: built.order, sections,
    document_text: text(built.html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1] ?? built.html),
    supporting_text,
    page_fields: { canonical_path: '/problems/ac-blowing-warm-air', title: spec.page.title, meta_description: spec.page.meta_description,
      h1: text(spec.hero.h1_html), hero: { headline: text(spec.hero.h1_html), subheadline: text(spec.hero.answer_body_html) },
      content_blocks, internal_links, template_id: 'door-v43', template_version: '43.0.0',
      structured_data_plan: null, safety_note_required: true, problem_family: 'hvac',
      source_fact_bundle_ids: ['fb_door_v43_ac_warm_air'], geography: { mode: 'national', country: 'US' },
      generation: { model: 'frozen-template-v43', prompt_id: null, prompt_version: null } },
    direct_answer: { text: text(spec.hero.answer_body_html), source_ids: citedSources(spec.hero.answer_body_html), evidence_status: 'PENDING_SOURCE_VERIFICATION' },
    tool_value: { heading: text(spec.hero.vp_head_strong), claim: text(spec.hero.vp_claim_pos),
      rows: spec.hero.value_rows.map((row) => ({ generic: text(row.generic), ours: text(row.ours_html) })),
      footnote: text(spec.hero.vp_foot_html), runtime_status: 'CLAIMED_ON_PAGE_PENDING_RUNTIME_VERIFICATION' },
    capability_questions, metric_cards, visual_assets,
    methodology: { path: '/local-records/methodology', record_status: 'BUILDING_REPAIR_RECORD',
      text: sections.find((section) => section.section_id === 'REPAIR_RECORD').text,
      sample_size: null, evidence_status: 'NO_MEASURED_RECORD_EVIDENCE' },
    source_bindings, claim_bindings,
  };
  return { binding: { ...binding, binding_sha256: sha(JSON.stringify(binding)) }, html: built.html };
}

if (args.includes('--check')) {
  const manifest = json(path.join(kit, 'manifest.json'));
  for (const file of manifest.files) {
    if (sha(read(path.join(kit, file.path))) !== file.sha256) throw new Error('Vendored source changed: ' + file.path);
  }
  if (sha(JSON.stringify(manifest.files)) !== manifest.source_tree_sha256) throw new Error('Source tree receipt mismatch');
  const evidence = json(path.join(kit, 'reference/content-date-evidence.json'));
  if (manifest.content_date_basis.modified_at !== evidence.source_modified_at ||
      manifest.content_date_basis.commit !== evidence.source_commit ||
      manifest.content_date !== evidence.source_modified_at.slice(0, 10)) throw new Error('Content date receipt mismatch');
  const derived = derive(manifest);
  if (read(path.join(kit, 'binding.json')) !== JSON.stringify(derived.binding, null, 2) + '\n') throw new Error('Binding differs from reviewed sources');
  if (read(path.join(kit, 'rendered.html')) !== derived.html) throw new Error('Rendered artifact differs from reviewed sources');
  if (manifest.rendered_sha256 !== sha(derived.html) || manifest.binding_sha256 !== derived.binding.binding_sha256) throw new Error('Artifact receipt mismatch');
  console.log(JSON.stringify({ status: 'PASS', files: manifest.files.length, source_tree_sha256: manifest.source_tree_sha256, rendered_sha256: manifest.rendered_sha256, content_date: manifest.content_date }));
} else {
  const source = arg('--source'), reference = arg('--reference'), dateEvidence = arg('--date-evidence');
  if (!source || !reference || !dateEvidence) throw new Error('Explicit --source, --reference and --date-evidence required; or use --check');
  if (sha(read(reference)) !== expectedReference) throw new Error('Independent approved reference hash mismatch');
  const evidence = json(dateEvidence);
  if (!/^[a-f0-9]{40}$/.test(evidence.source_commit) || !/^\d{4}-\d{2}-\d{2}T/.test(evidence.source_modified_at)) throw new Error('Reviewed content Git commit and timestamp required');
  const include = ['build.js','TEMPLATE_SECTION_ORDER.json','tools/fidelity-v43.js','tools/fidelity-v43.test.js', ...files(path.join(source,'template')).map((p) => 'template/' + p), ...files(path.join(source,'spec/ac-blowing-warm-air')).map((p) => 'spec/ac-blowing-warm-air/' + p)];
  for (const file of include) write(path.join(kit, file), read(path.join(source, file)));
  write(path.join(kit, 'reference/approved-v43.html'), read(reference));
  write(path.join(kit, 'reference/content-date-evidence.json'), read(dateEvidence));
  const inventory = [...include, 'reference/approved-v43.html', 'reference/content-date-evidence.json'].sort().map((file) => ({ path: file, sha256: sha(read(path.join(kit, file))) }));
  const manifest = { version: 1, template_id: 'door-v43', source_origin: 'prn-vault/Project/03 Build/SEO Intent Pages/door-template',
    reference_sha256: expectedReference, content_date: evidence.source_modified_at.slice(0,10),
    content_date_basis: { commit: evidence.source_commit, modified_at: evidence.source_modified_at, explanation: evidence.source_date_basis },
    source_tree_sha256: sha(JSON.stringify(inventory)), files: inventory };
  const derived = derive(manifest);
  writeJson(path.join(kit, 'binding.json'), derived.binding);
  write(path.join(kit, 'rendered.html'), derived.html);
  writeJson(path.join(kit, 'manifest.json'), { ...manifest, rendered_sha256: sha(derived.html), binding_sha256: derived.binding.binding_sha256 });
  console.log(JSON.stringify({ status: 'EXPORTED', files: inventory.length, source_tree_sha256: manifest.source_tree_sha256, content_date: manifest.content_date }));
}
