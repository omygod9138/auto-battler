import { describe, expect, it } from "vitest";
import { LocalLeaderboard, TOP_N, cleanName, type ScoreEntry } from "../src/core/leaderboard";

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
    expect(await lb.submit(run(3, 1))).toBe(1);
    expect(await lb.submit(run(5, 2))).toBe(1);
    expect(await lb.submit(run(3, 3))).toBe(3);
    expect((await lb.top()).map((e) => e.at)).toEqual([2, 1, 3]);
  });

  it("keeps a top 10 per class and reports runs that don't place", async () => {
    const lb = new LocalLeaderboard(memStore());
    for (let i = 0; i < TOP_N; i++) await lb.submit(run(10 + i, i));
    expect(await lb.submit(run(1, 99))).toBeNull();
    expect(await lb.submit(run(1, 100, "mage"), "mage")).toBe(1);
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
