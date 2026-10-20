import { expect, it } from "vitest";
import { botOpponent, lossDamage, neutralOpponent } from "../src/core/game";
import { Battle } from "../src/core/combat";
import { RULES } from "../src/core/data";

// A bot-skill "player" against bot rivals should usually survive a while:
// guards against balance changes that make runs end in a few rounds.
it("an average player survives several rounds", () => {
  const lengths: number[] = [];
  for (let seed = 100; seed < 112; seed++) {
    let hp = RULES.startHp;
    let round = 1;
    for (; round <= RULES.finalRound && hp > 0; round++) {
      const me = botOpponent(seed, round).units;
      const foe = round <= RULES.neutralRounds ? neutralOpponent(round) : botOpponent(seed * 7 + 1, round);
      const b = new Battle(me, foe.units);
      if (b.runToEnd() === "loss") hp -= lossDamage(round, b.survivingThreat("enemy"));
    }
    lengths.push(hp > 0 ? RULES.finalRound + 1 : round - 1);
  }
  const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  console.log("run lengths", lengths.join(","), "avg", avg.toFixed(1));
  expect(avg).toBeGreaterThanOrEqual(7);
});
