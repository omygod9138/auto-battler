// Static game content. Names and themes follow Northgard; numbers are our own.

export type Terrain = "plain" | "forest" | "fertile" | "stone" | "mountain";

export const TERRAIN_INFO: Record<Terrain, { name: string; icon: string; buildable: boolean }> = {
  plain: { name: "Plain", icon: "", buildable: true },
  forest: { name: "Forest", icon: "🌲", buildable: true },
  fertile: { name: "Fertile land", icon: "🌾", buildable: true },
  stone: { name: "Stone", icon: "🪨", buildable: true },
  mountain: { name: "Mountain", icon: "⛰️", buildable: false },
};

export type UnitKind = "warrior" | "archer" | "shieldbearer" | "troll" | "draugr";

export interface UnitBase {
  kind: UnitKind;
  name: string;
  icon: string;
  hp: number;
  atk: number;
  /** Attack range in arena units. 1 = melee. */
  range: number;
  /** Arena units per second. */
  speed: number;
  /** Seconds between attacks. */
  cooldown: number;
  /** Food supply the unit needs to be fielded. */
  supply: number;
  /** Damage dealt to the losing player per surviving unit. */
  threat: number;
}

export const UNITS: Record<UnitKind, UnitBase> = {
  warrior: { kind: "warrior", name: "Warrior", icon: "🪓", hp: 34, atk: 6, range: 1, speed: 1.6, cooldown: 1, supply: 1, threat: 1 },
  archer: { kind: "archer", name: "Archer", icon: "🏹", hp: 20, atk: 5, range: 5, speed: 1.3, cooldown: 1.2, supply: 1, threat: 1 },
  shieldbearer: { kind: "shieldbearer", name: "Shieldbearer", icon: "🛡️", hp: 60, atk: 3, range: 1, speed: 1.2, cooldown: 1, supply: 1, threat: 1 },
  troll: { kind: "troll", name: "Troll", icon: "👹", hp: 150, atk: 14, range: 1.3, speed: 1, cooldown: 1.7, supply: 3, threat: 3 },
  // Neutral undead that raid early rounds before rival clans show up.
  draugr: { kind: "draugr", name: "Draugr", icon: "💀", hp: 22, atk: 4, range: 1, speed: 1.2, cooldown: 1.1, supply: 0, threat: 1 },
};

/** Permanent run modifiers, built up by the clan and fate cards. */
export interface Modifiers {
  woodIncome: number;
  foodIncome: number;
  loreIncome: number;
  farmBonus: number;
  lorePerShrine: number;
  unitAtk: Record<UnitKind, number>;
  unitHpPct: Record<UnitKind, number>;
  unitRange: Record<UnitKind, number>;
  /** Extra damage the player deals to a defeated opponent. */
  bonusThreat: number;
}

const perUnit = (v: number): Record<UnitKind, number> => ({ warrior: v, archer: v, shieldbearer: v, troll: v, draugr: v });

export function baseModifiers(): Modifiers {
  return {
    woodIncome: 0,
    foodIncome: 0,
    loreIncome: 0,
    farmBonus: 0,
    lorePerShrine: 0,
    unitAtk: perUnit(0),
    unitHpPct: perUnit(0),
    unitRange: perUnit(0),
    bonusThreat: 0,
  };
}

export type BuildingId =
  | "townhall"
  | "woodcutter"
  | "farm"
  | "quarry"
  | "shrine"
  | "barracks"
  | "range"
  | "longhouse"
  | "forge"
  | "healer"
  | "trollcave";

export interface Neighborhood {
  terrain: Terrain[];
  buildings: BuildingId[];
}

export interface Yield {
  wood: number;
  food: number;
  lore: number;
}

export interface BuildingDef {
  id: BuildingId;
  name: string;
  icon: string;
  cost: number;
  desc: string;
  /** Shop weight; 0 = never offered. */
  weight: number;
  /** Earliest round it can appear in the shop. */
  minRound: number;
  canPlace?: (n: Neighborhood) => boolean;
  placeHint?: string;
  yield?: (n: Neighborhood, m: Modifiers) => Yield;
  units?: { kind: UnitKind; count: number };
  /** Applies to units trained by orthogonally adjacent buildings. */
  aura?: { atk?: number; hpPct?: number };
}

const count = <T>(list: T[], v: T) => list.filter((x) => x === v).length;
const Y = (wood = 0, food = 0, lore = 0): Yield => ({ wood, food, lore });

export const BUILDINGS: Record<BuildingId, BuildingDef> = {
  townhall: {
    id: "townhall", name: "Town Hall", icon: "🏛️", cost: 0, weight: 0, minRound: 99,
    desc: "Heart of the clan. +3 wood, +3 food, +1 lore.",
    yield: () => Y(3, 3, 1),
  },
  woodcutter: {
    id: "woodcutter", name: "Woodcutter's Lodge", icon: "🪵", cost: 3, weight: 10, minRound: 1,
    desc: "+1 wood, +2 per adjacent forest.",
    yield: (n) => Y(1 + 2 * count(n.terrain, "forest")),
  },
  farm: {
    id: "farm", name: "Farm", icon: "🐑", cost: 3, weight: 10, minRound: 1,
    desc: "+1 food, +2 per adjacent fertile land, +1 per adjacent farm.",
    yield: (n, m) => Y(0, 1 + m.farmBonus + 2 * count(n.terrain, "fertile") + count(n.buildings, "farm")),
  },
  quarry: {
    id: "quarry", name: "Stone Quarry", icon: "⛏️", cost: 3, weight: 6, minRound: 2,
    desc: "+3 wood per adjacent stone. Must touch stone.",
    canPlace: (n) => n.terrain.includes("stone"),
    placeHint: "needs adjacent stone",
    yield: (n) => Y(3 * count(n.terrain, "stone")),
  },
  shrine: {
    id: "shrine", name: "Shrine", icon: "⛩️", cost: 4, weight: 7, minRound: 1,
    desc: "+2 lore, +1 per adjacent mountain.",
    yield: (n, m) => Y(0, 0, 2 + m.lorePerShrine + count(n.terrain, "mountain")),
  },
  barracks: {
    id: "barracks", name: "Barracks", icon: "⚔️", cost: 4, weight: 9, minRound: 1,
    desc: "Trains 2 Warriors.",
    units: { kind: "warrior", count: 2 },
  },
  range: {
    id: "range", name: "Archery Range", icon: "🎯", cost: 5, weight: 7, minRound: 2,
    desc: "Trains 2 Archers.",
    units: { kind: "archer", count: 2 },
  },
  longhouse: {
    id: "longhouse", name: "Shield Longhouse", icon: "🛖", cost: 5, weight: 6, minRound: 3,
    desc: "Trains 2 Shieldbearers.",
    units: { kind: "shieldbearer", count: 2 },
  },
  forge: {
    id: "forge", name: "Forge", icon: "🔨", cost: 4, weight: 6, minRound: 2,
    desc: "Units from adjacent military buildings get +3 attack.",
    aura: { atk: 3 },
  },
  healer: {
    id: "healer", name: "Healer's Hut", icon: "🌿", cost: 4, weight: 6, minRound: 2,
    desc: "Units from adjacent military buildings get +30% HP.",
    aura: { hpPct: 30 },
  },
  trollcave: {
    id: "trollcave", name: "Troll Cave", icon: "🕳️", cost: 7, weight: 4, minRound: 4,
    desc: "Mythic site. Unleashes a Troll. Must touch a mountain.",
    canPlace: (n) => n.terrain.includes("mountain"),
    placeHint: "needs adjacent mountain",
    units: { kind: "troll", count: 1 },
  },
};

export const SHOP_BUILDINGS = Object.values(BUILDINGS).filter((b) => b.weight > 0);

export type ClanId = "stag" | "raven" | "wolf";

export interface ClanDef {
  id: ClanId;
  name: string;
  icon: string;
  desc: string;
  apply: (m: Modifiers) => void;
}

export const CLANS: Record<ClanId, ClanDef> = {
  stag: {
    id: "stag", name: "Clan of the Stag", icon: "🦌",
    desc: "Farmers. Every farm makes +1 food.",
    apply: (m) => { m.farmBonus += 1; },
  },
  raven: {
    id: "raven", name: "Clan of the Raven", icon: "🐦‍⬛",
    desc: "Traders. +2 wood every round.",
    apply: (m) => { m.woodIncome += 2; },
  },
  wolf: {
    id: "wolf", name: "Clan of the Wolf", icon: "🐺",
    desc: "Raiders. Warriors get +2 attack.",
    apply: (m) => { m.unitAtk.warrior += 2; },
  },
};

export type Patron = "Odin" | "Thor" | "Baldr";

export interface FateCard {
  id: string;
  name: string;
  patron: Patron;
  cost: number;
  desc: string;
  apply: (m: Modifiers) => void;
}

export const FATE_CARDS: FateCard[] = [
  { id: "thunder", name: "Thunder Strike", patron: "Thor", cost: 4, desc: "All units +2 attack.",
    apply: (m) => { for (const k of Object.keys(m.unitAtk) as UnitKind[]) m.unitAtk[k] += 2; } },
  { id: "berserk", name: "Berserker Rage", patron: "Thor", cost: 3, desc: "Warriors +4 attack.",
    apply: (m) => { m.unitAtk.warrior += 4; } },
  { id: "mjolnir", name: "Wrath of Mjölnir", patron: "Thor", cost: 3, desc: "Beaten foes lose +3 extra HP.",
    apply: (m) => { m.bonusThreat += 3; } },
  { id: "ravens", name: "Huginn & Muninn", patron: "Odin", cost: 3, desc: "Archers +2 range and +2 attack.",
    apply: (m) => { m.unitRange.archer += 2; m.unitAtk.archer += 2; } },
  { id: "wisdom", name: "Wisdom of the Well", patron: "Odin", cost: 2, desc: "Every shrine +1 lore.",
    apply: (m) => { m.lorePerShrine += 1; } },
  { id: "allfather", name: "Allfather's Gift", patron: "Odin", cost: 4, desc: "+2 lore and +1 wood every round.",
    apply: (m) => { m.loreIncome += 2; m.woodIncome += 1; } },
  { id: "bounty", name: "Baldr's Bounty", patron: "Baldr", cost: 3, desc: "+3 food every round.",
    apply: (m) => { m.foodIncome += 3; } },
  { id: "hides", name: "Blessed Hides", patron: "Baldr", cost: 4, desc: "All units +20% HP.",
    apply: (m) => { for (const k of Object.keys(m.unitHpPct) as UnitKind[]) m.unitHpPct[k] += 20; } },
  { id: "bulwark", name: "Shining Bulwark", patron: "Baldr", cost: 3, desc: "Shieldbearers +50% HP, Trolls +30% HP.",
    apply: (m) => { m.unitHpPct.shieldbearer += 50; m.unitHpPct.troll += 30; } },
];

export const RULES = {
  boardSize: 7,
  startHp: 40,
  finalRound: 10,
  startWood: 6,
  rerollCost: 1,
  shopSize: 3,
  fateOffers: 3,
  /** Rounds fought against neutral raiders instead of rival clans. */
  neutralRounds: 2,
  /** Surviving-threat damage is capped so one bad round isn't fatal. */
  maxThreatDamage: 10,
};
