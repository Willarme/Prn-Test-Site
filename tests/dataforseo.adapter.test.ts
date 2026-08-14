import { describe, expect, it } from "vitest";
import { SeoMetricSnapshot, SerpSnapshot } from "@/domain/search/contracts";
import { DataForSeoAdapter } from "@/platform/adapters/dataforseo";

type Call = { url: string; init: RequestInit };

function fakeFetch(routes: Record<string, unknown>, calls: Call[]) {
  return async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    for (const [path, body] of Object.entries(routes)) {
      if (url.includes(path)) {
        return new Response(JSON.stringify(body), { status: 200 });
      }
    }
    return new Response("{}", { status: 404 });
  };
}

const GEO = { mode: "national", country: "US" } as const;

// Real DFS responses carry BOTH a top-level cost and per-task costs (equal
// sums); fakes include both so double-counting would fail the assertions.
const VOLUME_ROUTE = {
  status_code: 20000,
  cost: 0.06,
  tasks: [
    {
      status_code: 20000,
      cost: 0.06,
      result: [
        { keyword: "ac not turning on", search_volume: 3300, cpc: 1.25, competition: 0.2 },
        { keyword: "ac blowing warm air", search_volume: 1700, cpc: null, competition: null },
      ],
    },
  ],
};

const KD_ROUTE = {
  status_code: 20000,
  cost: 0.01,
  tasks: [
    {
      status_code: 20000,
      cost: 0.01,
      result: [
        {
          items: [
            { keyword: "ac not turning on", keyword_difficulty: 3 },
            { keyword: "ac blowing warm air", keyword_difficulty: 0 },
          ],
        },
      ],
    },
  ],
};

describe("DataForSeoAdapter", () => {
  it("refuses to construct without credentials, naming the env vars", () => {
    expect(
      () =>
        new DataForSeoAdapter({
          login: undefined,
          password: undefined,
          fetchImpl: async () => new Response("{}"),
        })
    ).toThrow(/DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD/);
  });

  it("sends Basic auth built from injected credentials", async () => {
    const calls: Call[] = [];
    const adapter = new DataForSeoAdapter({
      login: "user@example.com",
      password: "secret",
      fetchImpl: fakeFetch({ search_volume: VOLUME_ROUTE, bulk_keyword_difficulty: KD_ROUTE }, calls),
      nowIso: () => "2026-08-14T12:00:00Z",
    });
    await adapter.getKeywordMetrics(["ac not turning on"], GEO);
    const auth = (calls[0].init.headers as Record<string, string>).Authorization;
    expect(auth).toBe(`Basic ${Buffer.from("user@example.com:secret").toString("base64")}`);
  });

  it("maps vendor volume + KD responses into vendor-neutral snapshots with correct summed cost", async () => {
    const adapter = new DataForSeoAdapter({
      login: "u",
      password: "p",
      nowIso: () => "2026-08-14T12:00:00Z",
      fetchImpl: fakeFetch({ search_volume: VOLUME_ROUTE, bulk_keyword_difficulty: KD_ROUTE }, []),
    });
    const snapshots = await adapter.getKeywordMetrics(
      ["ac not turning on", "ac blowing warm air"],
      GEO
    );
    expect(snapshots.length).toBe(2);
    for (const snap of snapshots) {
      expect(SeoMetricSnapshot.safeParse(snap).success).toBe(true);
      expect(snap.vendor).toBe("dataforseo");
    }
    const first = snapshots.find((s) => s.keyword === "ac not turning on")!;
    expect(first.volume_monthly).toBe(3300);
    expect(first.keyword_difficulty).toBe(3);
    expect(first.cpc_usd).toBe(1.25);
    const second = snapshots.find((s) => s.keyword === "ac blowing warm air")!;
    expect(second.keyword_difficulty).toBe(0); // vendor KD 0 survives mapping
    const totalCost = snapshots.reduce((sum, s) => sum + (s.vendor_cost_usd ?? 0), 0);
    expect(totalCost).toBeCloseTo(0.07, 5); // task costs summed once, no top-level double count
  });

  it("mints unique snapshot ids across repeated same-day calls", async () => {
    const adapter = new DataForSeoAdapter({
      login: "u",
      password: "p",
      nowIso: () => "2026-08-14T12:00:00Z",
      fetchImpl: fakeFetch({ search_volume: VOLUME_ROUTE, bulk_keyword_difficulty: KD_ROUTE }, []),
    });
    const runA = await adapter.getKeywordMetrics(["ac not turning on"], GEO);
    const runB = await adapter.getKeywordMetrics(["ac blowing warm air"], GEO);
    expect(runA[0].metric_snapshot_id).not.toBe(runB[0].metric_snapshot_id);
  });

  it("raises on DataForSEO task-level errors hidden inside HTTP 200 (silent-empty poisoning guard)", async () => {
    const adapter = new DataForSeoAdapter({
      login: "u",
      password: "p",
      fetchImpl: fakeFetch(
        {
          keyword_ideas: {
            status_code: 20000,
            tasks: [{ status_code: 40501, status_message: "Invalid Field.", result: null }],
          },
        },
        []
      ),
    });
    await expect(adapter.discoverIdeas(["hvac"], GEO)).rejects.toThrow(/task error 40501/);
  });

  it("raises when a response carries no tasks at all", async () => {
    const adapter = new DataForSeoAdapter({
      login: "u",
      password: "p",
      fetchImpl: fakeFetch({ keyword_ideas: { status_code: 20000, tasks: [] } }, []),
    });
    await expect(adapter.discoverIdeas(["hvac"], GEO)).rejects.toThrow(/no tasks/);
  });

  it("extracts keyword ideas with cost envelope", async () => {
    const adapter = new DataForSeoAdapter({
      login: "u",
      password: "p",
      fetchImpl: fakeFetch(
        {
          keyword_ideas: {
            status_code: 20000,
            cost: 0.012,
            tasks: [
              {
                status_code: 20000,
                cost: 0.012,
                result: [
                  {
                    items: [
                      { keyword: "AC Not Turning On" },
                      { keyword: "furnace blowing cold air" },
                    ],
                  },
                ],
              },
            ],
          },
        },
        []
      ),
    });
    const result = await adapter.discoverIdeas(["hvac"], GEO);
    expect(result.ideas.map((i) => i.keyword)).toEqual([
      "ac not turning on", // lowercased
      "furnace blowing cold air",
    ]);
    expect(result.vendor_cost_usd).toBeCloseTo(0.012, 6);
  });

  it("maps SERP results into the domain SerpSnapshot, excluding paid items", async () => {
    const adapter = new DataForSeoAdapter({
      login: "u",
      password: "p",
      nowIso: () => "2026-08-14T12:00:00Z",
      fetchImpl: fakeFetch(
        {
          "serp/google/organic": {
            status_code: 20000,
            tasks: [
              {
                status_code: 20000,
                cost: 0.002,
                result: [
                  {
                    items: [
                      { type: "organic", rank_absolute: 1, url: "https://a.com/x", title: "A", domain: "a.com" },
                      { type: "paid", rank_absolute: 0, url: "https://ad.com" },
                      { type: "organic", rank_absolute: 2, url: "https://b.com/y", title: null, domain: "b.com" },
                    ],
                  },
                ],
              },
            ],
          },
        },
        []
      ),
    });
    const serp = await adapter.getSerpSnapshot("ac not turning on", GEO);
    expect(SerpSnapshot.safeParse(serp).success).toBe(true);
    expect(serp.results.length).toBe(2);
    expect(serp.vendor_cost_usd).toBeCloseTo(0.002, 6);
  });

  it("aligns google_trends values to keywords by request order (verification fix)", async () => {
    const adapter = new DataForSeoAdapter({
      login: "u",
      password: "p",
      fetchImpl: fakeFetch(
        {
          google_trends: {
            status_code: 20000,
            tasks: [
              {
                status_code: 20000,
                result: [
                  {
                    items: [
                      {
                        data: [
                          { date_from: "2026-06-01", values: [57, 30] },
                          { date_from: "2026-07-01", values: [63, 41] },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        },
        []
      ),
    });
    const series = await adapter.getTrend(["keyword a", "keyword b"], GEO);
    expect(series.find((s) => s.keyword === "keyword a")!.monthly).toEqual([57, 63]);
    expect(series.find((s) => s.keyword === "keyword b")!.monthly).toEqual([30, 41]);
  });

  it("refuses unmapped geography modes instead of querying the wrong market (D-3/D-10)", async () => {
    const adapter = new DataForSeoAdapter({
      login: "u",
      password: "p",
      fetchImpl: async () => new Response("{}"),
    });
    await expect(
      adapter.getKeywordMetrics(["x"], { mode: "state", country: "US", states: ["IN"] })
    ).rejects.toThrow(/not yet mapped/);
  });

  it("surfaces HTTP failures as errors", async () => {
    const adapter = new DataForSeoAdapter({
      login: "u",
      password: "p",
      fetchImpl: async () => new Response("busy", { status: 503 }),
    });
    await expect(adapter.getKeywordMetrics(["x"], GEO)).rejects.toThrow(/HTTP 503/);
  });
});
