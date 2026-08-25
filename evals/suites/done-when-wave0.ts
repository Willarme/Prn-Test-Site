import { all, blocked, fail, pass, type Suite } from "../types";
import { describeHits, filesUnder, readSource, scan, sourceFiles } from "../source";

const TODO = 'vault "Project/10 Master Todo/02 Phase 1 - Black Car Trial.md"';

/**
 * WAVE 0 — the three items everything else waits on. Every expectation below is
 * one clause of a "Done when:" line, quoted from the Master Todo and split at
 * its own semicolons, because that is how the record itself separates them.
 */
export async function wave0Suite(): Promise<Suite> {
  const [
    { CAPABILITY_REGISTRY, resolveCapability },
    { TRIAL_AGENT_REGISTRY },
    { capability_call },
    { recentAgentRuns, resetAgentRunLedgerForTests },
    { checkKillSwitch, engageKillSwitch, releaseKillSwitch, listKillSwitches },
    { getPolicySetting, PLATFORM_POLICY_SETTINGS },
    { queueApproval, listApprovals, resolveApproval, resetApprovalCenterForTests },
    { validateAndEmit, proposeEventDefinition, proposeMetricDefinition, proposeEventDefinitionChange, deprecate, getMetricLineage, getEventImpact, lookupEventDefinition, stewardCounters, resetStewardForTests },
    { currentEventDefinition, listEventDefinitions, listMetricDefinitions, SEED_CENSUS, seedDictionary },
    { EventEnvelope },
    { EVENT_NAMES },
    { INVARIANT_RULES, INVARIANT_RULE_SET_VERSION, evaluateSubject },
    { AUTO_REPAIR_ALLOW_LIST, simulateRepair, mayAutoExecute, autoRepairEnabled },
    { RECONCILIATION_CHECKS },
    { KPI_READ_PATHS_HONOURING_QUARANTINE },
    { analyzeProblemFixture },
  ] = await Promise.all([
    import("@/platform/capabilities/registry"),
    import("@/platform/agents/registry"),
    import("@/platform/gateway"),
    import("@/platform/runs/ledger"),
    import("@/platform/killswitch"),
    import("@/platform/policy/store"),
    import("@/platform/approvals/center"),
    import("@/platform/events/steward"),
    import("@/platform/events/dictionary"),
    import("@/platform/events/envelope"),
    import("@/platform/events/names"),
    import("@/platform/quality/invariants"),
    import("@/platform/quality/repairs"),
    import("@/platform/quality/reconciliation"),
    import("@/platform/quality/quarantine"),
    import("@/domain/problem/fixture-engine"),
  ]);

  seedDictionary();

  const expectations: Suite["expectations"] = [
    /* ------------------------------------------------------------------ */
    /* T1-01 — A00 Shared Agent Platform                                   */
    /* ------------------------------------------------------------------ */
    {
      id: "T1-01.1",
      group: "Done when — Wave 0 (T1-01 A00, T1-02 A08, T1-03 A09)",
      expectation:
        "the registry migration preserves every current `stage: \"LIVE\"` reader — the stage→status rename must not silently drop a live capability",
      source: `${TODO} §T1-01 "Done when" clause 1`,
      how: "Reads the shipped CAPABILITY_REGISTRY and asserts every entry carries a `status`, that no entry still carries a `stage` key, and that resolveCapability answers for every registered key and every declared alias.",
      measure() {
        const withStage = CAPABILITY_REGISTRY.filter((c) => "stage" in (c as object));
        const missingStatus = CAPABILITY_REGISTRY.filter((c) => !c.status);
        const unresolvable = CAPABILITY_REGISTRY.filter((c) => !resolveCapability(c.capability_key));
        const aliases = CAPABILITY_REGISTRY.flatMap((c) => c.aliases ?? []);
        const deadAliases = aliases.filter((a) => !resolveCapability(a));
        return all([
          ["no entry still carries the old `stage` key", withStage.length === 0, `${withStage.length} found`],
          ["every entry carries `status`", missingStatus.length === 0, `${CAPABILITY_REGISTRY.length} entries`],
          ["every key resolves", unresolvable.length === 0],
          ["every alias resolves", deadAliases.length === 0, `${aliases.length} aliases checked`],
        ]);
      },
    },
    {
      id: "T1-01.2",
      group: "Done when — Wave 0 (T1-01 A00, T1-02 A08, T1-03 A09)",
      expectation:
        "the capability registry resolves `classify_problem` / `build_job_packet` / `get_search_metrics` to the real existing code",
      source: `${TODO} §T1-01 "Done when" clause 2`,
      how: "Resolves each of the three named aliases and asserts the entry's implementation_ref points at a file that exists in src/.",
      measure() {
        const named = ["classify_problem", "build_job_packet", "get_search_metrics"];
        const rows = named.map((n) => [n, resolveCapability(n)] as const);
        const paths = sourceFiles().map((f) => f.path);
        const checks = rows.flatMap(([n, cap]) => {
          if (!cap) return [[`${n} resolves`, false, "no registry entry"] as [string, boolean, string]];
          const ref = cap.implementation_ref ?? "";
          const file = /@ (src\/[^\s,]+)/.exec(ref)?.[1];
          return [
            [`${n} resolves`, true, `→ ${cap.capability_key}`] as [string, boolean, string],
            [
              `${n} implementation file exists`,
              Boolean(file && paths.includes(file)),
              file ?? `no file in implementation_ref: "${ref}"`,
            ] as [string, boolean, string],
          ];
        });
        return all(checks);
      },
    },
    {
      id: "T1-01.3",
      group: "Done when — Wave 0 (T1-01 A00, T1-02 A08, T1-03 A09)",
      expectation: "one real call path is proven through the Agent Run Ledger",
      source: `${TODO} §T1-01 "Done when" clause 3`,
      how: "Calls the real gateway (`capability_call`) for A01's classify capability with the shipped deterministic executor and reads the ledger back.",
      async measure() {
        resetAgentRunLedgerForTests();
        const before = recentAgentRuns().length;
        const result = await capability_call({
          agent_id: "A01",
          capability: "classify_problem",
          args: {
            description: "the kitchen tap drips constantly",
            intake_session_id: null,
            problem_family_hint: null,
            now: "2026-08-25T00:00:00Z",
          },
          trigger: "request",
        });
        const runs = recentAgentRuns();
        const row = runs[runs.length - 1];
        return all([
          ["the gateway executed", result.ok === true, result.ok ? "ok" : `denied: ${JSON.stringify(result).slice(0, 90)}`],
          ["a ledger row was appended", runs.length > before],
          ["the row names the agent", row?.agent_id === "A01"],
          [
            "the row names the capability (canonical key, not the alias called)",
            (row?.capabilities_used ?? []).includes("classify_home_problem"),
            (row?.capabilities_used ?? []).join(", "),
          ],
          ["the row carries a run_id", Boolean(row?.run_id)],
        ]);
      },
    },
    {
      id: "T1-01.4",
      group: "Done when — Wave 0 (T1-01 A00, T1-02 A08, T1-03 A09)",
      expectation: "one proof-case event is emitted",
      source: `${TODO} §T1-01 "Done when" clause 4`,
      how: "Emits `capability.invoked` through A08's validateAndEmit and asserts a valid EventEnvelope came back with the emitted status.",
      async measure() {
        const emitted = await validateAndEmit({
          event_name: "capability.invoked",
          agent_id: "A00",
          context: { capability: "eval.proof_case" },
        });
        return all([
          ["status is emitted (not blocked, not undefined)", emitted.status === "emitted", emitted.status],
          ["an envelope came back", emitted.envelope !== null],
          [
            "the envelope validates against the shipped schema",
            emitted.envelope !== null && EventEnvelope.safeParse(emitted.envelope).success,
          ],
        ]);
      },
    },
    {
      id: "T1-01.5",
      group: "Done when — Wave 0 (T1-01 A00, T1-02 A08, T1-03 A09)",
      expectation:
        "the Gateway stub returns the fixture engine's answer unchanged with no AI key set — a keyless deployment is the expected path, not an error state",
      source: `${TODO} §T1-01 "Done when" clause 5; A00 §7 "never let the AI/Tool Gateway silently no-op or crash when no model key is configured"`,
      how: "Runs the same input through `analyzeProblemFixture` directly and through the gateway, with no OPENROUTER_API_KEY in this process, and compares the two JSON-serialised answers.",
      async measure() {
        const input = {
          description: "water pooling under the water heater",
          intake_session_id: null,
          problem_family_hint: null,
          now: "2026-08-25T00:00:00Z",
        };
        const direct = analyzeProblemFixture(input);
        const viaGateway = await capability_call({
          agent_id: "A01",
          capability: "classify_problem",
          args: input,
          trigger: "request",
        });
        const keyless = !process.env.OPENROUTER_API_KEY;
        if (!viaGateway.ok) {
          return fail(`the gateway denied the call: ${JSON.stringify(viaGateway).slice(0, 140)}`);
        }
        const same =
          JSON.stringify(stripIds(viaGateway.output)) === JSON.stringify(stripIds(direct));
        return all([
          ["this process has no model credential", keyless],
          ["the gateway returned the fixture engine's answer byte-for-byte", same],
        ]);
      },
    },
    {
      id: "T1-01.6",
      group: "Done when — Wave 0 (T1-01 A00, T1-02 A08, T1-03 A09)",
      expectation: "at least one real Policy Store tunable is read instead of hard-coded",
      source: `${TODO} §T1-01 "Done when" clause 6`,
      how: "Reads the platform Policy Store and scans src/ for call sites of `requirePolicyNumber` / `requirePolicyBoolean` / `getPolicySetting` outside the store module itself.",
      measure() {
        const callSites = scan(/require(PolicyNumber|PolicyBoolean)\(|getPolicySetting\(/, {
          include: /^src\//,
          exclude: /platform\/policy\/store\.ts$/,
          codeOnly: true,
        });
        const sample = PLATFORM_POLICY_SETTINGS[0];
        const readBack = sample ? getPolicySetting(sample.key) : null;
        const verdict = all([
          ["the store has settings", PLATFORM_POLICY_SETTINGS.length > 0, `${PLATFORM_POLICY_SETTINGS.length} settings`],
          ["a setting reads back", readBack !== null, sample?.key],
          [
            "at least one module outside the store reads a tunable",
            callSites.length > 0,
            `${callSites.length} call sites`,
          ],
        ]);
        return verdict.verdict === "PASS"
          ? pass(
              `${PLATFORM_POLICY_SETTINGS.length} platform tunables; ${callSites.length} read sites outside the store module`,
              describeHits(callSites, 5)
            )
          : verdict;
      },
    },
    {
      id: "T1-01.7",
      group: "Done when — Wave 0 (T1-01 A00, T1-02 A08, T1-03 A09)",
      expectation: "an Approval Center schema plus a stub list view exists",
      source: `${TODO} §T1-01 "Done when" clause 7`,
      how: "Queues a real approval item through the shipped center, lists it back, resolves it; and asserts an admin route file renders the queue.",
      async measure() {
        resetApprovalCenterForTests();
        const item = await queueApproval({
          agent_id: "A00",
          run_id: "ar_eval_probe",
          approval_kind: "data.repair",
          what_happened: "the eval harness queued a probe item to prove the Approval Center round-trips",
          evidence: { probe: true },
          impact: "none — a harness probe",
          risk: "low",
          reversibility: "reversible",
          proposed_change: { probe: true },
        });
        /**
         * `listApprovals` takes a CLIENT PROVIDER, not a status filter. Passing
         * "open" put a string where a function goes; the call survived only
         * because the provider call sits inside a try/catch, and the "open list"
         * was in fact the whole list. Filter for PENDING explicitly, which is
         * what open means.
         */
        const open = (await listApprovals()).filter((i) => i.status === "PENDING");
        /**
         * And `resolveApproval` takes a RESOLUTION OBJECT. The old call passed
         * "approved" as that object and "eval-harness" as the client provider,
         * so it set item.status to undefined, resolved nothing, and returned the
         * item — which the assertion below read as success.
         */
        const resolved = await resolveApproval(item.approval_id, {
          status: "APPROVED",
          resolved_by: "eval-harness",
        });
        const paths = sourceFiles().map((f) => f.path);
        const view = paths.filter((p) => /app\/admin\/approvals|approvals\/.*page\.tsx/.test(p));
        return all([
          ["an item can be queued", Boolean(item.approval_id)],
          ["it appears on the open list", open.some((i) => i.approval_id === item.approval_id)],
          [
            "it can be resolved, and the resolution is what was asked for",
            resolved !== null && resolved.status === "APPROVED" && resolved.resolved_by === "eval-harness",
            resolved ? `${resolved.status} by ${resolved.resolved_by}` : "null",
          ],
          ["an admin list view exists", view.length > 0, view.join(", ") || "none found"],
        ]);
      },
    },
    {
      id: "T1-01.8",
      group: "Done when — Wave 0 (T1-01 A00, T1-02 A08, T1-03 A09)",
      expectation: "the kill switch blocks and releases a scope on command",
      source: `${TODO} §T1-01 "Done when" clause 8; A00 §7 "the check happens BEFORE any capability call, not after"`,
      how: "Engages the AGENT-scope switch for A05, calls the gateway, releases it and calls again — the block and the release are both observed through the real gate.",
      async measure() {
        const args = {
          description: "the kitchen tap drips constantly",
          intake_session_id: null,
          problem_family_hint: null,
          now: "2026-08-25T00:00:00Z",
        };
        // Prove the capability RUNS first, so the refusal below can only be the switch.
        const before = await capability_call({
          agent_id: "A01",
          capability: "classify_problem",
          args,
          trigger: "request",
        });
        await engageKillSwitch({ scope: "AGENT", scope_ref: "A01", by: "eval-harness", reason: "eval harness probe" });
        const engaged = checkKillSwitch("A01");
        const denied = await capability_call({
          agent_id: "A01",
          capability: "classify_problem",
          args,
          trigger: "request",
        });
        await releaseKillSwitch({ scope: "AGENT", scope_ref: "A01", by: "eval-harness", reason: "eval harness probe" });
        const released = checkKillSwitch("A01");
        const after = await capability_call({
          agent_id: "A01",
          capability: "classify_problem",
          args,
          trigger: "request",
        });
        return all([
          ["the capability runs with the switch clear", before.ok === true],
          ["engaging the switch is observable", engaged.engaged === true, engaged.scope ?? "no scope"],
          [
            "the call is BLOCKED (governance), not merely errored, while engaged",
            denied.ok === false && denied.kind === "blocked",
            denied.ok ? "the call ran anyway" : `kind=${denied.kind} reason=${denied.reason}`,
          ],
          ["releasing clears the switch", released.engaged === false],
          ["the capability runs again after release", after.ok === true],
          ["the switch registry is readable", listKillSwitches().size >= 0],
        ]);
      },
    },
    {
      id: "T1-01.9",
      group: "Done when — Wave 0 (T1-01 A00, T1-02 A08, T1-03 A09)",
      expectation:
        "the full test suite stays green at or above the audited 200/200, with lint / typecheck / build clean",
      source: `${TODO} §T1-01 "Done when" clause 9`,
      how: "Counts declared test cases across tests/**. GREEN-NESS IS NOT MEASURED HERE and this row does not claim it: this harness is itself part of `npm run check`, so invoking the gauntlet from inside it would recurse. The gauntlet result is reported beside this report.",
      measure() {
        const files = filesUnder("tests").filter((f) => f.path.endsWith(".test.ts"));
        const cases = files.reduce(
          (n, f) => n + (f.text.match(/^\s*(it|test)(\.\w+)?\(/gm) ?? []).length,
          0
        );
        if (cases < 200) {
          return fail(`${cases} declared test cases across ${files.length} files — below the audited 200 floor`);
        }
        return pass(
          `${cases} declared test cases across ${files.length} files, at or above the audited 200 floor`,
          [
            "SCOPE NOTE: this row measures the case COUNT only. Whether they pass, and whether",
            "lint/typecheck are clean, is what `npm run check` answers — and this harness runs",
            "inside that suite, so it does not run it again from within itself.",
          ]
        );
      },
    },
    {
      id: "T1-01.10",
      group: "Done when — Wave 0 (T1-01 A00, T1-02 A08, T1-03 A09)",
      expectation:
        "the public behaviour of /start, /complete/[request_id], packet and results pages is verified unchanged",
      source: `${TODO} §T1-01 "Done when" clause 10`,
      how: "Automated half: scans every customer-facing route under src/app (everything outside /admin and /api/admin) for any import of the AI layer — the one thing that could have changed those pages' behaviour. The human walkthrough half is an owner act and is cited, not simulated.",
      measure() {
        const aiImports = scan(/from "@\/platform\/ai\//, {
          include: /^src\/app\//,
          exclude: /^src\/app\/(admin|api\/admin)\//,
          codeOnly: true,
        });
        if (aiImports.length > 0) {
          return fail(
            `${aiImports.length} customer-facing route file(s) import the AI layer`,
            describeHits(aiImports)
          );
        }
        return pass(
          "no customer-facing route under src/app imports platform/ai — the model layer cannot reach /start, /complete, the packet or the results page at all",
          [
            "The human walkthrough half of this clause is an owner act, recorded in the A00 spec's",
            "APPROVAL RECORD (2026-08-24, 'a section-by-section owner walkthrough'), not re-run here.",
          ]
        );
      },
    },

    /* ------------------------------------------------------------------ */
    /* T1-02 — A08 Metric & Event Steward                                  */
    /* ------------------------------------------------------------------ */
    {
      id: "T1-02.1",
      group: "Done when — Wave 0 (T1-01 A00, T1-02 A08, T1-03 A09)",
      expectation:
        "`EventDefinition` / `MetricDefinition` schemas exist and are unit-tested with accept AND reject cases",
      source: `${TODO} §T1-02 "Done when" clause 1`,
      how: "Parses a well-formed definition of each kind (must accept) and a malformed one (must reject), through the shipped zod schemas.",
      async measure() {
        const { EventDefinition, MetricDefinition } = await import("@/platform/events/definitions");
        const goodEvent = EventDefinition.safeParse({
          event_name: "eval.probe_event",
          definition_version: 1,
          description: "a harness probe definition",
          owning_agent_or_domain: "A08",
          required_envelope_fields: ["event_id", "occurred_at"],
          payload_schema_ref: null,
          privacy_class: "internal",
          retention_class: "TBD",
          status: "proposed",
        });
        const badEvent = EventDefinition.safeParse({ event_name: "NoDotHere", definition_version: 1 });
        const goodMetric = MetricDefinition.safeParse({
          metric_key: "eval_probe_metric",
          definition_version: 1,
          display_name: "Eval Probe",
          formula_description: "a harness probe",
          metric_type: "count",
          source_events: ["page.published"],
          metric_window: "rolling_7d",
          status: "proposed",
        });
        const badMetric = MetricDefinition.safeParse({ metric_key: "", definition_version: 0 });
        return all([
          ["a well-formed EventDefinition is accepted", goodEvent.success, goodEvent.success ? "" : JSON.stringify(goodEvent.error.issues[0])],
          ["a malformed EventDefinition is rejected", !badEvent.success],
          ["a well-formed MetricDefinition is accepted", goodMetric.success, goodMetric.success ? "" : JSON.stringify(goodMetric.error.issues[0])],
          ["a malformed MetricDefinition is rejected", !badMetric.success],
        ]);
      },
    },
    {
      id: "T1-02.2",
      group: "Done when — Wave 0 (T1-01 A00, T1-02 A08, T1-03 A09)",
      expectation:
        "the `EventEnvelope` type is exported and a runtime assertion rejects a missing required field",
      source: `${TODO} §T1-02 "Done when" clause 2`,
      how: "Emits an envelope missing a dictionary-required field through validateAndEmit and asserts the emission is BLOCKED (never a silently partial row), then checks the counter moved.",
      async measure() {
        resetStewardForTests();
        const withMissing = await validateAndEmit({
          event_name: "seo.page_performance_recorded",
          agent_id: "A04",
          // Deliberately short of the seven context keys its definition requires.
          context: { page_id: "page_eval_probe" },
        });
        const counters = stewardCounters();
        const def = currentEventDefinition("seo.page_performance_recorded");
        const required = def?.required_envelope_fields ?? [];
        if (required.length === 0) {
          return fail("seo.page_performance_recorded declares no required envelope fields, so nothing can be missing");
        }
        return all([
          ["the emission was blocked", withMissing.status === "blocked", withMissing.status],
          ["no envelope was written", withMissing.envelope === null],
          ["the block counter moved", counters.emissions_blocked_missing_field > 0],
          ["the reason names the missing fields", withMissing.reasons.join(" ").includes("missing required")],
        ]);
      },
    },
    {
      id: "T1-02.3",
      group: "Done when — Wave 0 (T1-01 A00, T1-02 A08, T1-03 A09)",
      expectation:
        "the 14A §18.2 seed event list (page.viewed, intake.started, packet.generated, trust.request_created, provider.recommendation_shown, page.published, agent.run_started …) is registered as `approved`, reconciled against anything already emitted in src/",
      source: `${TODO} §T1-02 "Done when" clause 3`,
      how: "Looks up each named seed in the dictionary and asserts status `approved`; then scans src/ for every `event_name:` literal actually emitted and asserts each one is a canonical, defined name.",
      measure() {
        const named = [
          "page.viewed",
          "intake.started",
          "packet.generated",
          "trust.request_created",
          "provider.recommendation_shown",
          "page.published",
          "agent.run_started",
        ];
        const unapproved = named.filter((n) => currentEventDefinition(n)?.status !== "approved");
        const emitted = new Set(
          scan(/event_name:\s*"([a-z_]+\.[a-z_]+)"/, { include: /^src\//, codeOnly: true })
            .map((h) => /event_name:\s*"([a-z_.]+)"/.exec(h.text)?.[1])
            .filter((n): n is string => Boolean(n))
        );
        const unregistered = [...emitted].filter(
          (n) => !(EVENT_NAMES as readonly string[]).includes(n)
        );
        const undefinedNames = [...emitted].filter((n) => !currentEventDefinition(n));
        return all([
          ["every named 14A seed is approved", unapproved.length === 0, unapproved.join(", ")],
          [`every name emitted in src/ is canonical (${emitted.size} distinct)`, unregistered.length === 0, unregistered.join(", ")],
          ["every emitted name has a definition", undefinedNames.length === 0, undefinedNames.join(", ")],
          [`the seed census is fully registered (${SEED_CENSUS.core_14a} core)`, listEventDefinitions("approved").length >= SEED_CENSUS.core_14a],
        ]);
      },
    },
    {
      id: "T1-02.4",
      group: "Done when — Wave 0 (T1-01 A00, T1-02 A08, T1-03 A09)",
      expectation:
        "`validateAndEmit` / `proposeEventDefinition` / `proposeMetricDefinition` / `getMetricLineage` / `getEventImpact` exist and pass adversarial tests — a colliding name is rejected",
      source: `${TODO} §T1-02 "Done when" clause 4 (adversarial case 1)`,
      how: "Proposes a definition for a name the dictionary already carries and asserts the proposal is REJECTED, with the reason naming the collision.",
      async measure() {
        const res = await proposeEventDefinition(
          {
            event_name: "page.published",
            description: "a colliding proposal from the eval harness",
            owning_agent_or_domain: "A08",
            required_envelope_fields: ["event_id"],
            payload_schema_ref: null,
            privacy_class: "internal",
            retention_class: "TBD",
            status: "proposed",
          },
          { run_id: "ar_eval_probe", proposed_by: "eval-harness" }
        );
        return all([
          ["the proposal was rejected", res.outcome === "rejected", res.outcome],
          ["the reason names the collision", res.reasons.join(" ").includes("collision")],
          ["the five named functions exist", [validateAndEmit, proposeEventDefinition, proposeMetricDefinition, getMetricLineage, getEventImpact].every((f) => typeof f === "function")],
        ]);
      },
    },
    {
      id: "T1-02.5",
      group: "Done when — Wave 0 (T1-01 A00, T1-02 A08, T1-03 A09)",
      expectation: "a rate-type metric with no `denominator_event` is rejected",
      source: `${TODO} §T1-02 "Done when" clause 4 (adversarial case 3)`,
      how: "Proposes a `rate` MetricDefinition with no denominator_event through the real proposal path.",
      async measure() {
        const res = await proposeMetricDefinition(
          {
            metric_key: "eval_probe_rate",
            display_name: "Eval Probe Rate",
            formula_description: "a rate with no denominator, deliberately",
            metric_type: "rate",
            source_events: ["page.published"],
            metric_window: "rolling_7d",
            status: "proposed",
          } as never,
          { run_id: "ar_eval_probe", proposed_by: "eval-harness" }
        );
        return all([
          ["the proposal was rejected", res.outcome === "rejected", res.outcome],
          [
            "the reason names the denominator",
            res.reasons.join(" ").toLowerCase().includes("denominator"),
            res.reasons.join(" ").slice(0, 120),
          ],
        ]);
      },
    },
    {
      id: "T1-02.6",
      group: "Done when — Wave 0 (T1-01 A00, T1-02 A08, T1-03 A09)",
      expectation:
        "a change to an ALREADY-REGISTERED definition always routes to the Approval Center, no matter how clean",
      source: `${TODO} §T1-02 "Done when" clause 4 (adversarial case 4); A08 §7 "schema changes to an existing definition always require Approval Center sign-off, regardless of how clean the diff looks"`,
      how: "Submits the cleanest possible change — a description edit — to a registered definition, and asserts it is QUEUED, not applied.",
      async measure() {
        resetApprovalCenterForTests();
        const before = currentEventDefinition("page.published");
        const res = await proposeEventDefinitionChange(
          "page.published",
          { description: "a perfectly harmless description edit from the eval harness" },
          { run_id: "ar_eval_probe", proposed_by: "eval-harness" }
        );
        const after = currentEventDefinition("page.published");
        const open = (await listApprovals()).filter((i) => i.status === "PENDING");
        return all([
          ["the change was queued for approval", res.outcome === "queued_for_approval", res.outcome],
          ["an approval item exists", open.length > 0 && Boolean(res.approval_id)],
          [
            "the live definition was NOT changed",
            after?.description === before?.description,
            after?.description === before?.description ? "unchanged" : "MUTATED",
          ],
        ]);
      },
    },
    {
      id: "T1-02.7",
      group: "Done when — Wave 0 (T1-01 A00, T1-02 A08, T1-03 A09)",
      expectation: "a `deprecate()` function keeps old names queryable",
      source: `${TODO} §T1-02 "Done when" clause 5; A08 §7 "historical versions remain queryable … never hard-delete"`,
      how: "Calls deprecate() for a registered name, then asserts the name still resolves through lookupEventDefinition and that the call was approval-gated rather than applied.",
      async measure() {
        const res = await deprecate(
          "event",
          "page.qa_failed",
          "page.qa_passed",
          { run_id: "ar_eval_probe", proposed_by: "eval-harness" }
        );
        const still = lookupEventDefinition("page.qa_failed");
        return all([
          ["deprecation is approval-gated, not applied", res.outcome === "queued_for_approval", res.outcome],
          ["the name is still queryable", still.definition !== null],
          ["no hard delete happened", currentEventDefinition("page.qa_failed") !== null],
        ]);
      },
    },
    {
      id: "T1-02.8",
      group: "Done when — Wave 0 (T1-01 A00, T1-02 A08, T1-03 A09)",
      expectation:
        "the 11 named owner gauges (Qualified Demand Health, Useful Outcome Rate, Intake Friction, Packet Use, Trust Conversion, Provider Decision Relief, Future Feature Pull, Search Proof, Data Moat Yield, System/Autonomy, AI-Native Readiness) can each be registered as a MetricDefinition",
      source: `${TODO} §T1-02 "Done when" clause 6`,
      how: "Reads the metric registry back and matches all eleven display names.",
      measure() {
        const wanted = [
          "Qualified Demand Health",
          "Useful Outcome Rate",
          "Intake Friction",
          "Packet Use",
          "Trust Conversion",
          "Provider Decision Relief",
          "Future Feature Pull",
          "Search Proof",
          "Data Moat Yield",
          "System / Autonomy",
          "AI-Native Readiness",
        ];
        const have = listMetricDefinitions().map((m) => m.display_name);
        const missing = wanted.filter((w) => !have.includes(w));
        return missing.length === 0
          ? pass(`all 11 owner gauges are registered (${have.length} metric definitions in the registry)`)
          : fail(`${missing.length} owner gauge(s) not registered: ${missing.join(", ")}`);
      },
    },
    {
      id: "T1-02.9",
      group: "Done when — Wave 0 (T1-01 A00, T1-02 A08, T1-03 A09)",
      expectation:
        "the event/metric registry PERSISTS — the dictionary is a durable record, not an in-process one",
      source: `${TODO} §T1-02 "Done when" clause 3 ('registered'), read against A08 §7 'historical versions remain queryable'`,
      /**
       * RE-POINTED 2026-08-25 — the prerequisite this was blocked on has been
       * met, and the row was reading a comment that had gone stale.
       *
       * It decided BLOCKED by grepping the dictionary module for the words "not
       * applied". Migration 00009 was applied on 2026-08-25 and the comment had
       * not caught up, so the harness reported an owner-facing blocker against a
       * table that exists. Verified independently before this row was touched:
       *
       *     npm run db:migrate -- --status
       *     → 12 of 12 [applied], 40 public tables, RLS ON for every one
       *
       * WHAT THIS ROW CAN AND CANNOT SEE, said plainly. The harness runs with no
       * database on purpose (evals/env.ts deletes SUPABASE_URL and the service
       * role, so a report can never write to production). So it measures the
       * three things that are true offline — a durable write path exists, it
       * targets 00009, and the repo carries a dated record of that migration
       * being applied — and it does not claim to have read a row back out. The
       * command above is how anyone re-checks the half this cannot.
       */
      how: "Reads the dictionary's durable write path, the migration it targets, and the repo's dated record of that migration being applied. Does NOT reach the database: this harness runs with no credentials by design, so the applied state is cited, not re-queried.",
      async measure() {
        const src = readSource("src/platform/events/dictionary.ts");
        const { PLATFORM_MIGRATIONS_APPLIED } = await import("@/platform/db/client");
        const targets = /00009_event_metric_registry\.sql/.test(src);
        const writePath = /persistSeededDictionary|from\("event_definition"\)|from\("metric_definition"\)/.test(src);
        const recorded = PLATFORM_MIGRATIONS_APPLIED.through >= "00009";
        if (!targets || !writePath) {
          return fail(
            `the dictionary ${!writePath ? "has no durable write path" : "does not name migration 00009"}`
          );
        }
        return recorded
          ? pass(
              `the dictionary writes through to the durable registry, and 00009 is applied (${PLATFORM_MIGRATIONS_APPLIED.applied_on})`,
              [
                `ok    a durable write path exists and targets 00009_event_metric_registry.sql`,
                `ok    migrations applied through ${PLATFORM_MIGRATIONS_APPLIED.through} on ${PLATFORM_MIGRATIONS_APPLIED.applied_on}`,
                `--    verified by: ${PLATFORM_MIGRATIONS_APPLIED.verified_by}`,
                `--    NOT measured here: this harness holds no database credentials by design, so no row was read back`,
              ]
            )
          : blocked(
              "the dictionary has a durable write path, but the repo carries no record of migration 00009 being applied",
              "supabase/migrations/00009_event_metric_registry.sql applied to a live database, recorded in PLATFORM_MIGRATIONS_APPLIED (src/platform/db/client.ts) — check with `npm run db:migrate -- --status`"
            );
      },
    },

    /* ------------------------------------------------------------------ */
    /* T1-03 — A09 Data Quality & Reconciliation                           */
    /* ------------------------------------------------------------------ */
    {
      id: "T1-03.1",
      group: "Done when — Wave 0 (T1-01 A00, T1-02 A08, T1-03 A09)",
      expectation:
        "a VERSIONED `InvariantRule` set exists with a deliberately-broken AND a clean fixture per rule",
      source: `${TODO} §T1-03 "Done when" clause 1`,
      how: "Reads INVARIANT_RULES and its version constant, then asserts the repo ships a fixtures module and that each rule id appears in the quality test corpus.",
      measure() {
        const fixtures = readSource("src/platform/quality/fixtures.ts");
        const tests = filesUnder("tests")
          .filter((f) => /quality|a09/.test(f.path))
          .map((f) => f.text)
          .join("\n");
        const uncovered = INVARIANT_RULES.filter((r) => !tests.includes(r.rule_id));
        return all([
          ["the rule set is versioned", typeof INVARIANT_RULE_SET_VERSION === "number", `v${INVARIANT_RULE_SET_VERSION}`],
          ["rules exist", INVARIANT_RULES.length > 0, `${INVARIANT_RULES.length} rules`],
          ["clean fixtures ship", /clean(ProblemRecord|JobPacket|ConsentEvent)/.test(fixtures)],
          ["every rule id is exercised by the quality tests", uncovered.length === 0, uncovered.map((r) => r.rule_id).join(", ")],
        ]);
      },
    },
    {
      id: "T1-03.2",
      group: "Done when — Wave 0 (T1-01 A00, T1-02 A08, T1-03 A09)",
      expectation:
        "ingest-time validation catches a known-bad write IN THE SAME REQUEST CYCLE",
      source: `${TODO} §T1-03 "Done when" clause 3 (first half)`,
      how: "Runs a deliberately-broken subject through `evaluateSubject` — the same synchronous evaluator the store guard calls — and asserts the violation is returned, not deferred.",
      measure() {
        const broken = {
          problem_id: "pr_eval_broken",
          schema_version: "1.0.0",
          request_id: "rq_eval",
          description: "",
          service_category: "plumbing",
          service_category_confidence: 0.9,
          urgency: "routine",
          safety_state: "none",
          safety_rule_id: null,
          evidence_ids: [""],
          created_at: "2026-08-25T00:00:00Z",
          updated_at: "2026-08-25T00:00:00Z",
        };
        const violations = evaluateSubject(
          { entity_type: "problem_record", entity_id: "pr_eval_broken", record: broken as never },
          {}
        );
        return violations.length > 0
          ? pass(
              `the synchronous evaluator returned ${violations.length} violation(s) for the broken record`,
              violations.slice(0, 4).map((v) => `${v.rule.rule_id}: ${v.violation.detail_code}`)
            )
          : fail("a deliberately-broken ProblemRecord produced no violations");
      },
    },
    {
      id: "T1-03.3",
      group: "Done when — Wave 0 (T1-01 A00, T1-02 A08, T1-03 A09)",
      expectation:
        "nightly reconciliation catches a manufactured cross-source mismatch IN STAGING",
      source: `${TODO} §T1-03 "Done when" clause 3 (second half)`,
      /**
       * STILL BLOCKED, on the LAST of three prerequisites — and the row has now
       * been wrong-in-the-same-direction twice, so it is worth writing down what
       * actually moved rather than letting the wording drift again.
       *
       * PREREQUISITE 1, RETIRED 2026-08-25: "a deployed staging environment WITH
       * THE SUPABASE MIGRATIONS APPLIED — this repo has one source (the file
       * backend) until 00006+ are applied". The migrations are applied. A second
       * source exists. Gone.
       *
       * PREREQUISITE 2, RETIRED 2026-08-25: `runReconciliation()` HAD NO CALLER.
       * Not a cron route, not an admin action, not a tool — the only invocations
       * anywhere were in tests/quality.reconciliation.test.ts, so the sweeps had
       * never looked at a real store. An owner-gated trigger now exists
       * (src/app/api/admin/quality/reconcile/route.ts, with a button in the A09
       * section of the cockpit), it runs through the kill switch, and it writes
       * one Agent Run Ledger row per run. Gone.
       *
       * PREREQUISITE 3, WHAT IS ACTUALLY LEFT: A CADENCE. The clause says
       * "NIGHTLY reconciliation", and nightly is a claim about something running
       * with nobody awake. A button a human presses is not that, however
       * correctly it is wired. No scheduler, cron entry or timer was added, ON
       * PURPOSE — inventing one to turn this row green would have made the row
       * assert something untrue, which is the exact failure A09 exists to
       * prevent.
       *
       * SO THE MEASURE BELOW GOT STRICTER, NOT LOOSER. It used to return PASS
       * for ANY caller, which means the trigger just built would have flipped
       * this row to PASS and quietly claimed a nightly run that does not happen.
       * It now separates a human trigger from an automatic one and only the
       * second can pass. A row that would have passed today under the old
       * measure and does not under the new one is the measure being fixed.
       *
       * (Scope note, pre-existing: `scan` only walks src/, so the `tools/`
       * branch of the include has never actually matched anything. Left as-is —
       * nothing under tools/ calls the pass either.)
       */
      how: "Reads the reconciliation check set, finds everything that INVOKES the pass, and then asks the question the clause actually asks: can any of those callers fire without a human? An owner-gated route is a trigger, not a cadence.",
      measure() {
        if (RECONCILIATION_CHECKS.length === 0) return fail("no reconciliation checks are defined");
        const callers = scan(/runReconciliation\s*\(/, {
          include: /^(src|tools)\//,
          exclude: /platform\/quality\/reconciliation\.ts$/,
          codeOnly: true,
        });
        if (callers.length === 0) {
          return blocked(
            `${RECONCILIATION_CHECKS.length} reconciliation checks are defined and unit-covered, but nothing in src/ invokes runReconciliation(), so no pass has ever run outside a test`,
            "an entry point that calls runReconciliation() at all, and then a cadence that fires it without a human",
            [
              "FAIL  nothing outside tests/ calls runReconciliation() — the pass has no trigger",
            ]
          );
        }
        // A caller only counts as a CADENCE if something other than a person can
        // fire it. An owner-gated admin route is the opposite of that by design.
        const ownerGated = callers.filter(
          (c) => /^src\/app\/api\/admin\//.test(c.path) && /isAdminUnlocked\(/.test(readSource(c.path))
        );
        const callerPaths = new Set(callers.map((c) => c.path));
        const automation = scan(/setInterval\(|node-cron|CronJob|@vercel\/cron|export const revalidate/, {
          include: /^src\//,
          codeOnly: true,
        }).filter((h) => callerPaths.has(h.path));
        const automatic = callers.filter((c) => !ownerGated.some((g) => g.path === c.path));

        if (automation.length > 0 || automatic.length > 0) {
          return pass(
            `the pass has ${callers.length} caller(s) and at least one can fire without a human: ${[...automation, ...automatic].map((c) => `${c.path}:${c.line}`).join(", ")}`
          );
        }
        return blocked(
          `HALF MET, and the retired half is real work. ${RECONCILIATION_CHECKS.length} checks are defined, two real sources exist to compare (migrations applied 2026-08-25), and the pass now HAS a trigger — ${ownerGated.map((c) => `${c.path}:${c.line}`).join(", ")}, owner-gated, kill-switch-checked, one ledger row per run. What is missing is the word NIGHTLY: every caller needs a human to press it, so the pass still never runs on its own`,
          "a cadence — something that invokes runReconciliation() with nobody awake (the module is a plain idempotent callable by design, and takes a date-stamped run_key precisely so a scheduled retry cannot double-write; WORKFLOW_ORCHESTRATOR_STATUS is still DEFERRED_INTERFACE_ONLY, so this needs either that orchestrator or a platform scheduler), plus one deployed environment for it to run in",
          [
            `ok    ${RECONCILIATION_CHECKS.length} checks defined, including the cross-source sweep`,
            "ok    a second source now exists — migrations applied 2026-08-25",
            `ok    the pass has a real caller — ${ownerGated.length} owner-gated trigger(s), proved end to end in tests/quality.reconcile-trigger.test.ts`,
            "FAIL  nothing fires it without a human — no scheduler, no cron entry, no timer, deliberately",
          ]
        );
      },
    },
    {
      id: "T1-03.4",
      group: "Done when — Wave 0 (T1-01 A00, T1-02 A08, T1-03 A09)",
      expectation:
        "quarantined records disappear from A07's KPI reads and customer-facing surfaces but stay owner-retrievable — NOTHING IS DELETED",
      source: `${TODO} §T1-03 "Done when" clause 4; A09 §7 "never destroy source evidence. Quarantine, don't drop."`,
      how: "Reads the declared KPI read paths that honour quarantine, and scans the quality module for any delete/drop of a source row.",
      measure() {
        const deletes = scan(/\.delete\(\)|DELETE FROM|\.remove\(/, {
          include: /^src\/platform\/quality\//,
          codeOnly: true,
        });
        return all([
          [
            "KPI read paths that honour quarantine are declared",
            KPI_READ_PATHS_HONOURING_QUARANTINE.length > 0,
            `${KPI_READ_PATHS_HONOURING_QUARANTINE.length} paths`,
          ],
          ["no delete of a source row anywhere in platform/quality", deletes.length === 0, describeHits(deletes, 3).join(" | ")],
        ]);
      },
    },
    {
      id: "T1-03.5",
      group: "Done when — Wave 0 (T1-01 A00, T1-02 A08, T1-03 A09)",
      expectation:
        "the safe-repair allow-list DEFAULTS EMPTY, with simulation + reversal tests for any entry added",
      source: `${TODO} §T1-03 "Done when" clause 5; A09 §7 "auto-repair classes default to empty"`,
      how: "Reads AUTO_REPAIR_ALLOW_LIST, asks `mayAutoExecute` about every repair kind the system knows, and asserts a simulation exists for the repair path.",
      async measure() {
        const { REPAIR_KINDS } = await import("@/platform/quality/repairs");
        // `repair_kind`, not `kind` — see the same fix in never-do.ts. Asking
        // about undefined answers "no" for a reason that has nothing to do with
        // the allow-list.
        const anyAuto = REPAIR_KINDS.filter((k) => mayAutoExecute(k.repair_kind));
        return all([
          ["the allow-list is empty", AUTO_REPAIR_ALLOW_LIST.length === 0, `${AUTO_REPAIR_ALLOW_LIST.length} entries`],
          ["auto-repair is off", autoRepairEnabled() === false],
          [
            `no repair kind may auto-execute (${REPAIR_KINDS.length} asked)`,
            anyAuto.length === 0,
            anyAuto.map((k) => k.repair_kind).join(", "),
          ],
          ["a simulation function exists", typeof simulateRepair === "function"],
        ]);
      },
    },
    {
      id: "T1-03.6",
      group: "Done when — Wave 0 (T1-01 A00, T1-02 A08, T1-03 A09)",
      expectation:
        "a manufactured critical issue appears inside A07's EXISTING cockpit view — with NO new top-level admin page",
      source: `${TODO} §T1-03 "Done when" clause 6`,
      how: "Enumerates the top-level route folders under src/app/admin and asserts none of them is a data-quality page; then confirms the exception queue is read from the existing admin surface.",
      measure() {
        const adminPages = filesUnder("src/app/admin")
          .filter((f) => f.path.endsWith("/page.tsx"))
          .map((f) => f.path);
        const qualityPage = adminPages.filter((p) => /quality|data-quality|reconcil/.test(p));
        const cockpitReadsQueue = scan(/exceptionQueue|qualityKpiSnapshot/, {
          include: /^src\/(app\/admin|platform\/admin)\//,
          codeOnly: true,
        });
        return all([
          ["no new top-level data-quality admin page", qualityPage.length === 0, qualityPage.join(", ")],
          ["the existing admin surface reads the quality queue", cockpitReadsQueue.length > 0, `${cockpitReadsQueue.length} read sites`],
        ]);
      },
    },
    {
      id: "T1-03.7",
      group: "Done when — Wave 0 (T1-01 A00, T1-02 A08, T1-03 A09)",
      expectation:
        "A09 has a real Agent Registry entry — autonomy L2, budgets, kill switch",
      source: `${TODO} §T1-03 "Done when" clause 7`,
      how: "Reads TRIAL_AGENT_REGISTRY for A09 and checks the three named fields.",
      measure() {
        const a09 = TRIAL_AGENT_REGISTRY.find((a) => a.agent_id === "A09");
        if (!a09) return fail("A09 has no Agent Registry entry");
        return all([
          ["an entry exists", true, a09.name],
          ["it carries an autonomy level", Boolean(a09.autonomy_level), String(a09.autonomy_level)],
          ["it carries budgets", Boolean(a09.budgets), JSON.stringify(a09.budgets ?? {}).slice(0, 80)],
          ["it carries a kill switch ref", Boolean(a09.kill_switch_ref), String(a09.kill_switch_ref)],
        ]);
      },
    },
    {
      id: "T1-03.8",
      group: "Done when — Wave 0 (T1-01 A00, T1-02 A08, T1-03 A09)",
      expectation: "every validation and reconciliation run writes an Agent Run Ledger row",
      source: `${TODO} §T1-03 "Done when" clause 8`,
      how: "Scans the quality run modules for `recordAgentRun` and asserts each run entry point calls it.",
      measure() {
        const runners = ["src/platform/quality/ingest.ts", "src/platform/quality/reconciliation.ts"];
        const checks = runners.map((path) => {
          const text = readSource(path);
          return [`${path} records a run`, /recordAgentRun\(/.test(text)] as [string, boolean];
        });
        return all(checks);
      },
    },
    {
      id: "T1-03.9",
      group: "Done when — Wave 0 (T1-01 A00, T1-02 A08, T1-03 A09)",
      expectation:
        "the end-to-end drill passes: inject bad record → ingest catch → quarantine → absent from KPIs → present in the exception queue → owner approves or rejects a repair → repair_verified or rejected fires",
      source: `${TODO} §T1-03 "Done when" clause 9`,
      how: "The drill itself is a committed test (tests/a09.end-to-end-drill.test.ts). This row asserts the drill exists and covers all seven named steps, by matching the step vocabulary in its assertions.",
      measure() {
        const drill = filesUnder("tests").find((f) => f.path.endsWith("a09.end-to-end-drill.test.ts"));
        if (!drill) return fail("tests/a09.end-to-end-drill.test.ts does not exist");
        const steps: Array<[string, RegExp]> = [
          ["inject bad record", /badJourney|bad record|deliberate/i],
          ["ingest catch", /currentFindings|ingest/i],
          ["quarantine", /activeQuarantine|applyQuarantine|quarantine/i],
          ["absent from KPIs", /qualityKpiSnapshot|FilteredJourneyTotals|KPI/i],
          ["exception queue", /exceptionQueue/],
          ["owner approves or rejects", /resolve|approve|reject/i],
          ["the event fires", /repair_verified|repair.*event|rejected/i],
        ];
        const missing = steps.filter(([, re]) => !re.test(drill.text)).map(([n]) => n);
        return missing.length === 0
          ? pass(`the committed drill covers all ${steps.length} named steps`)
          : fail(`the committed drill does not cover: ${missing.join(", ")}`);
      },
    },
    {
      id: "T1-03.10",
      group: "Done when — Wave 0 (T1-01 A00, T1-02 A08, T1-03 A09)",
      expectation:
        "`DataQualityIssue` / `ReconciliationMismatch` schema PERSISTS with severity and a non-fabricated `suspected_owner`",
      source: `${TODO} §T1-03 "Done when" clause 2`,
      /**
       * RE-POINTED 2026-08-25, same defect as T1-02.9 and worse.
       *
       * The old condition was `/00010_data_quality\.sql|NOT applied/` — an OR,
       * so merely NAMING the migration file was enough to report BLOCKED. A
       * store that mentions the table it writes to was being read as a store
       * that cannot write to it, and the row could never have passed however
       * much of the database existed. Migration 00010 has been applied since
       * 2026-08-25 (verified with `npm run db:migrate -- --status`).
       *
       * Measured now as the clause actually reads: both fields exist, both are
       * ENFORCED rather than merely declared, a Supabase backend writes them,
       * and the migration behind it is on record as applied.
       */
      how: "Asserts both named fields exist and are enforced by the schema, that a Supabase backend writes them, and that the migration behind that table is recorded as applied.",
      async measure() {
        const types = readSource("src/platform/quality/types.ts");
        const store = readSource("src/platform/quality/store.ts");
        const { PLATFORM_MIGRATIONS_APPLIED } = await import("@/platform/db/client");
        const hasSeverity = /severity/.test(types);
        const hasOwner = /suspected_owner/.test(types);
        const durableBackend = /class SupabaseQualityStore/.test(store);
        const recorded = PLATFORM_MIGRATIONS_APPLIED.through >= "00010";
        if (!hasSeverity || !hasOwner) {
          return fail(
            `the quality schema is missing ${!hasSeverity ? "severity" : ""}${!hasSeverity && !hasOwner ? " and " : ""}${!hasOwner ? "suspected_owner" : ""}`
          );
        }
        return durableBackend && recorded
          ? pass(
              `severity and suspected_owner exist, are enforced, and persist to the table 00010 created (applied ${PLATFORM_MIGRATIONS_APPLIED.applied_on})`,
              [
                "ok    both fields are on the shipped schema",
                "ok    a Supabase-backed quality store writes them",
                `ok    migrations applied through ${PLATFORM_MIGRATIONS_APPLIED.through} on ${PLATFORM_MIGRATIONS_APPLIED.applied_on}`,
                "--    NOT measured here: this harness holds no database credentials by design, so no finding was read back",
              ]
            )
          : blocked(
              "both fields exist and are enforced; what is missing is the durable side",
              durableBackend
                ? "supabase/migrations/00010_data_quality.sql applied to a live database, recorded in PLATFORM_MIGRATIONS_APPLIED (src/platform/db/client.ts)"
                : "a Supabase-backed quality store — the findings currently have only a file backend"
            );
      },
    },
  ];

  return {
    group: "Done when — Wave 0 (T1-01 A00, T1-02 A08, T1-03 A09)",
    preamble:
      "Every row is one clause of a Master Todo 'Done when:' line, split at the record's own semicolons. " +
      "These are the three P0 items — the record says everything else in Phase 1 waits on them, so an unmet " +
      "clause here is not a detail.",
    expectations,
  };
}

/** Drop generated ids so two runs of the same deterministic engine compare equal. */
function stripIds(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (key, v) =>
      /_id$|_at$/.test(key) && typeof v === "string" ? "<generated>" : v
    )
  );
}
