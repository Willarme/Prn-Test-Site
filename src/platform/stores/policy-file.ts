import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { SeoFactoryPolicy, TRIAL_DEFAULT_SEO_FACTORY_POLICY } from "@/domain/search/policy";
import type { PolicyStore } from "@/platform/stores/interfaces";

/**
 * File-backed policy store: configuration over code (#17 canon). The active
 * SeoFactoryPolicy lives in data/seo-factory-policy.json, versioned in git so
 * every change is auditable, and editable via `npm run policy` without a
 * deploy. Swapped for the Supabase-backed store (same interface) once the
 * owner selects the project.
 */
export class FilePolicyStore implements PolicyStore {
  constructor(private readonly filePath: string) {}

  /** On Vercel the repo file is read-only; runtime edits live in /tmp (ephemeral). */
  private overridePath(): string | null {
    return process.env.VERCEL ? "/tmp/prn-runtime/seo-factory-policy.json" : null;
  }

  async getActive(): Promise<SeoFactoryPolicy> {
    const candidates = [this.overridePath(), this.filePath].filter((p): p is string => p !== null);
    for (const path of candidates) {
      try {
        const raw = await readFile(path, "utf-8");
        return SeoFactoryPolicy.parse(JSON.parse(raw));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw err;
      }
    }
    return TRIAL_DEFAULT_SEO_FACTORY_POLICY;
  }

  async save(policy: SeoFactoryPolicy): Promise<void> {
    // Validation on save: an invalid policy (e.g. auto-publish before T2)
    // can never be persisted, no matter who edits the file.
    const valid = SeoFactoryPolicy.parse(policy);
    const target = this.overridePath() ?? this.filePath;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, JSON.stringify(valid, null, 2) + "\n", "utf-8");
  }
}
