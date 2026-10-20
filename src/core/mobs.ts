import { stats, type Stats } from "./stats";

export interface MobDef {
  id: string;
  name: string;
  icon: string;
  trait: string;
  boss: boolean;
  base: Stats;
  /** Boss rage: attack speed ×1.5 below half HP. */
  enrage?: boolean;
}

const NORMAL: MobDef[] = [
  { id: "slime", name: "Slime", icon: "🟢", trait: "Slow and squishy.", boss: false,
    base: stats({ maxHp: 55, dmg: 6, interval: 1.2, range: 1.2, speed: 1.5, crit: 0 }) },
  { id: "wolf", name: "Dire Wolf", icon: "🐺", trait: "Fast. Bites often.", boss: false,
    base: stats({ maxHp: 50, dmg: 4, interval: 0.55, range: 1.2, speed: 4.5 }) },
  { id: "skeleton", name: "Skeleton Archer", icon: "💀", trait: "Ranged. Shoots from afar.", boss: false,
    base: stats({ maxHp: 55, dmg: 7, interval: 1.3, range: 7, speed: 1.5 }) },
  { id: "orc", name: "Orc Brute", icon: "👹", trait: "Armored: blocks 4 damage per hit.", boss: false,
    base: stats({ maxHp: 90, dmg: 9, interval: 1.4, range: 1.3, speed: 2, armor: 4 }) },
  { id: "wraith", name: "Wraith", icon: "👻", trait: "Dodges 25% of hits. Magic claws ignore armor.", boss: false,
    base: stats({ maxHp: 65, dmg: 8, interval: 1.1, range: 1.2, speed: 2.5, dodge: 0.25, magic: true }) },
  { id: "troll", name: "Cave Troll", icon: "🧌", trait: "Regenerates 2% HP per second.", boss: false,
    base: stats({ maxHp: 120, dmg: 10, interval: 1.6, range: 1.4, speed: 1.5, regen: 0.02 }) },
];

const BOSSES: MobDef[] = [
  { id: "draugr", name: "Draugr Lord", icon: "🧟", trait: "Boss. Enrages below half HP.", boss: true, enrage: true,
    base: stats({ maxHp: 125, dmg: 9, interval: 1.2, range: 1.5, speed: 2, armor: 2 }) },
  { id: "drake", name: "Fire Drake", icon: "🐉", trait: "Boss. Breathes fire from range; enrages.", boss: true, enrage: true,
    base: stats({ maxHp: 130, dmg: 8, interval: 1.1, range: 6, speed: 2, magic: true }) },
  { id: "jotunn", name: "Frost Jötunn", icon: "🗿", trait: "Boss. Huge, armored, enrages.", boss: true, enrage: true,
    base: stats({ maxHp: 170, dmg: 12, interval: 2, range: 1.8, speed: 1.5, armor: 5, regen: 0.005 }) },
];

export const HP_GROWTH = 1.15;
export const DMG_GROWTH = 1.09;

/** The mob for a 1-based round: a boss every 5th round, otherwise cycling the normal roster. */
export function mobForRound(round: number): { def: MobDef; stats: Stats } {
  const isBoss = round % 5 === 0;
  const def = isBoss
    ? BOSSES[(round / 5 - 1) % BOSSES.length]
    : NORMAL[(round - 1 - Math.floor(round / 5)) % NORMAL.length];
  const n = round - 1;
  const s: Stats = {
    ...def.base,
    maxHp: Math.round(def.base.maxHp * HP_GROWTH ** n),
    dmg: def.base.dmg * DMG_GROWTH ** n,
    armor: def.base.armor + Math.floor(n / 6),
  };
  return { def, stats: s };
}
