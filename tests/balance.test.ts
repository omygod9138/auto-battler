import { expect, it } from "vitest";
import { chooseSkill, finishBattle, newRun, startBattle } from "../src/core/run";
import { Rng } from "../src/core/rng";
import type { ClassId } from "../src/core/stats";

/** A player who picks a random offered skill each round. Returns rounds won. */
export function randomRun(cls: ClassId, seed: number, cap = 40): number {
  const s = newRun(seed, cls);
  const rng = new Rng(seed);
  while (s.phase !== "over" && s.round <= cap) {
    chooseSkill(s, rng.pick(s.offers));
    finishBattle(s, startBattle(s).runToEnd() === "win");
  }
  return s.round - 1;
}

// Guards balance: random picks should get a few wins but not run forever, for every class.
it.each(["warrior", "ranger", "mage"] as ClassId[])("%s: random-pick runs last a reasonable number of rounds", (cls) => {
  const wins = Array.from({ length: 40 }, (_, i) => randomRun(cls, 1000 + i));
  const avg = wins.reduce((a, b) => a + b, 0) / wins.length;
  console.log(cls, "avg wins", avg.toFixed(1), "min", Math.min(...wins), "max", Math.max(...wins));
  expect(avg).toBeGreaterThanOrEqual(5);
  expect(avg).toBeLessThanOrEqual(20);
});
