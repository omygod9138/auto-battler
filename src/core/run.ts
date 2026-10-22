import { Battle } from "./battle";
import { mobForRound, type MobDef } from "./mobs";
import { Rng, hashSeed } from "./rng";
import { MAX_LEVEL, SKILLS, heroStats, type SkillCat, type SkillId, type SkillLevels } from "./skills";
import { CLASSES, type ClassId, type Stats } from "./stats";

export const OFFER_SIZE = 3;
export const REROLLS_PER_RUN = 3;

export type Phase = "choose" | "battle" | "over";

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
}

export function newRun(seed: number, cls: ClassId): RunState {
  const s: RunState = { seed, cls, round: 1, levels: {}, offers: [], rerollsLeft: REROLLS_PER_RUN, rerollCount: 0, phase: "choose" };
  s.offers = rollOffers(s);
  return s;
}

/** Skills this class may still pick: its own plus shared ones, below max level. */
export function skillPool(s: RunState): SkillId[] {
  return (Object.keys(SKILLS) as SkillId[]).filter(
    (id) => (SKILLS[id].cls === s.cls || SKILLS[id].cls === "any") && (s.levels[id] ?? 0) < MAX_LEVEL,
  );
}

/** One card per slot: a class Attack skill, a class Defense skill, and a Passive (class passives or shared skills). */
function rollOffers(s: RunState): SkillId[] {
  const rng = new Rng(hashSeed(s.seed, "offer", s.round, s.rerollCount));
  const pool = skillPool(s);
  const own = (cat: SkillCat) => pool.filter((id) => SKILLS[id].cls === s.cls && SKILLS[id].cat === cat);
  const slots = [own("attack"), own("defense"), [...own("passive"), ...pool.filter((id) => SKILLS[id].cls === "any")]];
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
  return heroStats(CLASSES[s.cls].base, s.levels);
}

export function currentMob(s: RunState): { def: MobDef; stats: Stats } {
  return mobForRound(s.round);
}

export function startBattle(s: RunState): Battle {
  const mob = currentMob(s);
  return new Battle(currentStats(s), s.levels, mob.stats, hashSeed(s.seed, "battle", s.round), mob.def.enrage);
}

export function finishBattle(s: RunState, won: boolean): void {
  if (s.phase !== "battle") return;
  if (!won) {
    s.phase = "over";
    return;
  }
  s.round++;
  s.phase = "choose";
  s.offers = rollOffers(s);
}
