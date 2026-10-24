import type { ClassId, PathId, Stats } from "./stats";

export type SkillId =
  // Warrior
  | "heavyStrike" | "bloodlust" | "ironSkin" | "shieldBash" | "berserk" | "thorns" | "secondWind" | "charge" | "spartanKick"
  // Ranger
  | "longshot" | "pinningArrow" | "scatterShot" | "disengage" | "snare" | "concussive" | "eagleEye" | "poison" | "rapidFire"
  // Mage
  | "fireball" | "gust" | "tidalWave" | "stoneSpike" | "manaShield" | "arcane" | "ignite" | "timeWarp" | "attunement" | "lingering"
  // Berserker (Warrior ascension)
  | "whirlwind" | "leapSmash" | "twinFury" | "recklessSwing" | "painFuel" | "bloodthirst" | "undyingRage" | "battleTrance" | "seething" | "bloodFrenzy" | "bottomless"
  // Shared
  | "vitality" | "might" | "swiftness" | "regeneration" | "lucky" | "vampirism" | "fortify" | "executioner";

export type SkillKind = "passive" | "proc" | "active";
/** How class skills are grouped for the player. Shared skills have none. */
export type SkillCat = "attack" | "defense" | "passive";

export interface SkillDef {
  id: SkillId;
  name: string;
  icon: string;
  cls: ClassId | "any";
  kind: SkillKind;
  cat?: SkillCat;
  /** Only offered after the class ascends into this path. */
  path?: PathId;
  /** Description at a given level (1-based). */
  desc: (lv: number) => string;
  /** Stat changes; proc and active effects live in the battle sim. */
  apply?: (s: Stats, lv: number) => void;
}

export const MAX_LEVEL = 3;

export interface Combo {
  /** Two attack skills where the second is the hero's very next attack after the first; the second gets the bonus. */
  pair: [SkillId, SkillId];
  dmgMult?: number;
  stunMult?: number;
  /** Seconds added to the last hit's stun. */
  stunAdd?: number;
  label: string;
}

/** Every combo is a pair; chains like Kick → Charge → Bash → Heavy are just pairs in a row. */
export const COMBOS: Combo[] = [
  { pair: ["spartanKick", "charge"], stunAdd: 3, label: "Combo! Stun +3s" },
  { pair: ["charge", "shieldBash"], stunMult: 2, label: "Combo! Stun ×2" },
  { pair: ["shieldBash", "heavyStrike"], dmgMult: 1.33, label: "Combo! +33%" },
];

/** Hidden, for every class: an unarmed attack on a knocked-back mob launches it airborne,
 * and knockback on an airborne mob goes AIR_KNOCK_MULT× as far along the attack. Not shown on any card. */
export const UNARMED: SkillId[] = ["spartanKick", "charge", "leapSmash"];
export const AIR_KNOCK_MULT = 10;
/** Seconds after a knockback lands that the mob is still off balance, open to an unarmed launch. */
export const OFF_BALANCE = 2;
export const AIRBORNE_LABEL = "Airborne!";
/** Hidden: Shield Bash on an airborne mob becomes an uppercut (thrown UPPERCUT_UP higher, ×10 airborne)
 * and FLURRY quick slashes, each × hero damage, FLURRY_GAP seconds apart. */
export const UPPERCUT_LABEL = "Uppercut Flurry!";
export const UPPERCUT_UP = 0.3;
export const FLURRY = { hits: 3, mult: 0.6, gap: 0.15 };
/** Hidden: with Heavy Strike ready, it replaces the flurry's last slash and slams the mob into the ground. */
export const GROUND_SLAM_LABEL = "Ground Slam!";
/** Then the Warrior, bounced up off the blow, ends the combo with a downward thrust. */
export const THRUST_LABEL = "Downward Thrust!";

/** Ranger range bands, by distance from hero to mob. Each Ranger skill is strongest in one band. */
export type Band = "close" | "mid" | "far";
export const BAND_EDGE = { close: 3, mid: 6 };
export const BAND_NAME: Record<Band, string> = { close: "Close", mid: "Mid", far: "Far" };

export function bandAt(dist: number): Band {
  return dist <= BAND_EDGE.close ? "close" : dist <= BAND_EDGE.mid ? "mid" : "far";
}

/** The band each Ranger attack wants. It holds up to BAND_HOLD seconds for it, then fires at OFF_BAND strength. */
export const BAND_OF: Partial<Record<SkillId, Band>> = { longshot: "far", pinningArrow: "mid", scatterShot: "close" };
export const BAND_HOLD = 2;
export const OFF_BAND = 0.5;

/** Mage elements. Each element spell marks the mob; a different element reacts with the mark. */
export type Element = "fire" | "water" | "earth" | "air";
/** What a reaction leaves behind. Zones sit on the ground where the mob stood; the rest ride on the mob. */
export type Derived = "lava" | "steam" | "mud" | "storm" | "sandstorm";

export const ELEMENT_OF: Partial<Record<SkillId, Element>> = { fireball: "fire", tidalWave: "water", stoneSpike: "earth", gust: "air" };
export const ELEMENT_ICON: Record<Element, string> = { fire: "🔥", water: "💧", earth: "🪨", air: "🌬️" };

/** Seconds an element mark waits on the mob for another element. */
export const MARK_TIME = 4;
/** Smart-cast: a spell that wouldn't react waits up to this long for one that would. */
export const SPELL_HOLD = 1;

export interface DerivedDef {
  name: string;
  icon: string;
  dur: number;
  /** Ground zone half-width; the effects below apply only while the mob stands in it. */
  zone?: number;
  slow?: number;
  /** Mob attacks this much slower. */
  atkSlow?: number;
  /** Burn per second, × hero damage. */
  burn?: number;
  /** Mob attacks miss this often. */
  blind?: number;
}

export const DERIVED: Record<Derived, DerivedDef> = {
  lava: { name: "Lava", icon: "🌋", dur: 4, zone: 1.5, slow: 0.4, burn: 0.6 },
  steam: { name: "Steam", icon: "♨️", dur: 3, blind: 0.3 },
  mud: { name: "Mud", icon: "🟫", dur: 5, zone: 1.5, slow: 0.6, atkSlow: 0.25 },
  storm: { name: "Storm", icon: "⛈️", dur: 4 },
  sandstorm: { name: "Sandstorm", icon: "🌪️", dur: 3, blind: 0.4 },
};

export interface Reaction {
  /** Two base elements (either order), or a derived state plus the element that hits it. */
  mix: [Element | Derived, Element];
  name: string;
  icon: string;
  /** Extra spell hit, × hero damage. */
  burst?: number;
  stun?: number;
  root?: number;
  /** Mob knocked back, arena units. */
  push?: number;
  /** Burns hurt this much more and refresh. */
  burnMult?: number;
  /** Mob takes more damage for a while. */
  vuln?: { mult: number; dur: number };
  leaves?: Derived;
}

/** Pairs of base elements, then tier 2: a derived state hit by another element. */
export const REACTIONS: Reaction[] = [
  { mix: ["fire", "earth"], name: "Lava", icon: "🌋", leaves: "lava" },
  { mix: ["fire", "water"], name: "Steam", icon: "♨️", burst: 1.5, leaves: "steam" },
  { mix: ["fire", "air"], name: "Wildfire", icon: "🔥", burnMult: 2 },
  { mix: ["water", "earth"], name: "Mud", icon: "🟫", leaves: "mud" },
  { mix: ["water", "air"], name: "Storm", icon: "⛈️", burst: 2, stun: 0.5, leaves: "storm" },
  { mix: ["earth", "air"], name: "Sandstorm", icon: "🌪️", push: 2, leaves: "sandstorm" },
  { mix: ["lava", "water"], name: "Obsidian", icon: "🪨", stun: 2, vuln: { mult: 1.3, dur: 5 } },
  { mix: ["lava", "air"], name: "Eruption", icon: "🌋", burst: 3 },
  { mix: ["mud", "fire"], name: "Clay", icon: "🧱", root: 3 },
  { mix: ["sandstorm", "fire"], name: "Glass", icon: "🔮", burst: 1, vuln: { mult: 1.2, dur: 4 } },
  { mix: ["storm", "fire"], name: "Plasma", icon: "⚡", burst: 2.5 },
  { mix: ["storm", "water"], name: "Electrocute", icon: "⚡", stun: 1.5 },
];

/** The reaction an element triggers against a mark or derived state, if any. */
export function findReaction(on: Element | Derived, el: Element): Reaction | undefined {
  return REACTIONS.find(({ mix: [a, b] }) => (a === on && b === el) || (b === on && a === el));
}

/** What a reaction does, for descriptions. */
export function reactionEffect(r: Reaction): string {
  const d = r.leaves && DERIVED[r.leaves];
  return [
    r.burst ? `×${r.burst} burst` : "",
    r.stun ? `stun ${r.stun}s` : "",
    r.root ? `root ${r.root}s` : "",
    r.push ? `push ${r.push}m` : "",
    r.burnMult ? `burns ×${r.burnMult}` : "",
    r.vuln ? `+${Math.round((r.vuln.mult - 1) * 100)}% damage taken ${r.vuln.dur}s` : "",
    d && d.zone ? `ground ${d.dur}s` : "",
    d?.slow ? `slow ${Math.round(d.slow * 100)}%` : "",
    d?.burn ? "burns" : "",
    d?.atkSlow ? `attacks −${Math.round(d.atkSlow * 100)}%` : "",
    d?.blind ? `misses ${Math.round(d.blind * 100)}% for ${d.dur}s` : "",
  ].filter(Boolean).join(", ");
}

/** What a combo does, for skill descriptions. */
export function comboEffect(c: Combo): string {
  return [
    c.dmgMult ? `+${Math.round((c.dmgMult - 1) * 100)}% damage` : "",
    c.stunMult ? `stun ×${c.stunMult}` : "",
    c.stunAdd ? `stun +${c.stunAdd}s` : "",
  ].filter(Boolean).join(", ");
}

const pct = (v: number) => `${Math.round(v * 100)}%`;
/** Trims float noise such as 1.2000000000000002. */
const num = (v: number) => String(+v.toFixed(2));

/** Numbers shared by the descriptions and the battle sim so they can't drift apart. */
export const SKILL_NUM = {
  // Same cooldown as Shield Bash at Lv1, so each Bash can be followed by a Heavy Strike.
  heavyStrike: (lv: number) => ({ cd: 7 - lv, mult: 2 + 0.5 * lv }),
  bloodlust: (lv: number) => 0.06 + 0.04 * lv,
  shieldBash: (lv: number) => ({ cd: 6, stun: 0.8 + 0.4 * lv, mult: 1 + 0.5 * lv }),
  berserk: (lv: number) => 0.4 * lv,
  thorns: (lv: number) => 0.15 + 0.15 * lv,
  secondWind: (lv: number) => 0.25 + 0.15 * lv,
  // Same cooldown as Shield Bash, so every Charge can be followed by a Bash.
  // The shove is small on its own; it matters when an airborne mob takes it ×10.
  charge: (lv: number) => ({ cd: 6, range: 6, mult: 1.5 + 0.5 * lv, stun: 0.5 + 0.5 * lv, push: 0.5 }),
  // Far enough that the Charge after it gets a proper run-up, still inside Charge's 6m range.
  spartanKick: (lv: number) => ({ cd: 8 - lv, mult: 0.8 + 0.2 * lv, push: 4, root: 1 }),
  longshot: (lv: number) => ({ cd: 7 - lv, mult: 2.5 + lv }),
  pinningArrow: (lv: number) => ({ cd: 5, mult: 1.5 + 0.5 * lv, root: 0.5 + 0.5 * lv }),
  // Far enough to throw a melee mob from Close back into Far.
  scatterShot: (lv: number) => ({ cd: 7 - lv, mult: 1.5 + 0.5 * lv, push: 5 }),
  disengage: (lv: number) => ({ cd: 9 - lv, leap: 3, evade: 1 + 0.5 * lv }),
  /** The trap sits where Mid begins and re-arms after `rearm` seconds. */
  snare: (lv: number) => ({ root: 1.5 + 0.75 * lv, rearm: 10 - 2 * lv }),
  concussive: (lv: number) => ({ slow: 0.25 + 0.15 * lv, dur: 3 }),
  eagleEye: (lv: number) => ({ crit: 0.1 * lv + 0.05, farCrit: 0.5 }),
  poison: (lv: number) => ({ dps: 1 + 1.5 * lv, dur: 4, maxStacks: 3 + 2 * lv, walking: 2 }),
  rapidFire: (lv: number) => 0.2 * lv,
  fireball: (lv: number) => ({ cd: 4, mult: 2 + lv, burn: 2 + 2 * lv }),
  gust: (lv: number) => ({ cd: [4, 3.5, 3][lv - 1] ?? 3, mult: 1 + 0.5 * lv, push: 1 }),
  tidalWave: (lv: number) => ({ cd: 8 - lv, mult: 1, push: 1 + 0.5 * lv }),
  stoneSpike: (lv: number) => ({ cd: 8 - lv, mult: 1 + 0.5 * lv, root: 0.5 + 0.5 * lv }),
  manaShield: (lv: number) => ({ shield: 0.15 + 0.1 * lv, refill: 8 }),
  ignite: (lv: number) => ({ durMult: 1 + 0.5 * lv, dmgMult: 1 + 0.25 * lv }),
  /** Reaction damage and crowd control. */
  attunement: (lv: number) => 1 + 0.2 * lv,
  /** Seconds added to marks and what reactions leave. */
  lingering: (lv: number) => 1 * lv,
  executioner: (lv: number) => ({ below: 0.3, mult: 1.25 + 0.25 * lv }),
  // Berserker. Rage costs and thresholds are in Rage points (RAGE.max at the base cap).
  whirlwind: (lv: number) => ({ cd: 6, cost: 50, hits: 6, dur: 2, mult: 0.8 + 0.2 * lv }),
  leapSmash: (lv: number) => ({ cd: 8 - lv, range: 6, mult: 1.5 + 0.5 * lv, rage: 25 }),
  twinFury: (lv: number) => ({ need: 50, mult: 0.25 + 0.25 * lv }),
  recklessSwing: (lv: number) => ({ cd: 7 - lv, mult: 1.6 + 0.4 * lv, taken: 0.15, dur: 3, rage: 20 }),
  painFuel: (lv: number) => 0.1 + 0.1 * lv,
  bloodthirst: (lv: number) => ({ steal: 0.02 + 0.02 * lv, max: 3 }),
  undyingRage: (lv: number) => ({ need: 50, frenzy: 2 + lv, speed: 0.5, dmg: 0.3 }),
  /** Share of max Rage needed for the trance. */
  battleTrance: (lv: number) => ({ need: [1, 0.85, 0.7][lv - 1] ?? 0.7, dr: 0.3 }),
  /** Rage per second (as % of max) while below lowHp. */
  seething: (lv: number) => ({ lowHp: 0.5, gain: 3 + 2 * lv }),
  bloodFrenzy: (lv: number) => 0.5 * lv,
  bottomless: (lv: number) => 0.25 + 0.25 * lv,
};

/** The Berserker's Rage: fills on hits dealt and damage taken, drains after RAGE.idle seconds without either. */
export const RAGE = {
  max: 100,
  /** Per hit landed. */
  perHit: 6,
  /** Per whole max HP of damage taken. */
  taken: 150,
  idle: 1.5,
  /** Per second once idle. */
  drain: 12,
};

const S = SKILL_NUM;

export const SKILLS: Record<SkillId, SkillDef> = {
  heavyStrike: { id: "heavyStrike", name: "Heavy Strike", icon: "🔨", cls: "warrior", kind: "active", cat: "attack",
    desc: (lv) => `Every ${S.heavyStrike(lv).cd}s: your next swing deals ×${num(S.heavyStrike(lv).mult)}. Saved for right after Shield Bash.` },
  bloodlust: { id: "bloodlust", name: "Bloodlust", icon: "🩸", cls: "warrior", kind: "proc", cat: "passive",
    desc: (lv) => `Heal ${pct(S.bloodlust(lv))} of damage you deal.` },
  ironSkin: { id: "ironSkin", name: "Iron Skin", icon: "🛡️", cls: "warrior", kind: "passive", cat: "defense",
    desc: (lv) => `Take ${pct(0.1 * lv + 0.05)} less damage.`, apply: (s, lv) => { s.dmgTaken *= 1 - (0.1 * lv + 0.05); } },
  shieldBash: { id: "shieldBash", name: "Shield Bash", icon: "💥", cls: "warrior", kind: "active", cat: "attack",
    desc: (lv) => `Every ${S.shieldBash(lv).cd}s: hit ×${num(S.shieldBash(lv).mult)} and stun ${num(S.shieldBash(lv).stun)}s.` },
  berserk: { id: "berserk", name: "Berserk", icon: "😤", cls: "warrior", kind: "passive", cat: "passive",
    desc: (lv) => `Up to +${pct(S.berserk(lv))} attack speed as your HP drops.` },
  thorns: { id: "thorns", name: "Thorns", icon: "🌵", cls: "warrior", kind: "proc", cat: "defense",
    desc: (lv) => `Reflect ${pct(S.thorns(lv))} of damage taken.` },
  secondWind: { id: "secondWind", name: "Second Wind", icon: "🌬️", cls: "warrior", kind: "proc", cat: "defense",
    desc: (lv) => `Once per fight, at 30% HP heal ${pct(S.secondWind(lv))}.` },
  charge: { id: "charge", name: "Charge", icon: "🐂", cls: "warrior", kind: "proc", cat: "attack",
    desc: (lv) => `Every ${S.charge(lv).cd}s: from up to ${S.charge(lv).range}m away, dash in for ×${S.charge(lv).mult} and stun ${S.charge(lv).stun}s.` },
  spartanKick: { id: "spartanKick", name: "Spartan Kick", icon: "🦶", cls: "warrior", kind: "active", cat: "attack",
    desc: (lv) => `Every ${S.spartanKick(lv).cd}s: kick for ×${num(S.spartanKick(lv).mult)} and knock the mob back ${S.spartanKick(lv).push}m, immobilized ${S.spartanKick(lv).root}s after it lands. Into the far wall: Wall Slam, +33% damage taken for 5s.` },

  longshot: { id: "longshot", name: "Longshot", icon: "🏹", cls: "ranger", kind: "active", cat: "attack",
    desc: (lv) => `Every ${S.longshot(lv).cd}s: a long draw for ×${S.longshot(lv).mult}. Far band.` },
  pinningArrow: { id: "pinningArrow", name: "Pinning Arrow", icon: "📌", cls: "ranger", kind: "active", cat: "attack",
    desc: (lv) => `Every ${S.pinningArrow(lv).cd}s: ×${S.pinningArrow(lv).mult} and root ${S.pinningArrow(lv).root}s. Mid band.` },
  scatterShot: { id: "scatterShot", name: "Scatter Shot", icon: "🎯", cls: "ranger", kind: "active", cat: "attack",
    desc: (lv) => `Every ${S.scatterShot(lv).cd}s: point-blank blast for ×${num(S.scatterShot(lv).mult)}, knocks the mob back ${S.scatterShot(lv).push}m. Close band.` },
  disengage: { id: "disengage", name: "Disengage", icon: "🤸", cls: "ranger", kind: "active", cat: "defense",
    desc: (lv) => `Every ${S.disengage(lv).cd}s, when the mob gets Close: leap back ${S.disengage(lv).leap}m and dodge everything for ${S.disengage(lv).evade}s.` },
  snare: { id: "snare", name: "Snare Trap", icon: "🪤", cls: "ranger", kind: "proc", cat: "defense",
    desc: (lv) => `A trap at the edge of Mid roots the mob ${num(S.snare(lv).root)}s. Re-arms ${S.snare(lv).rearm}s after it springs.` },
  concussive: { id: "concussive", name: "Concussive Arrows", icon: "💫", cls: "ranger", kind: "proc", cat: "defense",
    desc: (lv) => `Hits in the Far band slow the mob ${pct(S.concussive(lv).slow)} for ${S.concussive(lv).dur}s.` },
  eagleEye: { id: "eagleEye", name: "Eagle Eye", icon: "🦅", cls: "ranger", kind: "passive", cat: "passive",
    desc: (lv) => `+${pct(S.eagleEye(lv).crit)} crit chance, +1 range. Crits in the Far band deal +${pct(S.eagleEye(lv).farCrit)} more.`,
    apply: (s, lv) => { s.crit += S.eagleEye(lv).crit; s.range += 1; } },
  poison: { id: "poison", name: "Poison Arrows", icon: "🧪", cls: "ranger", kind: "proc", cat: "passive",
    desc: (lv) => `Hits add poison: ${S.poison(lv).dps}/s for ${S.poison(lv).dur}s, stacks ${S.poison(lv).maxStacks}×. Ticks ×${S.poison(lv).walking} while the mob walks.` },
  rapidFire: { id: "rapidFire", name: "Rapid Fire", icon: "⚡", cls: "ranger", kind: "passive", cat: "passive",
    desc: (lv) => `+${pct(S.rapidFire(lv))} attack speed, doubled while the mob is Close.`, apply: (s, lv) => { s.interval /= 1 + S.rapidFire(lv); } },

  fireball: { id: "fireball", name: "Fireball", icon: "🔥", cls: "mage", kind: "active", cat: "attack",
    desc: (lv) => `Every ${S.fireball(lv).cd}s: ×${S.fireball(lv).mult} damage and burn ${S.fireball(lv).burn}/s for 3s.` },
  gust: { id: "gust", name: "Gust", icon: "🌬️", cls: "mage", kind: "active", cat: "attack",
    desc: (lv) => `Every ${num(S.gust(lv).cd)}s: wind blade for ×${num(S.gust(lv).mult)} damage, pushes the mob ${S.gust(lv).push}m.` },
  tidalWave: { id: "tidalWave", name: "Tidal Wave", icon: "🌊", cls: "mage", kind: "active", cat: "defense",
    desc: (lv) => `Every ${S.tidalWave(lv).cd}s: wave for ×${S.tidalWave(lv).mult} damage, pushes the mob ${num(S.tidalWave(lv).push)}m.` },
  stoneSpike: { id: "stoneSpike", name: "Stone Spike", icon: "🪨", cls: "mage", kind: "active", cat: "defense",
    desc: (lv) => `Every ${S.stoneSpike(lv).cd}s: spike for ×${num(S.stoneSpike(lv).mult)} damage, roots the mob ${S.stoneSpike(lv).root}s.` },
  manaShield: { id: "manaShield", name: "Mana Shield", icon: "🔵", cls: "mage", kind: "proc", cat: "defense",
    desc: (lv) => `Barrier of ${pct(S.manaShield(lv).shield)} max HP, refills every ${S.manaShield(lv).refill}s.` },
  arcane: { id: "arcane", name: "Arcane Power", icon: "✨", cls: "mage", kind: "passive", cat: "passive",
    desc: (lv) => `+${pct(0.25 * lv)} spell damage.`, apply: (s, lv) => { s.spellPower += 0.25 * lv; } },
  ignite: { id: "ignite", name: "Ignite", icon: "🌋", cls: "mage", kind: "passive", cat: "passive",
    desc: (lv) => `Burns last ×${S.ignite(lv).durMult} longer and hurt ×${S.ignite(lv).dmgMult}. Bolts burn too.` },
  timeWarp: { id: "timeWarp", name: "Time Warp", icon: "⏳", cls: "mage", kind: "passive", cat: "passive",
    desc: (lv) => `Spell cooldowns −${pct(0.15 * lv)}.`, apply: (s, lv) => { s.cdMult *= 1 - 0.15 * lv; } },
  attunement: { id: "attunement", name: "Attunement", icon: "🔯", cls: "mage", kind: "passive", cat: "passive",
    desc: (lv) => `Element reactions hit ${pct(S.attunement(lv) - 1)} harder and their stuns and roots last ${pct(S.attunement(lv) - 1)} longer.` },
  lingering: { id: "lingering", name: "Lingering", icon: "⌛", cls: "mage", kind: "passive", cat: "passive",
    desc: (lv) => `Element marks, zones and clouds last +${S.lingering(lv)}s.` },

  whirlwind: { id: "whirlwind", name: "Whirlwind", icon: "🌪️", cls: "warrior", path: "berserker", kind: "active", cat: "attack",
    desc: (lv) => `Spend ${S.whirlwind(lv).cost} Rage: spin for ${S.whirlwind(lv).dur}s, ${S.whirlwind(lv).hits} axe hits of ×${num(S.whirlwind(lv).mult)}. Every ${S.whirlwind(lv).cd}s at most.` },
  leapSmash: { id: "leapSmash", name: "Leap Smash", icon: "🦘", cls: "warrior", path: "berserker", kind: "active", cat: "attack",
    desc: (lv) => `Every ${S.leapSmash(lv).cd}s: leap in from up to ${S.leapSmash(lv).range}m and smash for ×${num(S.leapSmash(lv).mult)}, +${S.leapSmash(lv).rage} Rage. Unarmed: launches a knocked-back mob.` },
  twinFury: { id: "twinFury", name: "Twin Fury", icon: "⚔️", cls: "warrior", path: "berserker", kind: "proc", cat: "attack",
    desc: (lv) => `Above ${S.twinFury(lv).need} Rage, swings hit twice: the off-hand axe for ×${num(S.twinFury(lv).mult)}.` },
  recklessSwing: { id: "recklessSwing", name: "Reckless Swing", icon: "💢", cls: "warrior", path: "berserker", kind: "active", cat: "attack",
    desc: (lv) => `Every ${S.recklessSwing(lv).cd}s: ×${num(S.recklessSwing(lv).mult)} swing, +${S.recklessSwing(lv).rage} Rage, but take +${pct(S.recklessSwing(lv).taken)} damage for ${S.recklessSwing(lv).dur}s.` },
  painFuel: { id: "painFuel", name: "Pain Fuel", icon: "🔥", cls: "warrior", path: "berserker", kind: "proc", cat: "defense",
    desc: (lv) => `${pct(S.painFuel(lv))} of damage taken becomes Rage instead of lost HP (until Rage is full).` },
  bloodthirst: { id: "bloodthirst", name: "Bloodthirst", icon: "🩸", cls: "warrior", path: "berserker", kind: "proc", cat: "defense",
    desc: (lv) => `${pct(S.bloodthirst(lv).steal)} lifesteal, up to ×${S.bloodthirst(lv).max} at full Rage.` },
  undyingRage: { id: "undyingRage", name: "Undying Rage", icon: "💀", cls: "warrior", path: "berserker", kind: "proc", cat: "defense",
    desc: (lv) => `Once per fight, a lethal hit leaves you at 1 HP if you have ${S.undyingRage(lv).need}+ Rage: spends it all for a ${S.undyingRage(lv).frenzy}s frenzy (+${pct(S.undyingRage(lv).speed)} attack speed, +${pct(S.undyingRage(lv).dmg)} damage).` },
  battleTrance: { id: "battleTrance", name: "Battle Trance", icon: "🧘", cls: "warrior", path: "berserker", kind: "proc", cat: "defense",
    desc: (lv) => `At ${pct(S.battleTrance(lv).need)} Rage or more: take ${pct(S.battleTrance(lv).dr)} less damage and shrug off stuns and knockback.` },
  seething: { id: "seething", name: "Seething", icon: "😠", cls: "warrior", path: "berserker", kind: "passive", cat: "passive",
    desc: (lv) => `Rage never drains. Below ${pct(S.seething(lv).lowHp)} HP, gain ${S.seething(lv).gain}% Rage per second.` },
  bloodFrenzy: { id: "bloodFrenzy", name: "Blood Frenzy", icon: "🐺", cls: "warrior", path: "berserker", kind: "passive", cat: "passive",
    desc: (lv) => `+${pct(S.bloodFrenzy(lv))} Rage from every hit.` },
  bottomless: { id: "bottomless", name: "Bottomless", icon: "🕳️", cls: "warrior", path: "berserker", kind: "passive", cat: "passive",
    desc: (lv) => `Max Rage +${pct(S.bottomless(lv))}.` },

  vitality: { id: "vitality", name: "Vitality", icon: "❤️", cls: "any", kind: "passive",
    desc: (lv) => `+${pct(0.25 * lv)} max HP.`, apply: (s, lv) => { s.maxHp = Math.round(s.maxHp * (1 + 0.25 * lv)); } },
  might: { id: "might", name: "Might", icon: "💪", cls: "any", kind: "passive",
    desc: (lv) => `+${pct(0.15 * lv)} damage.`, apply: (s, lv) => { s.dmg *= 1 + 0.15 * lv; } },
  swiftness: { id: "swiftness", name: "Swiftness", icon: "👟", cls: "any", kind: "passive",
    desc: (lv) => `+${pct(0.12 * lv)} attack speed, faster movement.`, apply: (s, lv) => { s.interval /= 1 + 0.12 * lv; s.speed += 0.5 * lv; } },
  regeneration: { id: "regeneration", name: "Regeneration", icon: "🌿", cls: "any", kind: "passive",
    desc: (lv) => `Regenerate ${pct(0.01 * lv + 0.005)} max HP per second.`, apply: (s, lv) => { s.regen += 0.01 * lv + 0.005; } },
  lucky: { id: "lucky", name: "Lucky", icon: "🍀", cls: "any", kind: "passive",
    desc: (lv) => `+${pct(0.08 * lv)} crit chance, +${pct(0.25 * lv)} crit damage.`, apply: (s, lv) => { s.crit += 0.08 * lv; s.critMult += 0.25 * lv; } },
  vampirism: { id: "vampirism", name: "Vampirism", icon: "🧛", cls: "any", kind: "passive",
    desc: (lv) => `${pct(0.04 * lv)} lifesteal on all damage.`, apply: (s, lv) => { s.lifesteal += 0.04 * lv; } },
  fortify: { id: "fortify", name: "Fortify", icon: "🧱", cls: "any", kind: "passive",
    desc: (lv) => `+${2 * lv} armor (blocks flat damage per hit).`, apply: (s, lv) => { s.armor += 2 * lv; } },
  executioner: { id: "executioner", name: "Executioner", icon: "🪓", cls: "any", kind: "proc",
    desc: (lv) => `×${S.executioner(lv).mult} damage to mobs under ${pct(S.executioner(lv).below)} HP.` },
};

// Descriptions list each skill's combos straight from COMBOS, so the text can't drift from the rules.
for (const def of Object.values(SKILLS)) {
  const notes = COMBOS.flatMap((c) =>
    c.pair[1] === def.id ? [`after ${SKILLS[c.pair[0]].name}: ${comboEffect(c)}`]
    : c.pair[0] === def.id ? [`${SKILLS[c.pair[1]].name} next: ${comboEffect(c)}`] : [],
  );
  if (!notes.length) continue;
  const base = def.desc;
  def.desc = (lv) => `${base(lv)} Combo — ${notes.join("; ")}.`;
}

// Element spells list their reactions from REACTIONS the same way.
for (const def of Object.values(SKILLS)) {
  const el = ELEMENT_OF[def.id];
  if (!el) continue;
  const pairs = REACTIONS.filter((r) => r.mix[1] === el || r.mix[0] === el).map((r) => {
    const other = r.mix[0] === el ? r.mix[1] : r.mix[0];
    const on = other in DERIVED ? DERIVED[other as Derived].icon : ELEMENT_ICON[other as Element];
    return `+${on} ${r.name}: ${reactionEffect(r)}`;
  });
  const base = def.desc;
  def.desc = (lv) => `${base(lv)} ${ELEMENT_ICON[el]} Marks the mob ${MARK_TIME}s. ${pairs.join("; ")}.`;
}

export type SkillLevels = Partial<Record<SkillId, number>>;

export function heroStats(base: Stats, levels: SkillLevels): Stats {
  const s = { ...base };
  for (const [id, lv] of Object.entries(levels) as [SkillId, number][]) {
    SKILLS[id].apply?.(s, lv);
  }
  return s;
}
