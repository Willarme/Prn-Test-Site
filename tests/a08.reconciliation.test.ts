import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { currentEventDefinition } from "@/platform/events/dictionary";
import { EVENT_NAMES } from "@/platform/events/names";

/**
 * A08 build step 3, second half — THE RECONCILIATION REPORT. §5 and §11 both
 * require the build to reconcile the seed list against anything already
 * emitted in src/ and to REPORT it either way: "grep first; register found
 * names or flag the mismatch — do not silently invent a second scheme."
 *
 * The one-off grep is worth little the day after it runs, so the reconciliation
 * ships as a standing test instead. It scans src/ for the two emit idioms this
 * codebase actually uses and asserts every emitted name resolves to an approved
 * EventDefinition. A third idiom appearing later fails the coverage check
 * below rather than slipping through unscanned.
 *
 * FINDING AT BUILD TIME (2026-08-24): five literal emit sites, all registered —
 * agent.run_completed, capability.invoked, intake.evidence_added,
 * platform.kill_switch_engaged, platform.kill_switch_released — plus the
 * makeEvent(...) literals in /api/intake and one template literal,
 * `feature_lab.${kind}` in /api/feature-interest, which is compile-time
 * constrained by a cast to EventEnvelope["event_name"] and whose four possible
 * expansions are all registered. NO unregistered name is emitted anywhere, and
 * no second naming scheme exists in src/.
 */

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

const srcFiles = walk(join(process.cwd(), "src"));

/** The two idioms in use: `event_name: "x"` and `makeEvent("x", ...)`. */
const EMIT_PATTERNS = [/event_name:\s*"([a-z_][a-z_0-9.]*)"/g, /makeEvent\(\s*"([a-z_][a-z_0-9.]*)"/g];

function emittedNames(): { name: string; file: string }[] {
  const found: { name: string; file: string }[] = [];
  for (const file of srcFiles) {
    const content = readFileSync(file, "utf-8");
    for (const pattern of EMIT_PATTERNS) {
      pattern.lastIndex = 0;
      let match: RegExpExecArray | null = pattern.exec(content);
      while (match) {
        found.push({ name: match[1], file: file.replace(/\\/g, "/") });
        match = pattern.exec(content);
      }
    }
  }
  return found;
}

describe("A08 reconciliation — the seed list vs what src/ already emits", () => {
  it("finds emit sites at all (the scan is not silently matching nothing)", () => {
    expect(emittedNames().length).toBeGreaterThan(4);
  });

  it("every event name emitted anywhere in src/ resolves to an APPROVED definition", () => {
    for (const { name, file } of emittedNames()) {
      const def = currentEventDefinition(name);
      expect(def, `${name} emitted at ${file} has no EventDefinition`).not.toBeNull();
      expect(def!.status, `${name} emitted at ${file}`).toBe("approved");
    }
  });

  it("no second naming scheme: every emitted name is in the canonical list", () => {
    for (const { name, file } of emittedNames()) {
      expect(EVENT_NAMES as readonly string[], `${name} at ${file}`).toContain(name);
    }
  });

  it("the one templated emit site expands only to registered names", () => {
    // src/app/api/feature-interest/route.ts builds `feature_lab.${kind}`.
    for (const kind of ["viewed", "cta", "thumb", "email"]) {
      expect(currentEventDefinition(`feature_lab.${kind}`)?.status).toBe("approved");
    }
  });

  it("the scan covers every file that emits — a third idiom cannot slip through", () => {
    const emitters = srcFiles.filter((f) => {
      const c = readFileSync(f, "utf-8");
      return /recordEvents\(|emitPlatformEvent\(|validateAndEmit\(/.test(c);
    });
    // Files that only DEFINE or TEST the mechanism carry no literal names.
    const mechanism = [
      "platform/events/emit.ts",
      // A02's customer-attributed emitter (2026-08-25). Same category as
      // emit.ts: it BUILDS envelopes and holds no literal name of its own —
      // every name it carries arrives typed as EventName from its callers,
      // which this scan reads like any other caller.
      "platform/events/customer.ts",
      "platform/events/steward.ts",
      "platform/events/definitions.ts",
      "platform/events/names.ts",
      "platform/stores/runtime.ts",
      // A09's ingest guard DECORATES RuntimeStore.recordEvents to validate what
      // passes through it; it emits nothing itself. A09's own six names are all
      // literals in platform/quality/events.ts, which this scan reads and
      // checks like any other caller.
      "platform/quality/ingest.ts",
    ];
    const callers = emitters
      .map((f) => f.replace(/\\/g, "/"))
      .filter((f) => !mechanism.some((m) => f.endsWith(m)));
    for (const file of callers) {
      const content = readFileSync(file, "utf-8");
      const hasLiteral = EMIT_PATTERNS.some((p) => {
        p.lastIndex = 0;
        return p.test(content);
      });
      const hasTemplate = /event_name:\s*`/.test(content);
      expect(
        hasLiteral || hasTemplate,
        `${file} emits but the reconciliation scan found no name in it — extend EMIT_PATTERNS`
      ).toBe(true);
    }
  });
});
