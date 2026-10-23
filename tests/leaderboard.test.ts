import { describe, expect, it } from "vitest";
import { FallbackLeaderboard, apiBase, LocalLeaderboard, SupabaseLeaderboard, TOP_N, cleanName, type ScoreEntry } from "../src/core/leaderboard";

function memStore() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}
const run = (wins: number, at: number, cls: ScoreEntry["cls"] = "warrior"): ScoreEntry => ({
  name: `p${at}`, cls, wins, killedBy: "Wolf", skills: [], at,
});

describe("leaderboard", () => {
  it("ranks by wins, earlier run wins ties", async () => {
    const lb = new LocalLeaderboard(memStore());
    expect((await lb.submit(run(3, 1))).rank).toBe(1);
    expect((await lb.submit(run(5, 2))).rank).toBe(1);
    expect((await lb.submit(run(3, 3))).rank).toBe(3);
    expect((await lb.top()).map((e) => e.at)).toEqual([2, 1, 3]);
  });

  it("keeps a top 10 per class and reports runs that don't place", async () => {
    const lb = new LocalLeaderboard(memStore());
    for (let i = 0; i < TOP_N; i++) await lb.submit(run(10 + i, i));
    expect((await lb.submit(run(1, 99))).rank).toBeNull();
    expect((await lb.submit(run(1, 100, "mage"), "mage")).rank).toBe(1);
    expect(await lb.top("warrior")).toHaveLength(TOP_N);
    expect((await lb.top()).every((e) => e.cls === "warrior")).toBe(true);
    expect((await lb.top("mage"))[0].at).toBe(100);
  });

  it("survives junk storage and cleans names", async () => {
    const store = memStore();
    store.setItem("fjord-leaderboard-v1", "{bad");
    const lb = new LocalLeaderboard(store);
    expect(await lb.top()).toEqual([]);
    expect(cleanName("   ")).toBe("Hero");
    expect(cleanName("  a   very long name indeed  ")).toBe("a very long name");
  });
});

describe("supabase leaderboard", () => {
  const rows: Record<string, unknown>[] = [];
  const calls: string[] = [];
  // Minimal stand-in for PostgREST: insert, then ordered select with optional cls filter.
  const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
    if (init?.method === "POST") {
      const row = { id: rows.length + 1, created_at: new Date(1000 + rows.length).toISOString(), ...JSON.parse(String(init.body)) };
      rows.push(row);
      return new Response(JSON.stringify([row]), { status: 201 });
    }
    const cls = url.searchParams.get("cls")?.slice(3);
    const out = rows
      .filter((r) => !cls || r.cls === cls)
      .sort((a, b) => (b.wins as number) - (a.wins as number) || (a.id as number) - (b.id as number))
      .slice(0, Number(url.searchParams.get("limit")));
    return new Response(JSON.stringify(out), { status: 200 });
  }) as typeof fetch;

  it("submits a run and reports its rank from the server's order", async () => {
    const lb = new SupabaseLeaderboard("https://x.supabase.co/", "key", fakeFetch);
    await lb.submit(run(7, 0));
    const { saved, rank } = await lb.submit({ ...run(9, 0), name: "  勇者  " }, "warrior");
    expect(rank).toBe(1);
    expect(saved.name).toBe("勇者");
    expect(saved.at).toBe(1001);
    expect((await lb.top()).map((e) => e.wins)).toEqual([9, 7]);
    expect(calls).toContain("GET /rest/v1/scores?select=*&order=wins.desc%2Ccreated_at.asc&limit=10&cls=eq.warrior");
  });

  it("accepts the project URL with a path or without a scheme", () => {
    expect(apiBase("https://abc.supabase.co/rest/v1/")).toBe("https://abc.supabase.co");
    expect(apiBase(" abc.supabase.co ")).toBe("https://abc.supabase.co");
    expect(apiBase("https://abc.supabase.co")).toBe("https://abc.supabase.co");
  });

  it("falls back to this device when the server fails", async () => {
    const down = new SupabaseLeaderboard("https://x.supabase.co", "key", (async () => new Response("nope", { status: 500 })) as typeof fetch);
    const lb = new FallbackLeaderboard(down, new LocalLeaderboard(memStore()));
    expect(lb.scope).toBe("global");
    const warn = console.warn;
    console.warn = () => {};
    expect((await lb.submit(run(4, 1))).rank).toBe(1);
    console.warn = warn;
    expect(lb.scope).toBe("device");
  });
});
