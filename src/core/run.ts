import { ASCEND_ROUND, ascendStats, pathsOf } from "./ascension";
import { Battle } from "./battle";
import { mobForRound, type MobDef } from "./mobs";
import { Rng, hashSeed } from "./rng";
import { MAX_LEVEL, SKILLS, heroStats, type SkillCat, type SkillId, type SkillLevels } from "./skills";
import { CLASSES, type ClassId, type PathId, type Stats } from "./stats";

export const OFFER_SIZE = 3;
export const REROLLS_PER_RUN = 3;

/** "ascend": the round-20 boss is beaten and the player picks a path before the next skill. */
export type Phase = "choose" | "battle" | "ascend" | "over";

export interface RunState {
  seed: number;
  cls: ClassId;
  /** The round about to be fought (1-based). Wins so far = round - 1. */
  round: number;
  levels: SkillLevels;
  offers: SkillId[];
  rerollsLeft: number;
  rerollCount: number;
  phase: Phase;
  /** The ascended path, once chosen. */
  path: PathId | null;
}

export function newRun(seed: number, cls: ClassId): RunState {
  const s: RunState = { seed, cls, round: 1, levels: {}, offers: [], rerollsLeft: REROLLS_PER_RUN, rerollCount: 0, phase: "choose", path: null };
  s.offers = rollOffers(s);
  return s;
}

/** Skills this class may still pick, below max level: shared ones, plus its own. Path skills come with
 * ascension, and then the class's unlearned skills leave the pool; learned ones can still level. */
export function skillPool(s: RunState): SkillId[] {
  return (Object.keys(SKILLS) as SkillId[]).filter((id) => {
    const def = SKILLS[id];
    if ((s.levels[id] ?? 0) >= MAX_LEVEL) return false;
    if (def.cls === "any") return true;
    if (def.cls !== s.cls) return false;
    if (def.path) return def.path === s.path;
    return !s.path || (s.levels[id] ?? 0) > 0;
  });
}

/** One card per slot: a class Attack skill, a class Defense skill, and a Passive (class passives or shared skills). */
function rollOffers(s: RunState): SkillId[] {
  const rng = new Rng(hashSeed(s.seed, "offer", s.round, s.rerollCount));
  const pool = skillPool(s);
  const own = (cat: SkillCat) => pool.filter((id) => SKILLS[id].cls === s.cls && SKILLS[id].cat === cat);
  // Once ascended, the attack card is a new path skill until every one is learned.
  const fresh = own("attack").filter((id) => SKILLS[id].path && !s.levels[id]);
  const slots = [fresh.length ? fresh : own("attack"), own("defense"), [...own("passive"), ...pool.filter((id) => SKILLS[id].cls === "any")]];
  const picks: SkillId[] = [];
  for (const slot of slots) {
    const left = slot.filter((id) => !picks.includes(id));
    if (left.length) picks.push(rng.pick(left));
  }
  // A slot whose skills are all maxed is filled from whatever else is left.
  const rest = pool.filter((id) => !picks.includes(id));
  return [...picks, ...rng.sample(rest, Math.min(rest.length, OFFER_SIZE - picks.length))];
}

export function reroll(s: RunState): void {
  if (s.phase !== "choose" || s.rerollsLeft <= 0) return;
  s.rerollsLeft--;
  s.rerollCount++;
  s.offers = rollOffers(s);
}

export function chooseSkill(s: RunState, id: SkillId): void {
  if (s.phase !== "choose" || !s.offers.includes(id)) return;
  s.levels[id] = (s.levels[id] ?? 0) + 1;
  s.offers = [];
  s.phase = "battle";
}

export function currentStats(s: RunState): Stats {
  const st = heroStats(CLASSES[s.cls].base, s.levels);
  return s.path ? ascendStats(st) : st;
}

export function currentMob(s: RunState): { def: MobDef; stats: Stats } {
  return mobForRound(s.round);
}

export function startBattle(s: RunState): Battle {
  return battleAt(s, s.round, hashSeed(s.seed, "battle", s.round));
}

/** The fight this run's hero would have against a round's mob, for the real fight or a look ahead. */
export function battleAt(s: RunState, round: number, seed: number): Battle {
  const mob = mobForRound(round);
  return new Battle(currentStats(s), s.levels, mob.stats, seed, mob.def.enrage, CLASSES[s.cls].start, s.path);
}

export function finishBattle(s: RunState, won: boolean): void {
  if (s.phase !== "battle") return;
  if (!won) {
    s.phase = "over";
    return;
  }
  s.round++;
  if (s.round - 1 === ASCEND_ROUND && !s.path && pathsOf(s.cls).length) {
    s.phase = "ascend";
    return;
  }
  s.phase = "choose";
  s.offers = rollOffers(s);
}

export function ascend(s: RunState, path: PathId): void {
  if (s.phase !== "ascend" || !pathsOf(s.cls).some((p) => p.id === path)) return;
  s.path = path;
  s.phase = "choose";
  s.offers = rollOffers(s);
}
