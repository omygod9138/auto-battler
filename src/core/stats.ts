export type ClassId = "warrior" | "ranger" | "mage";
/** An ascended form a class can take after round 20. */
export type PathId = "berserker";

/** Combat numbers for one fighter. Skills mutate a copy of the class base. */
export interface Stats {
  maxHp: number;
  dmg: number;
  /** Seconds between basic attacks. */
  interval: number;
  range: number;
  /** Arena units per second. */
  speed: number;
  crit: number;
  critMult: number;
  /** Flat damage removed from each incoming non-magic hit. */
  armor: number;
  /** Multiplier on incoming damage after armor. */
  dmgTaken: number;
  dodge: number;
  lifesteal: number;
  /** Fraction of max HP regenerated per second. */
  regen: number;
  /** Multiplier on spell and damage-over-time damage. */
  spellPower: number;
  /** Multiplier on active-skill cooldowns. */
  cdMult: number;
  /** Magic damage ignores armor and can't be dodged. */
  magic: boolean;
}

export function stats(partial: Partial<Stats> & Pick<Stats, "maxHp" | "dmg" | "interval" | "range" | "speed">): Stats {
  return {
    crit: 0.05,
    critMult: 2,
    armor: 0,
    dmgTaken: 1,
    dodge: 0,
    lifesteal: 0,
    regen: 0,
    spellPower: 1,
    cdMult: 1,
    magic: false,
    ...partial,
  };
}

export interface HeroClass {
  id: ClassId;
  name: string;
  role: string;
  icon: string;
  desc: string;
  base: Stats;
  /** Where the hero stands at the start of a fight, if not ARENA.heroStart. */
  start?: number;
}

export const CLASSES: Record<ClassId, HeroClass> = {
  warrior: {
    id: "warrior", name: "Warrior", role: "Melee", icon: "🗡️",
    desc: "Tough. Walks up to the mob and hits hard.",
    base: stats({ maxHp: 160, dmg: 12, interval: 0.9, range: 1.3, speed: 3.5, armor: 3 }),
  },
  ranger: {
    id: "ranger", name: "Ranger", role: "Ranged", icon: "🏹",
    desc: "Fast arrows from a distance. Each shot is strongest at its own range: Far, Mid or Close.",
    base: stats({ maxHp: 90, dmg: 9, interval: 0.75, range: 12, speed: 2.5 }),
    // Room behind to Disengage into.
    start: 5,
  },
  mage: {
    id: "mage", name: "Mage", role: "Magic", icon: "🔮",
    desc: "Fragile. Magic bolts ignore armor and dodge; spells do the heavy lifting.",
    base: stats({ maxHp: 80, dmg: 7, interval: 1, range: 7, speed: 2.5, magic: true }),
  },
};
