import { createClient } from "@supabase/supabase-js";
import { SeoFactoryPolicy, TRIAL_DEFAULT_SEO_FACTORY_POLICY } from "@/domain/search/policy";
import type { PolicyStore } from "@/platform/stores/interfaces";

/**
 * Database-backed page-creator policy. Every save is a new immutable version
 * row (configuration over code, versioned and auditable — #17). The active
 * policy is the highest version; nothing is ever overwritten in place.
 * Validation runs on save, so a policy that breaks a trial invariant (owner
 * publish approval, target vs cap, geography rules) can never be persisted.
 */
export class SupabasePolicyStore implements PolicyStore {
  private db = createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

  constructor(private readonly fallback: SeoFactoryPolicy = TRIAL_DEFAULT_SEO_FACTORY_POLICY) {}

  async getActive(): Promise<SeoFactoryPolicy> {
    const { data, error } = await this.db
      .from("seo_factory_policy")
      .select("policy")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw new Error(`load policy: ${error.message}`);
    if (!data) return this.fallback;
    return SeoFactoryPolicy.parse(data.policy);
  }

  async save(policy: SeoFactoryPolicy): Promise<void> {
    const valid = SeoFactoryPolicy.parse(policy);
    const { error } = await this.db.from("seo_factory_policy").insert({
      policy_id: valid.policy_id,
      version: valid.version,
      policy: valid,
      effective_from: valid.effective_from,
    });
    if (error) throw new Error(`save policy: ${error.message}`);
  }
}
