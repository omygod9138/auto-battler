import { pathsOf } from "../src/core/ascension";
import { hashSeed } from "../src/core/rng";
import { ascend, battleAt, chooseSkill, finishBattle, newRun, startBattle, type RunState } from "../src/core/run";
import type { SkillId } from "../src/core/skills";
import type { ClassId, PathId } from "../src/core/stats";

/** Rounds a pick is tried against before the smart bot takes it. */
const LOOKAHEAD = 4;

/** How well a build does over the next few rounds: wins count with HP left, losses with how close they came. */
export function buildScore(s: RunState, levels: RunState["levels"]): number {
  const trial = { ...s, levels };
  let score = 0;
  for (let r = s.round; r < s.round + LOOKAHEAD; r++) {
    const b = battleAt(trial, r, hashSeed(s.seed, "look", r));
    score += b.runToEnd() === "win" ? 1 + b.hero.hp / b.hero.s.maxHp : -b.mob.hp / b.mob.s.maxHp;
  }
  return score;
}

export interface RunResult {
  wins: number;
  /** The levels held when the run cleared the ascension round, if it did. */
  ascendedAt?: RunState;
  /** Skill levels at the end of the run. */
  levels: RunState["levels"];
}

/** A player who tries each offered skill against the next few fights and keeps the best; ascends into `path` (default: the first). */
export function smartRun(cls: ClassId, seed: number, cap = 80, path?: PathId): RunResult {
  const s = newRun(seed, cls);
  let ascendedAt: RunState | undefined;
  while (s.phase !== "over" && s.round <= cap) {
    if (s.phase === "ascend") {
      ascendedAt = structuredClone(s);
      ascend(s, path ?? pathsOf(cls)[0].id);
    }
    if (!s.offers.length) break;
    const pick = (id: SkillId) => buildScore(s, { ...s.levels, [id]: (s.levels[id] ?? 0) + 1 });
    const best = s.offers.map((id) => [id, pick(id)] as const).sort((a, b) => b[1] - a[1])[0][0];
    chooseSkill(s, best);
    finishBattle(s, startBattle(s).runToEnd() === "win");
  }
  return { wins: s.round - 1, ascendedAt, levels: s.levels };
}
