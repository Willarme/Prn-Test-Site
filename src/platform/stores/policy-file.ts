import { readFile, writeFile } from "node:fs/promises";
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

  async getActive(): Promise<SeoFactoryPolicy> {
    try {
      const raw = await readFile(this.filePath, "utf-8");
      return SeoFactoryPolicy.parse(JSON.parse(raw));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return TRIAL_DEFAULT_SEO_FACTORY_POLICY;
      }
      throw err;
    }
  }

  async save(policy: SeoFactoryPolicy): Promise<void> {
    // Validation on save: an invalid policy (e.g. auto-publish before T2)
    // can never be persisted, no matter who edits the file.
    const valid = SeoFactoryPolicy.parse(policy);
    await writeFile(this.filePath, JSON.stringify(valid, null, 2) + "\n", "utf-8");
  }
}
