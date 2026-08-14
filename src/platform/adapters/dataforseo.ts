import type { SeoMetricSnapshot, SerpSnapshot } from "@/domain/search/contracts";
import type { GeographyScope } from "@/domain/shared/primitives";
import type {
  DiscoverIdeasResult,
  IntentClassification,
  SearchIntentResult,
  SeoDataAdapter,
  TrendSeries,
} from "@/platform/adapters/seo-data";

/**
 * DataForSEO implementation of SeoDataAdapter (#23 §1.1: PRIMARY external
 * discovery source; API-first, pay-as-you-go, Basic auth).
 *
 * SERVER-SIDE ONLY. Credentials come from DATAFORSEO_LOGIN /
 * DATAFORSEO_PASSWORD environment secrets and must never reach browser code,
 * logs, PageSpecs, or admin UI. No file outside this adapter may know
 * DataForSEO field names or endpoints.
 *
 * Endpoint paths are best-effort against the v3 API as documented and MUST be
 * confirmed by the live smoke test once the owner funds the account
 * (gate item, Door Wave 1). Costs are read from the API's own cost fields.
 *
 * The API reports failures at TWO levels: HTTP status AND per-task
 * status_code inside an HTTP 200 body. Both raise errors here — a silent
 * empty result is indistinguishable from "no demand exists" and would
 * poison recommendations (verification finding, Wave 1).
 */
const BASE_URL = "https://api.dataforseo.com/v3";
const US_LOCATION_CODE = 2840;
const TASK_OK = 20000;

type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

export interface DataForSeoConfig {
  login?: string;
  password?: string;
  fetchImpl?: FetchLike;
  nowIso?: () => string;
}

interface DfsTask {
  status_code?: number;
  status_message?: string;
  cost?: number;
  result?: Array<Record<string, unknown>> | null;
}

interface DfsResponse {
  status_code?: number;
  cost?: number;
  tasks?: DfsTask[];
}

function toBase64(input: string): string {
  if (typeof btoa === "function") return btoa(input);
  return Buffer.from(input).toString("base64");
}

function locationCode(geography: GeographyScope): number {
  if (geography.mode === "national" && geography.country === "US") return US_LOCATION_CODE;
  // State/county/city geo targeting arrives with the local-pages phase (Owner
  // Decision D-3/D-10 sequences national first). Failing loudly beats
  // silently querying the wrong market.
  throw new Error(
    `DataForSeoAdapter: geography mode "${geography.mode}" not yet mapped — trial runs national US first (D-3/D-10)`
  );
}

export class DataForSeoAdapter implements SeoDataAdapter {
  readonly vendor = "dataforseo";
  private readonly login: string;
  private readonly password: string;
  private readonly fetchImpl: FetchLike;
  private readonly nowIso: () => string;
  private callCounter = 0;

  constructor(config: DataForSeoConfig = {}) {
    const login = config.login ?? process.env.DATAFORSEO_LOGIN;
    const password = config.password ?? process.env.DATAFORSEO_PASSWORD;
    if (!login || !password) {
      throw new Error(
        "DataForSeoAdapter requires DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD in server environment secrets (never in code or chat). Owner action: fund the DataForSEO account and add credentials to .env.local."
      );
    }
    this.login = login;
    this.password = password;
    this.fetchImpl = config.fetchImpl ?? ((url, init) => fetch(url, init));
    this.nowIso = config.nowIso ?? (() => new Date().toISOString());
  }

  private async post(path: string, payload: unknown[]): Promise<DfsResponse> {
    const response = await this.fetchImpl(`${BASE_URL}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${toBase64(`${this.login}:${this.password}`)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(`DataForSEO ${path} failed: HTTP ${response.status}`);
    }
    const data = (await response.json()) as DfsResponse;
    if (!data.tasks || data.tasks.length === 0) {
      throw new Error(`DataForSEO ${path} returned no tasks — treat as a failed, retryable call`);
    }
    const failed = data.tasks.find((t) => t.status_code !== undefined && t.status_code !== TASK_OK);
    if (failed) {
      throw new Error(
        `DataForSEO ${path} task error ${failed.status_code}: ${failed.status_message ?? "unknown"}`
      );
    }
    return data;
  }

  /** Sum of per-task costs; falls back to top-level cost only when tasks carry none. */
  private responseCost(data: DfsResponse): number {
    const taskCosts = (data.tasks ?? []).map((t) => t.cost).filter((c): c is number => c !== undefined);
    if (taskCosts.length > 0) return taskCosts.reduce((a, b) => a + b, 0);
    return data.cost ?? 0;
  }

  private snapshotId(kind: string, keyword: string): string {
    this.callCounter += 1;
    const stamp = this.nowIso().replace(/[-:.TZ]/g, "");
    const slug = keyword.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40);
    return `dfs_${kind}_${slug}_${stamp}_${this.callCounter}`;
  }

  async discoverIdeas(seeds: string[], geography: GeographyScope): Promise<DiscoverIdeasResult> {
    const data = await this.post("/dataforseo_labs/google/keyword_ideas/live", [
      { keywords: seeds, location_code: locationCode(geography), limit: 200 },
    ]);
    const ideas: DiscoverIdeasResult["ideas"] = [];
    for (const task of data.tasks ?? []) {
      for (const result of task.result ?? []) {
        const items = (result.items as Array<Record<string, unknown>> | undefined) ?? [];
        for (const item of items) {
          const keyword = item.keyword;
          if (typeof keyword === "string" && keyword.length > 0) {
            ideas.push({ keyword: keyword.toLowerCase(), source_seed: seeds[0] ?? null });
          }
        }
      }
    }
    return { ideas, vendor_cost_usd: this.responseCost(data) };
  }

  async getKeywordMetrics(
    keywords: string[],
    geography: GeographyScope
  ): Promise<SeoMetricSnapshot[]> {
    const loc = locationCode(geography);
    const [volumes, difficulties] = await Promise.all([
      this.post("/keywords_data/google_ads/search_volume/live", [
        { keywords, location_code: loc },
      ]),
      this.post("/dataforseo_labs/google/bulk_keyword_difficulty/live", [
        { keywords, location_code: loc },
      ]),
    ]);

    const volumeByKeyword = new Map<string, Record<string, unknown>>();
    for (const task of volumes.tasks ?? []) {
      for (const result of task.result ?? []) {
        const kw = result.keyword;
        if (typeof kw === "string") volumeByKeyword.set(kw.toLowerCase(), result);
      }
    }
    const kdByKeyword = new Map<string, number>();
    for (const task of difficulties.tasks ?? []) {
      for (const result of task.result ?? []) {
        const items = (result.items as Array<Record<string, unknown>> | undefined) ?? [];
        for (const item of items) {
          const kw = item.keyword;
          const kd = item.keyword_difficulty;
          if (typeof kw === "string" && typeof kd === "number") {
            kdByKeyword.set(kw.toLowerCase(), kd);
          }
        }
      }
    }

    const perCallCost = this.responseCost(volumes) + this.responseCost(difficulties);
    const costPerKeyword = keywords.length > 0 ? perCallCost / keywords.length : 0;
    const queriedAt = this.nowIso();

    return keywords.map((keyword) => {
      const vol = volumeByKeyword.get(keyword.toLowerCase());
      const volume = vol && typeof vol.search_volume === "number" ? vol.search_volume : null;
      const cpc = vol && typeof vol.cpc === "number" ? vol.cpc : null;
      const competition = vol && typeof vol.competition === "number" ? vol.competition : null;
      const trend =
        vol && Array.isArray(vol.monthly_searches)
          ? (vol.monthly_searches as Array<Record<string, unknown>>).map((m) =>
              typeof m.search_volume === "number" ? m.search_volume : 0
            )
          : null;
      return {
        metric_snapshot_id: this.snapshotId("metric", keyword),
        schema_version: "1.0.0",
        keyword: keyword.toLowerCase(),
        vendor: this.vendor,
        geography,
        queried_at: queriedAt,
        volume_monthly: volume,
        keyword_difficulty: kdByKeyword.get(keyword.toLowerCase()) ?? null,
        cpc_usd: cpc,
        competition,
        trend_12mo: trend,
        raw_vendor_ref: null,
        vendor_cost_usd: Math.round(costPerKeyword * 1e6) / 1e6,
        rate_version: null,
      } satisfies SeoMetricSnapshot;
    });
  }

  async getSearchIntent(keywords: string[]): Promise<SearchIntentResult> {
    const data = await this.post("/dataforseo_labs/google/search_intent/live", [
      { keywords, language_code: "en" },
    ]);
    const byKeyword = new Map<string, string>();
    for (const task of data.tasks ?? []) {
      for (const result of task.result ?? []) {
        const items = (result.items as Array<Record<string, unknown>> | undefined) ?? [];
        for (const item of items) {
          const kw = item.keyword;
          const intent = (item.keyword_intent as Record<string, unknown> | undefined)?.label;
          if (typeof kw === "string" && typeof intent === "string") {
            byKeyword.set(kw.toLowerCase(), intent);
          }
        }
      }
    }
    const classifications: IntentClassification[] = keywords.map((keyword) => {
      const vendorLabel = byKeyword.get(keyword.toLowerCase()) ?? null;
      // Vendor labels only cover informational/commercial/navigational/
      // transactional. Home-PROBLEM detection is PRN-side (intent-classifier)
      // and is overlaid by the discovery pipeline, not here.
      const intent_type: IntentClassification["intent_type"] =
        vendorLabel === "commercial" || vendorLabel === "transactional"
          ? "commercial"
          : vendorLabel === "informational"
            ? "informational"
            : "unknown";
      return { keyword: keyword.toLowerCase(), intent_type, confidence: vendorLabel ? "medium" : "low" };
    });
    return { classifications, vendor_cost_usd: this.responseCost(data) };
  }

  async getSerpSnapshot(keyword: string, geography: GeographyScope): Promise<SerpSnapshot> {
    const data = await this.post("/serp/google/organic/live/advanced", [
      { keyword, location_code: locationCode(geography), depth: 10 },
    ]);
    const results: SerpSnapshot["results"] = [];
    for (const task of data.tasks ?? []) {
      for (const result of task.result ?? []) {
        const items = (result.items as Array<Record<string, unknown>> | undefined) ?? [];
        for (const item of items) {
          if (item.type !== "organic") continue;
          const position = item.rank_absolute;
          const url = item.url;
          if (typeof position === "number" && typeof url === "string") {
            results.push({
              position,
              url,
              title: typeof item.title === "string" ? item.title : null,
              domain: typeof item.domain === "string" ? item.domain : null,
              page_type: null,
              domain_rating: null,
            });
          }
        }
      }
    }
    return {
      serp_snapshot_id: this.snapshotId("serp", keyword),
      schema_version: "1.0.0",
      keyword: keyword.toLowerCase(),
      geography,
      queried_at: this.nowIso(),
      results,
      weakness_note: null,
      vendor_cost_usd: this.responseCost(data),
    };
  }

  async getTrend(keywords: string[], geography: GeographyScope): Promise<TrendSeries[]> {
    const data = await this.post("/keywords_data/google_trends/explore/live", [
      { keywords, location_code: locationCode(geography) },
    ]);
    // google_trends explore returns one combined graph: each data entry has a
    // values[] array aligned to the requested keywords, in request order.
    const series: TrendSeries[] = keywords.map((k) => ({ keyword: k.toLowerCase(), monthly: [] }));
    for (const task of data.tasks ?? []) {
      for (const result of task.result ?? []) {
        const items = (result.items as Array<Record<string, unknown>> | undefined) ?? [];
        for (const item of items) {
          const entries = item.data;
          if (!Array.isArray(entries)) continue;
          for (const entry of entries as Array<Record<string, unknown>>) {
            const values = entry.values;
            if (!Array.isArray(values)) continue;
            values.forEach((value, i) => {
              if (typeof value === "number" && Number.isFinite(value) && series[i]) {
                series[i].monthly.push(value);
              }
            });
          }
        }
      }
    }
    return series;
  }
}
