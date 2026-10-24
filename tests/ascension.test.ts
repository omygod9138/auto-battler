import { describe, expect, it } from "vitest";
import { ASCEND_ROUND, pathsOf } from "../src/core/ascension";
import { hashSeed } from "../src/core/rng";
import { ascend, battleAt } from "../src/core/run";
import type { ClassId } from "../src/core/stats";
import { smartRun } from "./bots";

const RUNS = 40;
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

// Guardrails for ascension, played by the smart bot (it tries each offer against the next few fights).
describe.each(["warrior", "ranger", "mage"] as ClassId[])("%s", (cls) => {
  const runs = Array.from({ length: RUNS }, (_, i) => smartRun(cls, 1000 + i));
  const cleared = runs.filter((r) => r.wins >= ASCEND_ROUND);
  console.log(cls, "smart avg", avg(runs.map((r) => r.wins)).toFixed(1), "cleared R20", `${cleared.length}/${RUNS}`,
    "after", avg(cleared.map((r) => r.wins)).toFixed(1), JSON.stringify(cleared.map((r) => r.wins).sort((a, b) => a - b)));

  it("a good player clears round 20 in 25–70% of runs", () => {
    expect(cleared.length / RUNS).toBeGreaterThanOrEqual(0.25);
    expect(cleared.length / RUNS).toBeLessThanOrEqual(0.7);
  });

  it.runIf(pathsOf(cls).length)("ascended runs average 30–40 wins", () => {
    expect(avg(cleared.map((r) => r.wins))).toBeGreaterThanOrEqual(30);
    expect(avg(cleared.map((r) => r.wins))).toBeLessThanOrEqual(40);
  });

  it.runIf(pathsOf(cls).length)("ascending makes the same build kill rounds 21–25 at least 30% faster", () => {
    const ratios: number[] = [];
    for (const r of cleared) {
      const before = r.ascendedAt!;
      const after = structuredClone(before);
      ascend(after, pathsOf(cls)[0].id);
      for (let round = ASCEND_ROUND + 1; round <= ASCEND_ROUND + 5; round++) {
        const seed = hashSeed(before.seed, "guard", round);
        const a = battleAt(before, round, seed);
        const b = battleAt(after, round, seed);
        // A fight lost or timed out counts as the full minute.
        const time = (x: typeof a) => (x.runToEnd() === "win" ? x.time : 60);
        ratios.push(time(b) / time(a));
      }
    }
    console.log(cls, "ascended kill time ×", avg(ratios).toFixed(2));
    expect(avg(ratios)).toBeLessThanOrEqual(0.7);
  });
});
