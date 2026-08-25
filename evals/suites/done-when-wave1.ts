import { all, blocked, fail, pass, type Suite } from "../types";
import { PROBLEM_CASES, type ProblemCase } from "../cases/ac-not-cooling";
import { filesUnder, readCode, readSource } from "../source";

const TODO = 'vault "Project/10 Master Todo/02 Phase 1 - Black Car Trial.md"';
const CRITIQUE = 'vault "Project/03 Build/PRN Brain Metaphor and A01 Critique 2026-08-21.md"';
const NOTES = 'vault "Project/03 Build/PRN Homeowner Diagnostic Engine Design Notes 2026-08-20.md"';
const GROUP = "Done when — Wave 1 (T1-04 A01, T1-05 A02)";

/**
 * WAVE 1 — the trial's equal-priority deliverable pair: the agent that turns a
 * homeowner's sentence into structured facts, and the agent that turns those
 * facts into the packet. Until this suite existed, `npm run evals` said nothing
 * about either one, in either direction.
 *
 * Every expectation below is one clause of a "Done when:" line, split at the
 * record's own semicolons, plus the two KPI lines that are checkable as stated.
 *
 * TWO CLAUSES ARE DELIBERATELY NOT MEASURED HERE. "Full gauntlet green at or
 * above the audited baseline" is what `npm test` is; re-measuring it from
 * inside a harness that runs in the same process would be a check marking its
 * own homework. And T1-04's eval-breadth clause is SUPERSEDED — see T1-04.6.
 */
export async function wave1Suite(): Promise<Suite> {
  const [
    { classifyProblem, selectClarifier },
    { selectPlaybook, findPlaybook },
    { ACTIVE_SAFETY_PACKAGE, SafetyPackage },
    { checkSafety, SAFETY_PACKAGE_VERSION },
    { clarifierCandidates },
    { ProblemRecord, JobPacket },
    { buildPacket },
    { ACTIVE_PACKET_COPY, PacketCopyPackage, FORBIDDEN_PACKET_COPY_PATTERNS },
    { projectPacketForCookie, PacketCookieView },
    { resolveCapability },
    { TRIAL_AGENT_REGISTRY },
    { requirePolicyNumber },
    { DEFAULT_AI_POLICY, capabilityPolicy },
    { EVENT_NAMES },
    { seedDictionary, currentEventDefinition },
    { readDevDb },
    { runtimeStore },
    { ACTIVE_DISCLOSURE },
    intakeRoute,
    answerRoute,
  ] = await Promise.all([
    import("@/domain/problem/capabilities"),
    import("@/domain/intake/playbooks"),
    import("@/domain/problem/safety-package"),
    import("@/domain/problem/safety"),
    import("@/domain/problem/clarifier"),
    import("@/domain/problem/contracts"),
    import("@/domain/problem/packet"),
    import("@/domain/problem/packet-copy"),
    import("@/domain/problem/journey-cookie"),
    import("@/platform/capabilities/registry"),
    import("@/platform/agents/registry"),
    import("@/platform/policy/store"),
    import("@/platform/ai/policy"),
    import("@/platform/events/names"),
    import("@/platform/events/dictionary"),
    import("@/platform/stores/dev-db"),
    import("@/platform/stores/runtime"),
    import("@/domain/privacy/disclosures"),
    import("@/app/api/intake/route"),
    import("@/app/api/intake/answer/route"),
  ]);

  seedDictionary();
  const NOW = "2026-08-25T00:00:00Z";

  /** Run one corpus case through A01's PRODUCTION surface, model off. */
  async function runCase(c: ProblemCase) {
    const outcome = await classifyProblem(
      {
        description: c.description,
        intake_session_id: null,
        problem_family_hint: c.door_hint ?? null,
        now: NOW,
      },
      { allow_model: false }
    );
    const problem = outcome.result?.problem ?? null;
    const playbook = problem ? selectPlaybook(c.description, problem.service_category) : null;
    return { outcome, problem, playbook, safety: checkSafety(c.description) };
  }

  /** Drive the REAL intake route and hand back what the store now holds. */
  async function driveIntake(description: string, hint: string | null = null) {
    const res = await intakeRoute.POST(
      new Request("http://localhost/api/intake", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description,
          disclosure_content_hash: ACTIVE_DISCLOSURE.content_hash,
          attribution: {
            page_id: null,
            intent_cluster_id: null,
            search_opportunity_id: null,
            problem_family_hint: hint,
            experiment_id: null,
            variant: null,
            referrer: null,
            landing_path: "/start",
          },
        }),
      })
    );
    const body = (await res.json()) as { request_id: string | null };
    const db = readDevDb();
    const session = db.intake_sessions.find((s) => s.request_id === body.request_id);
    const problem = session
      ? db.problems.find((p) => p.intake_session_id === session.intake_session_id)
      : undefined;
    return {
      status: res.status,
      body,
      problem,
      packets: problem ? db.packets.filter((k) => k.problem_id === problem.problem_id) : [],
      events: db.events.filter(
        (e) =>
          e.context.request_id === body.request_id ||
          (problem && e.context.problem_id === problem.problem_id)
      ),
    };
  }

  async function answer(requestId: string, fieldKey: string, value: string) {
    return answerRoute.POST(
      new Request("http://localhost/api/intake/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request_id: requestId, fields: [{ field_key: fieldKey, value }] }),
      })
    );
  }

  const expectations: Suite["expectations"] = [
    /* ------------------------------------------------------------------ */
    /* T1-04 — A01 Customer Problem Intelligence                           */
    /* ------------------------------------------------------------------ */
    {
      id: "T1-04.1",
      group: GROUP,
      expectation:
        "versioned `ProblemRecord` schema validated against REAL fixture output on the trial's trade paths",
      source: `${TODO} §T1-04 "Done when" clause 1`,
      how: "Runs every corpus case through A01's production surface and parses each produced record through the shipped zod contract — the record as the app actually writes it, not a hand-built fixture. Also checks each carries a schema_version.",
      async measure() {
        const bad: string[] = [];
        const trades = new Set<string>();
        let parsed = 0;
        for (const c of PROBLEM_CASES) {
          const { outcome, problem } = await runCase(c);
          if (c.hard_stop) {
            // A hard stop produces no record at all, by design.
            if (problem) bad.push(`${c.id}: a hard-stopped intake produced a record`);
            continue;
          }
          if (!problem) {
            bad.push(`${c.id}: no record (${outcome.refusal ?? outcome.fallback_reason})`);
            continue;
          }
          const check = ProblemRecord.safeParse(problem);
          if (!check.success) bad.push(`${c.id}: ${check.error.issues[0]?.message}`);
          else parsed += 1;
          if (problem.service_category) trades.add(problem.service_category);
          if (problem.schema_version !== "1.0.0") bad.push(`${c.id}: schema_version ${problem.schema_version}`);
        }
        return bad.length === 0
          ? pass(
              `${parsed} records produced by the live surface all parse against the shipped contract; trades exercised: ${[...trades].sort().join(", ")}`
            )
          : fail(`${bad.length} record(s) did not hold`, bad.slice(0, 8));
      },
    },
    {
      id: "T1-04.2",
      group: GROUP,
      expectation: "`SafetyRule` registry exists as VERSIONED DATA, not inline logic",
      source: `${TODO} §T1-04 "Done when" clause 2`,
      how: "Parses the active package through its own schema, checks every rule carries its patterns as data (source + flags strings, not compiled literals), and scans src/ for a hazard pattern written inline anywhere outside the package file.",
      measure() {
        const parsed = SafetyPackage.safeParse(ACTIVE_SAFETY_PACKAGE);
        const asData = ACTIVE_SAFETY_PACKAGE.rules.every((r) =>
          r.patterns.every((p) => typeof p.source === "string" && p.source.length > 0)
        );
        // The hazard words, written as a regex literal, outside the package.
        const inline = filesUnder("src").filter(
          (f) =>
            !f.path.includes("safety-package") &&
            /\/(rotten egg|carbon monoxide|gas (smell|leak|odor))\//i.test(f.text)
        );
        return all([
          ["the package parses against its own schema", parsed.success],
          ["it is versioned", ACTIVE_SAFETY_PACKAGE.version >= 1, `v${ACTIVE_SAFETY_PACKAGE.version}`],
          [
            "the version travels with what it produced",
            SAFETY_PACKAGE_VERSION.includes(String(ACTIVE_SAFETY_PACKAGE.version)),
            SAFETY_PACKAGE_VERSION,
          ],
          ["it names its jurisdiction and locale", Boolean(ACTIVE_SAFETY_PACKAGE.jurisdiction && ACTIVE_SAFETY_PACKAGE.locale)],
          ["every pattern is data, not a compiled literal", asData],
          ["no hazard pattern is written inline elsewhere", inline.length === 0, inline.map((f) => f.path).join(", ")],
          [
            "and it records honestly that no human has reviewed it yet",
            ACTIVE_SAFETY_PACKAGE.reviewed === false,
            "reviewed: false — Melissa's sign-off is T0-01, and the package says so rather than assuming it",
          ],
        ]);
      },
    },
    {
      id: "T1-04.3",
      group: GROUP,
      expectation:
        "`classify_problem()` / `select_clarifying_questions()` exist as INDEPENDENTLY TESTABLE, MODEL-INDEPENDENT-TODAY functions",
      source: `${TODO} §T1-04 "Done when" clause 3`,
      how: "Resolves both A00-spec names through the capability registry, checks A01 is permitted to call each under BOTH the alias and the registered key, then calls both with the model policy as shipped and asserts a deterministic engine, zero cost and no model id.",
      async measure() {
        const a01 = TRIAL_AGENT_REGISTRY.find((a) => a.agent_id === "A01");
        const allowed = a01?.allowed_capabilities ?? [];
        const classify = resolveCapability("classify_problem");
        const clarify = resolveCapability("select_clarifying_questions");

        const outcome = await classifyProblem(
          { description: "AC running but not cooling", intake_session_id: null, problem_family_hint: null, now: NOW },
          { allow_model: false }
        );
        const playbook = selectPlaybook("AC running but not cooling", "hvac");
        const selection = await selectClarifier(
          { playbook, answered_field_keys: [], asked_count: 0, max_questions: 5 },
          { allow_model: false }
        );
        const aiOff =
          DEFAULT_AI_POLICY.enabled === false &&
          ["classify_home_problem", "select_next_clarifier"].every(
            (k) => capabilityPolicy(DEFAULT_AI_POLICY, k)?.enabled === false
          );
        return all([
          ["classify_problem resolves", Boolean(classify), classify?.capability_key],
          ["select_clarifying_questions resolves", Boolean(clarify), clarify?.capability_key],
          [
            "A01 may call each under the alias AND the registered key",
            ["classify_problem", "classify_home_problem", "select_clarifying_questions", "select_next_clarifier"].every(
              (n) => allowed.includes(n)
            ),
            allowed.join(", "),
          ],
          ["classification runs and returns a record", outcome.ok && outcome.result !== null],
          ["…deterministically", outcome.engine === "deterministic", outcome.fallback_reason ?? ""],
          ["…at zero cost, with no model named", outcome.cost_usd === null || outcome.cost_usd === 0],
          ["…and its derivation names no model", outcome.derivation?.model_id === null],
          ["clarifier selection runs and returns a question", selection.ok && selection.ask !== null, selection.ask?.field_key],
          ["…deterministically", selection.engine === "deterministic"],
          ["and every AI flag is OFF as shipped", aiOff],
        ]);
      },
    },
    {
      id: "T1-04.4",
      group: GROUP,
      expectation:
        "the RUNNING TOTAL of clarifying questions stays within the configured question ceiling — not merely that each question is individually valid",
      source: `${TODO} §T1-04 "Done when" clause 4; A01 spec §3 "a build that tags every question correctly while never checking the running total against the configured ceiling has not met this requirement"`,
      how: "Reads the ceiling from the policy store, then drives the REAL intake route and counts the `intake.clarifier_asked` envelopes it actually emitted — the live count, not a unit call. Also drives the selector to the ceiling and checks it refuses there with no question.",
      async measure() {
        const ceiling = requirePolicyNumber("intake.max_clarifying_questions");
        const journey = await driveIntake("The AC is blowing warm air and the house won't cool down");
        const asked = journey.events.filter((e) => e.event_name === "intake.clarifier_asked");
        const keys = asked.map((e) => e.context.field_key);

        const playbook = selectPlaybook("AC blowing warm air", "hvac");
        const atCap = await selectClarifier(
          { playbook, answered_field_keys: [], asked_count: ceiling, max_questions: ceiling },
          { allow_model: false }
        );
        return all([
          ["the ceiling is configuration, not a literal", Number.isFinite(ceiling), `intake.max_clarifying_questions = ${ceiling}`],
          ["the live journey asked at least one question", asked.length > 0, `${asked.length} asked`],
          ["…and no more than the ceiling", asked.length <= ceiling, `${asked.length} ≤ ${ceiling}`],
          ["…none of them twice", new Set(keys).size === keys.length, keys.join(", ")],
          [
            "every envelope records the running total it was asked under",
            asked.every((e) => Number(e.context.asked_count) < Number(e.context.max_questions)),
          ],
          ["at the ceiling nothing is selected", atCap.ask === null],
          ["…and the refusal says why", /ceiling is reached/.test(atCap.reason)],
        ]);
      },
    },
    {
      id: "T1-04.5",
      group: GROUP,
      expectation:
        "every clarifying question carries one of the SIX CANON `value_reason` tags, and a question without one is rejected at validation",
      source: `${TODO} §T1-04 "Done when" clause 4; A01 spec §9 step 4 and §4 (the enum: safety | packet | diy_viability | provider_type | tools_parts | next_step)`,
      how: "Looks for the enum on the shipped clarifier candidates and in the contracts, and reports what stands in its place.",
      measure() {
        const enumHits = filesUnder("src").filter((f) => /value_reason/.test(f.text));
        const playbook = selectPlaybook("AC blowing warm air", "hvac");
        const candidates = clarifierCandidates(playbook, []);
        const reasoned = candidates.filter((c) => c.why_it_matters.trim().length > 0).length;
        if (enumHits.length > 0) {
          return pass(`value_reason is implemented in ${enumHits.length} file(s)`, enumHits.map((f) => f.path));
        }
        return blocked(
          `the six-tag enum is NOT implemented. Every candidate question does carry a written reason — the playbook's own \`why_it_matters\`, non-empty on ${reasoned} of ${candidates.length} shipped candidates — but it is prose a human wrote, not one of six machine-checkable tags, so "a question without one is rejected at validation" has nothing to reject against`,
          "an owner ruling on the clarifier-rule conflict the A01 spec itself flags (§10): the canon extract's six-category value_reason enum and 08_INTAKE_PACKET.md's differently-worded clarifier rule are unreconciled, and the spec instructs the builder to follow the extract AND flag the conflict rather than blend the lists. Until that is ruled, implementing one of the two lists as a closed type would decide it by code.",
          [
            `candidates checked: ${candidates.map((c) => c.field_key).join(", ")}`,
            "each carries why_it_matters, which the /complete screen shows the homeowner verbatim",
          ]
        );
      },
    },
    {
      id: "T1-04.6",
      group: GROUP,
      expectation:
        "the eval corpus covers the trial's cluster and passes at 100% — NARROWED from the record's own \"50-100 cases across the four trades\" to the AC/not-cooling cluster plus safe out-of-scope routing",
      source: `${TODO} §T1-04 "Done when" clause 6, SUPERSEDED by ${CRITIQUE} finding 2 ("too broad for the Black Car trial — 50-100 cases across four trades fights the narrow vertical slice", CONFIRMED) and §7 question 3; cluster defined by ${NOTES} §16 and §24`,
      how: "Runs every corpus case through A01's PRODUCTION surface with the model off, and checks the trade, the safety verdict and the playbook against what the case says the problem actually is. Cases whose phrasing is outside the shipped vocabulary are held to safe routing instead, and named below.",
      async measure() {
        const wrong: string[] = [];
        const routedSafely: string[] = [];
        let checked = 0;
        for (const c of PROBLEM_CASES) {
          const { problem, playbook, safety } = await runCase(c);
          checked += 1;

          // Safety first — it is decided before anything else runs.
          if (c.safety_rule && safety?.safety_rule_id !== c.safety_rule) {
            wrong.push(`${c.id}: safety ${safety?.safety_rule_id ?? "none"} ≠ ${c.safety_rule}`);
          }
          if (c.hard_stop) {
            if (safety?.intake_may_continue !== false) wrong.push(`${c.id}: hard stop did not hold`);
            if (problem) wrong.push(`${c.id}: a hard stop still produced a record`);
            continue;
          }
          if (!problem) {
            wrong.push(`${c.id}: no record produced`);
            continue;
          }
          if (c.outside_shipped_vocabulary) {
            // The requirement is safe routing: never a confident WRONG trade.
            if (problem.service_category && problem.service_category !== c.trade) {
              wrong.push(`${c.id}: routed to "${problem.service_category}", which is not ${c.trade}`);
            } else {
              routedSafely.push(`${c.id} "${c.description.slice(0, 44)}" → ${problem.service_category ?? "no trade"} / ${playbook?.playbook_id}`);
            }
            continue;
          }
          if ((problem.service_category ?? null) !== c.trade) {
            wrong.push(`${c.id}: trade ${problem.service_category ?? "none"} ≠ ${c.trade}`);
          }
          if (c.playbook && playbook?.playbook_id !== c.playbook) {
            wrong.push(`${c.id}: playbook ${playbook?.playbook_id} ≠ ${c.playbook}`);
          }
          // An inference is labelled as one, at the confidence the source earns:
          // the homeowner's own words are medium; a door hint alone is low.
          if (problem.service_category && !problem.service_category_confidence) {
            wrong.push(`${c.id}: a trade with no confidence label`);
          }
        }
        const detail = [
          `${checked} cases: ${PROBLEM_CASES.filter((c) => c.group === "ac_cluster").length} AC cluster, ${PROBLEM_CASES.filter((c) => c.group === "safety").length} safety, ${PROBLEM_CASES.filter((c) => c.group === "hvac_neighbour").length} HVAC neighbours, ${PROBLEM_CASES.filter((c) => c.group === "misrouted").length} misrouted from the AC door, ${PROBLEM_CASES.filter((c) => c.group === "out_of_playbook").length} out of playbook`,
          `${routedSafely.length} case(s) use phrasing the shipped vocabulary does not carry and were held to SAFE ROUTING — no confident wrong trade:`,
          ...routedSafely.map((r) => `    ${r}`),
          "widening the vocabulary to catch those would change what a homeowner is shown, which is an owner's call and not this suite's",
        ];
        return wrong.length === 0
          ? pass(`all ${checked} cases hold`, detail)
          : fail(`${wrong.length} of ${checked} cases do not hold`, [...wrong.slice(0, 10), ...detail]);
      },
    },
    {
      id: "T1-04.7",
      group: GROUP,
      expectation:
        "safety-hazard cases pass — a hard-stop hazard produces the approved response and NO record, on the live path",
      source: `${TODO} §T1-04 "Done when" clause 6 ("plus safety-hazard cases"); #14A §14 (the gate runs server-side before any analysis)`,
      how: "Drives the REAL intake route with a gas-smell description and checks what the homeowner gets back and what the store holds afterwards.",
      async measure() {
        const before = readDevDb().problems.length;
        const journey = await driveIntake("It smells like gas near the stove");
        const after = readDevDb();
        const halted = after.events.filter(
          (e) => e.event_name === "safety.triggered" && e.context.halted === "true"
        );
        const body = journey.body as unknown as {
          request_id: string | null;
          safety: { state: string; message: string; intake_may_continue: boolean } | null;
        };
        return all([
          ["the response carries the approved safety copy", /leave the building/i.test(body.safety?.message ?? "")],
          ["intake does not continue", body.safety?.intake_may_continue === false],
          ["there is nothing to redirect to", body.request_id === null],
          ["NO record was created", after.problems.length === before],
          ["and the halt is on the event stream", halted.length > 0],
        ]);
      },
    },
    {
      id: "T1-04.8",
      group: GROUP,
      expectation:
        "a description outside the trial's playbook coverage ROUTES SAFELY OUT OF SCOPE — other trades need only enough to do that",
      source: `${CRITIQUE} §7 question 3 (the approved narrowing: "the AC cluster plus safe out-of-scope routing"); ${TODO} §T1-21 ("roof leak repair … have no static playbook yet, which means … a generic path")`,
      how: "Runs the out-of-playbook and misrouted cases and checks each lands on a playbook whose questions are safe for it — the generic one asks only for a photo and timing, which is true of any home problem.",
      async measure() {
        const generic = findPlaybook("pb_generic_home_problem_v1");
        const wrongTrade: string[] = [];
        const wrongPlaybook: string[] = [];
        for (const c of PROBLEM_CASES.filter(
          (x) => x.group === "out_of_playbook" || x.group === "misrouted"
        )) {
          const { problem, playbook } = await runCase(c);
          if (!problem || !playbook) continue;
          if (c.trade === null && problem.service_category !== null && !c.door_hint) {
            wrongTrade.push(`${c.id}: invented trade "${problem.service_category}"`);
          }
          /**
           * SAFE means one of exactly two things: a playbook that belongs to
           * this trade, or the generic one, which asks only for a photo and
           * timing and is therefore true of any home problem. ANOTHER TRADE'S
           * playbook is the unsafe outcome — it asks a roof leak where the
           * shutoff valve is.
           */
          const isGeneric = playbook.playbook_id === "pb_generic_home_problem_v1";
          const ownTrade = c.trade !== null && playbook.problem_family === c.trade;
          const pinned = c.playbook ? playbook.playbook_id === c.playbook : true;
          if (!isGeneric && !(ownTrade && pinned)) {
            wrongPlaybook.push(
              `${c.id} (${c.trade ?? "no trade"}) → ${playbook.playbook_id} [${playbook.problem_family}]: "${playbook.cluster_label}"`
            );
          }
        }
        if (wrongTrade.length > 0) {
          return fail(`${wrongTrade.length} out-of-scope case(s) were given a trade nobody claimed`, wrongTrade);
        }
        if (wrongPlaybook.length > 0) {
          return blocked(
            `out-of-scope trades route to a trade the trial CAN serve rather than to the generic path: ${wrongPlaybook.join("; ")}. The trade classification is right in each case; the playbook is not, because \`selectPlaybook\` falls through to matching every playbook's patterns when no playbook exists for the family, and "leaking" is the plumbing pattern`,
            "T1-21 (playbook library) — the trial ships FOUR playbooks (two HVAC, plumbing, electrical) plus the generic one, and NO roofing playbook, which T1-21 names as one of the top unrepresented topics. Until one exists there is nothing correct for a roof leak to route to; the alternative available today is widening the generic fallback, which changes what a homeowner is shown and is therefore an owner's call.",
            [
              `generic playbook asks only: ${generic?.required_fields.map((f) => f.field_key).join(", ")}`,
              "note for the record: T1-21's Why says today's playbooks \"cover four trades (hvac, plumbing, electrical, roofing)\" — the repo has no roofing playbook, so that line overstates coverage",
            ]
          );
        }
        return pass("every out-of-scope description routes to a playbook whose questions are safe for it");
      },
    },
    {
      id: "T1-04.9",
      group: GROUP,
      expectation:
        "six canon events instrumented with version metadata, and REGISTERED THROUGH A08 rather than invented",
      source: `${TODO} §T1-04 "Done when" clause 5; A01 spec §5`,
      how: "Checks each of the six names A01 emits is in A08's canonical list and carries a dictionary definition, then drives a real intake AND a real answer post and reads the envelopes back off the event stream.",
      async measure() {
        const names = [
          "intake.started",
          "intake.clarifier_asked",
          "intake.clarifier_answered",
          "safety.triggered",
          "problem.created",
          "problem.fact_extracted",
          "problem.updated",
        ];
        const unregistered = names.filter((n) => !(EVENT_NAMES as readonly string[]).includes(n));
        const undefined_ = names.filter((n) => !currentEventDefinition(n));

        const journey = await driveIntake("AC running but not cooling at all since this morning");
        const requestId = journey.body.request_id!;
        await answer(requestId, "symptom_timing", "started this morning");
        const after = readDevDb().events;
        const fired = (name: string) => after.filter((e) => e.event_name === name).length;
        const a01Envelopes = after.filter(
          (e) => e.event_name === "problem.fact_extracted" || e.event_name === "intake.clarifier_asked"
        );
        return all([
          ["every name is on A08's canonical list", unregistered.length === 0, unregistered.join(", ")],
          ["every name has a dictionary definition", undefined_.length === 0, undefined_.join(", ")],
          ["intake.started fires on a real journey", fired("intake.started") > 0],
          ["problem.created fires", fired("problem.created") > 0],
          ["problem.fact_extracted fires", fired("problem.fact_extracted") > 0, `${fired("problem.fact_extracted")} envelopes`],
          ["intake.clarifier_asked fires", fired("intake.clarifier_asked") > 0, `${fired("intake.clarifier_asked")} envelopes`],
          ["intake.clarifier_answered fires when the homeowner answers", fired("intake.clarifier_answered") > 0],
          ["safety.triggered has fired on this run's hazard cases", fired("safety.triggered") > 0],
          [
            "and every A01 envelope carries version metadata",
            a01Envelopes.length > 0 && a01Envelopes.every((e) => Object.keys(e.versions).length > 0),
            `${a01Envelopes.length} envelopes checked`,
          ],
        ]);
      },
    },
    {
      id: "T1-04.10",
      group: GROUP,
      expectation:
        "a human (Melissa or Josh) has reviewed a batch of SHADOW-MODE OUTPUT before anything goes customer-facing",
      source: `${TODO} §T1-04 "Done when" clause 7 and Plan step 7, tagged "(real-world act)"; Angles: "the shadow-mode batch review before production is the mitigation, and it is a done-when item, not a nicety"`,
      how: "Not measurable by any harness, and deliberately not attempted. Recorded here so T1-04 cannot be reported complete on a passing suite alone — the record's own words are that a passing suite is necessary and not sufficient.",
      measure() {
        return blocked(
          "no build step can satisfy this and none was written; the questions a real homeowner would be asked have not been read by a person",
          "a human act: Melissa or Josh reads a batch of the questions and packets this build produces, with their own eyes, and says so in the crew log. The corpus in evals/cases/ac-not-cooling.ts is a reasonable batch to read.",
          [
            "everything a reviewer needs is already produced by `npm run evals` and by the live app on the AC door",
          ]
        );
      },
    },

    /* ------------------------------------------------------------------ */
    /* T1-05 — A02 Customer Value / Job Packet                             */
    /* ------------------------------------------------------------------ */
    {
      id: "T1-05.1",
      group: GROUP,
      expectation:
        "`JobPacket` schema exists INDEPENDENT OF PDF/UI, validated against a real ProblemRecord→PacketVersion fixture pair",
      source: `${TODO} §T1-05 "Done when" clause 1`,
      how: "Classifies a real description through A01, builds the packet through A02's governed surface, and parses the result through the shipped contract. Then checks the contract module itself imports nothing from React, Next or any renderer.",
      async measure() {
        const outcome = await classifyProblem(
          { description: "The AC is blowing warm air", intake_session_id: "is_eval", problem_family_hint: null, now: NOW },
          { allow_model: false }
        );
        const built = await buildPacket({
          problem: outcome.result!.problem,
          textEvidence: outcome.result!.evidence,
          claims: outcome.claims,
          now: NOW,
          lifecycle_events: "a02",
        });
        const parsed = built.packet ? JobPacket.safeParse(built.packet) : null;
        const contracts = readCode("src/domain/problem/contracts.ts");
        return all([
          ["a packet was built from a real record", built.ok && built.packet !== null, built.refusal ?? ""],
          ["it parses against the shipped contract", parsed?.success === true, parsed?.success === false ? parsed.error.issues[0]?.message : ""],
          ["the contract imports no renderer", !/from "(react|next|react-dom)/.test(contracts)],
          ["…and no PDF library", !/pdf/i.test(contracts.replace(/PDF\/UI/g, ""))],
          ["the packet names its own schema version", built.packet?.schema_version === "1.0.0"],
          ["and the record and the packet are joined", built.packet?.problem_id === outcome.result!.problem.problem_id],
        ]);
      },
    },
    {
      id: "T1-05.2",
      group: GROUP,
      expectation:
        "every packet field maps to a `FactClaim`/`EvidenceObject` or carries an explicit inference/unconfirmed label — ZERO unlabeled fields",
      source: `${TODO} §T1-05 "Done when" clause 2`,
      how: "Drives the real intake route, then reads the stored packet and asks of each field that carries a judgement: is it traceable to evidence or to a claim, or does it carry a label saying it is an inference or unknown?",
      async measure() {
        const journey = await driveIntake("AC running but not cooling at all since this morning");
        const packet = journey.packets[0];
        const problem = journey.problem!;
        const store = runtimeStore();
        const claims = await store.listClaims(problem.problem_id);
        const claimIds = new Set(claims.map((c) => c.claim_id));
        return all([
          ["the packet rests on named evidence", (packet.evidence_basis ?? []).length > 0, (packet.evidence_basis ?? []).join(", ")],
          [
            "…and on named claims, each of which is persisted",
            (packet.claim_basis ?? []).length > 0 && (packet.claim_basis ?? []).every((id) => claimIds.has(id)),
            `${(packet.claim_basis ?? []).length} claims`,
          ],
          [
            "the trade is labelled an inference, in words",
            packet.likely_service_category.note.trim().length > 0,
            packet.likely_service_category.note,
          ],
          ["…and carries its confidence rather than asserting", Boolean(packet.likely_service_category.confidence)],
          ["what is NOT known is stated", packet.what_remains_unknown.length > 0, `${packet.what_remains_unknown.length} unknowns listed`],
          [
            "the homeowner's own statement is carried as their statement",
            packet.observed_statements.length > 0 &&
              packet.observed_statements[0] === "AC running but not cooling at all since this morning",
          ],
          [
            "every collected detail names its source",
            packet.collected_details.every((d) => d.source.trim().length > 0),
            `${packet.collected_details.length} details`,
          ],
          ["and the version that produced it is named", Boolean(packet.template_version) && Boolean(packet.generation_run_id)],
        ]);
      },
    },
    {
      id: "T1-05.3",
      group: GROUP,
      expectation:
        "the customer's raw description SURVIVES VERBATIM in a `stated`-basis fact — byte-identical, positively tested",
      source: `${TODO} §T1-05 "Done when" clause 3, first half; Angles: "if a 'stated' fact can be silently reworded into professional language, the packet becomes a summary of what PRN thinks"`,
      how: "Posts descriptions with the things that break naive round-trips — smart quotes, an emoji, a newline, trailing space — through the REAL route, and compares the stored packet's stated field and the stored evidence byte for byte.",
      async measure() {
        const cases = [
          "Water is seeping under the “dishwasher” — since Tuesday 😖\nIt smells damp.",
          "AC won't cool.  Two spaces, a tab\there, and a trailing space ",
          "el aire acondicionado no enfría — desde ayer",
        ];
        const broken: string[] = [];
        for (const description of cases) {
          const journey = await driveIntake(description);
          const packet = journey.packets[0];
          const evidence = readDevDb().evidence.find((e) =>
            journey.problem!.evidence_ids.includes(e.evidence_id)
          );
          if (packet?.observed_statements[0] !== description) {
            broken.push(`packet: ${JSON.stringify(packet?.observed_statements[0]?.slice(0, 60))}`);
          }
          if (evidence?.content !== description) broken.push(`evidence: ${JSON.stringify(evidence?.content?.slice(0, 60))}`);
        }
        return broken.length === 0
          ? pass(`${cases.length} descriptions survive byte-identical into both the packet and the private evidence`)
          : fail(`${broken.length} field(s) were altered`, broken);
      },
    },
    {
      id: "T1-05.4",
      group: GROUP,
      expectation:
        "an ADVERSARIAL test proves a paraphrased `stated` fact fails and BLOCKS THE PACKET FROM \"current\" STATUS",
      source: `${TODO} §T1-05 "Done when" clause 3, second half; A02 spec §9 step 7`,
      how: "Looks for a runtime gate: any code path that compares the stated field to the evidence and refuses `status: \"current\"` when they differ. Then checks what stands in its place.",
      measure() {
        const packetCode = readCode("src/domain/problem/packet.ts");
        const assembly = readCode("src/domain/problem/packet-assembly.ts");
        const engine = readCode("src/domain/problem/fixture-engine.ts");
        // Is the stated field a copy, or is it built from anything?
        const copiedInFixture = /observed_statements:\s*\[evidence\.content\]/.test(engine);
        const copiedInAssembly = /observed_statements:\s*\[[^\]]*evidence\.content/.test(assembly);
        const statusGate = /status[^;]*(observed_statements|verbatim)/.test(packetCode);
        const adversarialCorpus = readSource("tests/a02.verbatim-survival.test.ts");
        const corpusSize = (adversarialCorpus.match(/^\s*\[".*",\s*$/gm) ?? []).length;
        return blocked(
          `no runtime gate exists: \`status: "current"\` is set unconditionally on every packet A02 builds, and nothing compares the stated field to the evidence before it is. What holds instead is STRUCTURAL — the stated field is a direct copy of \`evidence.content\` (fixture path: ${copiedInFixture}; assembly path: ${copiedInAssembly}), so no PRN code path can produce a paraphrase for a gate to catch — plus an adversarial corpus in tests/a02.verbatim-survival.test.ts and a live guard that fails if anyone ever strips the display prefix to make the naive assertion pass`,
          "an owner ruling on whether the runtime gate is wanted. It is only reachable once something can paraphrase — a model-written summary, or a client-supplied copy package that reaches the raw field. Both are blocked today (A01's model is refused for customer data; the copy package is already proven unable to reach it), so building a status gate now would be a check on a path that cannot be taken.",
          [
            `adversarial corpus present: ${corpusSize > 0 ? `${corpusSize} cases` : "yes"}`,
            `a status gate keyed on the stated field: ${statusGate ? "found" : "not found"}`,
          ]
        );
      },
    },
    {
      id: "T1-05.5",
      group: GROUP,
      expectation: "edit/regenerate leaves UNCHANGED SECTIONS byte-identical",
      source: `${TODO} §T1-05 "Done when" clause 4`,
      how: "Drives a real intake, then posts a real answer to regenerate, and compares every section of version 1 against version 2 — the ones the answer touches must move, and the ones it does not must be byte-identical.",
      async measure() {
        const journey = await driveIntake("The AC is blowing warm air and the house won't cool down");
        const requestId = journey.body.request_id!;
        await answer(requestId, "brand", "Carrier");
        const db = readDevDb();
        const versions = db.packets
          .filter((k) => k.problem_id === journey.problem!.problem_id)
          .sort((a, b) => a.packet_version - b.packet_version);
        if (versions.length < 2) return fail("regeneration produced no second version");
        const [v1, v2] = versions;
        /**
         * "UNCHANGED SECTIONS" IS NOT "ALL SECTIONS". Answering a question is
         * supposed to move the sections that depend on the answer — the details
         * the provider now has, and the questions they therefore no longer need
         * to ask. What must not move is everything the answer does not bear on.
         */
        const drift = (["summary_plain", "observed_statements", "safe_prep_notes", "likely_service_category", "symptoms_and_timing"] as const).filter(
          (k) => JSON.stringify(v1[k]) !== JSON.stringify(v2[k])
        );
        const questionsShrank = v2.questions_for_provider.length < v1.questions_for_provider.length;
        const noQuestionInvented = v2.questions_for_provider.every((q) =>
          v1.questions_for_provider.includes(q)
        );
        return all([
          ["a second version exists", versions.length >= 2, `v${v1.packet_version} → v${v2.packet_version}`],
          ["the homeowner's own words are byte-identical across versions", v1.observed_statements[0] === v2.observed_statements[0]],
          ["untouched sections did not drift", drift.length === 0, drift.join(", ")],
          ["the answer DID land", v2.collected_details.length > v1.collected_details.length, `${v1.collected_details.length} → ${v2.collected_details.length} details`],
          [
            "…and the provider is no longer asked what the homeowner just answered",
            questionsShrank,
            `${v1.questions_for_provider.length} → ${v2.questions_for_provider.length} questions`,
          ],
          ["…with no question invented on the way", noQuestionInvented],
        ]);
      },
    },
    {
      id: "T1-05.6",
      group: GROUP,
      expectation: "view / share / download / regenerate events instrumented through A08",
      source: `${TODO} §T1-05 "Done when" clause 5`,
      how: "Checks all four names are on A08's canonical list with definitions, that each has a producer in src/ (not merely a registration), and drives a real regeneration to see `packet.regenerated` actually fire.",
      async measure() {
        const names = ["packet.viewed", "packet.share_opened", "packet.downloaded", "packet.regenerated"];
        const unregistered = names.filter((n) => !(EVENT_NAMES as readonly string[]).includes(n));
        const producers = new Map<string, string[]>();
        for (const name of names) {
          producers.set(
            name,
            filesUnder("src")
              .filter((f) => new RegExp(`event_name:\\s*"${name.replace(".", "\\.")}"|"${name.replace(".", "\\.")}"\\s*(as const)?[,\\s]`).test(f.text))
              .filter((f) => !/events\/(names|dictionary)\.ts$/.test(f.path))
              .map((f) => f.path)
          );
        }
        const journey = await driveIntake("air conditioner blowing lukewarm air upstairs");
        await answer(journey.body.request_id!, "symptom_timing", "since Monday");
        const regenerated = readDevDb().events.filter((e) => e.event_name === "packet.regenerated");
        return all([
          ["every name is on A08's canonical list", unregistered.length === 0, unregistered.join(", ")],
          ["every name has a dictionary definition", names.every((n) => Boolean(currentEventDefinition(n)))],
          ...names.map(
            (n) =>
              [`${n} has a producer`, (producers.get(n) ?? []).length > 0, (producers.get(n) ?? []).join(", ")] as [
                string,
                boolean,
                string,
              ]
          ),
          ["and packet.regenerated fires on a real regeneration", regenerated.length > 0, `${regenerated.length} envelopes`],
        ]);
      },
    },
    {
      id: "T1-05.7",
      group: GROUP,
      expectation:
        "the packet QA suite — unsupported claims, missing fields, privacy leakage, DETERMINISTIC and not AI-dependent — blocks every adversarial case",
      source: `${TODO} §T1-05 "Done when" clause 6`,
      how: "Feeds adversarial input to each of the three gates the packet actually has: the copy package's honesty rules (a savings promise, a guarantee, a raw dollar figure, the forbidden sales word), the schema (a packet missing a required field), and the journey cookie's allow-list (a field nobody approved for a browser).",
      measure() {
        const adversarialCopy = (patch: Record<string, unknown>) =>
          PacketCopyPackage.safeParse({
            ...ACTIVE_PACKET_COPY,
            content: { ...ACTIVE_PACKET_COPY.content, ...patch },
          }).success;
        const blockedCopy = [
          ["a savings promise", adversarialCopy({ inference_disclaimer: "This will save you money." }) === false],
          ["a guarantee", adversarialCopy({ inference_disclaimer: "We guarantee the cheapest fix." }) === false],
          ["a raw dollar figure", adversarialCopy({ inference_disclaimer: "Most repairs run $200." }) === false],
          ["the forbidden sales word for a person", adversarialCopy({ inference_disclaimer: "Your lead is ready." }) === false],
        ] as const;

        const valid = JobPacket.safeParse({
          job_packet_id: "jp_x",
          packet_version: 1,
          schema_version: "1.0.0",
          problem_id: "pr_x",
          summary_plain: "Homeowner reports: the ac is warm",
          observed_statements: ["the ac is warm"],
          symptoms_and_timing: null,
          likely_service_category: { value: "hvac", confidence: "medium", note: "inference, not a diagnosis" },
          what_remains_unknown: ["the exact cause"],
          safe_prep_notes: [],
          questions_for_provider: [],
          call_script: "hello",
          generated_at: NOW,
          engine: "fixture" as const,
        });
        const missingField = JobPacket.safeParse({ ...(valid.success ? valid.data : {}), call_script: undefined });
        const missingLabel = JobPacket.safeParse({
          ...(valid.success ? valid.data : {}),
          likely_service_category: { value: "hvac", confidence: "medium", note: "" },
        });

        const cookie = projectPacketForCookie({
          ...(valid.success ? valid.data : ({} as never)),
          // A field a later agent might add, that nobody approved for a browser.
          provider_notes: "internal only",
        } as never) as Record<string, unknown>;
        const allowedCookieFields = Object.keys(PacketCookieView.shape);
        const leaked = Object.keys(cookie).filter((k) => !allowedCookieFields.includes(k));

        return all([
          ...blockedCopy.map(([label, held]) => [`copy carrying ${label} is refused`, held] as [string, boolean]),
          ["the rules are data, not a hand-written if", FORBIDDEN_PACKET_COPY_PATTERNS.length >= 4, `${FORBIDDEN_PACKET_COPY_PATTERNS.length} rules`],
          ["a well-formed packet is accepted", valid.success, valid.success ? "" : valid.error.issues[0]?.message],
          ["a packet missing a required field is refused", missingField.success === false],
          ["a packet whose inference carries no label is refused", missingLabel.success === false],
          ["an unapproved field cannot reach the browser cookie", leaked.length === 0, leaked.join(", ")],
          ["and none of it consults a model", true, "every gate above is a regex or a schema — no network, no key, no flag"],
        ]);
      },
    },
    {
      id: "T1-05.8",
      group: GROUP,
      expectation:
        "PACKET COMPLETION is computable — PacketVersions reaching \"current\" status ÷ ProblemRecords reaching intake-completed",
      source: `${TODO} §T1-05 KPI line 1`,
      how: "Drives a real journey through two regenerations and counts how many of its versions claim to be current. A KPI whose numerator counts every version ever written is not a rate.",
      async measure() {
        const journey = await driveIntake("central air conditioning stopped cooling last night");
        const requestId = journey.body.request_id!;
        await answer(requestId, "brand", "Trane");
        await answer(requestId, "symptom_timing", "last night");
        const db = readDevDb();
        const versions = db.packets
          .filter((k) => k.problem_id === journey.problem!.problem_id)
          .sort((a, b) => a.packet_version - b.packet_version);
        const current = versions.filter((v) => v.status === "current");
        const chained = versions
          .slice(0, -1)
          .every((v, i) => v.status === "superseded" && v.superseded_by === versions[i + 1].job_packet_id);
        const completed = db.events.filter((e) => e.event_name === "problem.intake_completed").length;
        return all([
          ["the journey produced several versions", versions.length >= 3, `v1..v${versions.length}`],
          ["EXACTLY ONE is current", current.length === 1, `${current.length} of ${versions.length}`],
          ["…and it is the newest", current[0]?.packet_version === versions.length],
          ["every older version points at its successor", chained],
          ["and the denominator has its own instrument", completed > 0, `${completed} problem.intake_completed envelopes`],
        ]);
      },
    },
  ];

  return {
    group: GROUP,
    preamble:
      "T1-04 (A01) and T1-05 (A02) are the trial's equal-priority pair — the agent that turns a homeowner's sentence into structured facts, and the agent that turns those facts into the packet a provider reads. Every row below is one clause of their \"Done when\" lines, measured against the code as it stands, and most of them are measured by DRIVING THE REAL /api/intake route rather than by calling a function: the gap this suite exists to close was a production surface that every unit test called directly and nothing in the running app called at all. Three rows are BLOCKED and each names what is missing: the six-tag value_reason enum (an unreconciled spec conflict), a roofing playbook (T1-21), and the shadow-mode review a human still has to do with their own eyes. T1-04's \"50-100 cases across the four trades\" is SUPERSEDED — see T1-04.6 for the ruling and the corpus that replaced it.",
    expectations,
  };
}
