import type { ClassId, Stats } from "./stats";

export type SkillId =
  // Warrior
  | "heavyStrike" | "bloodlust" | "ironSkin" | "shieldBash" | "berserk" | "thorns" | "secondWind" | "charge" | "spartanKick"
  // Ranger
  | "multishot" | "poison" | "eagleEye" | "knockback" | "rapidFire" | "evasion" | "headshot" | "snare"
  // Mage
  | "fireball" | "frostNova" | "static" | "manaShield" | "arcane" | "ignite" | "timeWarp" | "meteor"
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
  charge: (lv: number) => ({ cd: 6, range: 6, mult: 1.5 + 0.5 * lv, stun: 0.5 + 0.5 * lv }),
  spartanKick: (lv: number) => ({ cd: 8 - lv, mult: 0.8 + 0.2 * lv, push: 2 }),
  multishot: (lv: number) => ({ arrows: lv, mult: 0.5 }),
  poison: (lv: number) => ({ dps: 1 + 1.5 * lv, dur: 4, maxStacks: 3 + 2 * lv }),
  knockback: (lv: number) => ({ chance: 0.25 + 0.1 * lv, dist: 1.5 }),
  headshot: (lv: number) => ({ cd: 8 - lv, mult: 3 + lv }),
  snare: (lv: number) => 1 + 0.75 * lv,
  fireball: (lv: number) => ({ cd: 4, mult: 2 + lv, burn: 2 + 2 * lv }),
  frostNova: (lv: number) => ({ cd: 9 - lv, freeze: 1.2 + 0.5 * lv, mult: 1 }),
  static: (lv: number) => ({ cd: [4, 3, 2.5][lv - 1] ?? 2.5, mult: 1.5 }),
  manaShield: (lv: number) => ({ shield: 0.15 + 0.1 * lv, refill: 8 }),
  ignite: (lv: number) => ({ durMult: 1 + 0.5 * lv, dmgMult: 1 + 0.25 * lv }),
  meteor: (lv: number) => ({ cd: 14 - 2 * lv, mult: 5 + 2 * lv }),
  executioner: (lv: number) => ({ below: 0.3, mult: 1.25 + 0.25 * lv }),
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
    desc: (lv) => `Every ${S.spartanKick(lv).cd}s: kick for ×${num(S.spartanKick(lv).mult)} and knock the mob back ${S.spartanKick(lv).push}m. Into the far wall: Wall Slam, +33% damage taken for 5s.` },

  multishot: { id: "multishot", name: "Multishot", icon: "🎯", cls: "ranger", kind: "proc", cat: "attack",
    desc: (lv) => `Fire ${S.multishot(lv).arrows} extra arrow(s) at ${pct(S.multishot(lv).mult)} damage.` },
  poison: { id: "poison", name: "Poison Arrows", icon: "🧪", cls: "ranger", kind: "proc", cat: "attack",
    desc: (lv) => `Hits add poison: ${S.poison(lv).dps}/s for ${S.poison(lv).dur}s, stacks ${S.poison(lv).maxStacks}×.` },
  eagleEye: { id: "eagleEye", name: "Eagle Eye", icon: "🦅", cls: "ranger", kind: "passive", cat: "passive",
    desc: (lv) => `+${pct(0.1 * lv + 0.05)} crit chance, +1 range.`, apply: (s, lv) => { s.crit += 0.1 * lv + 0.05; s.range += 1; } },
  knockback: { id: "knockback", name: "Knockback", icon: "💨", cls: "ranger", kind: "proc", cat: "defense",
    desc: (lv) => `${pct(S.knockback(lv).chance)} chance a hit pushes the mob back.` },
  rapidFire: { id: "rapidFire", name: "Rapid Fire", icon: "⚡", cls: "ranger", kind: "passive", cat: "passive",
    desc: (lv) => `+${pct(0.2 * lv)} attack speed.`, apply: (s, lv) => { s.interval /= 1 + 0.2 * lv; } },
  evasion: { id: "evasion", name: "Evasion", icon: "🍃", cls: "ranger", kind: "passive", cat: "defense",
    desc: (lv) => `+${pct(0.1 * lv + 0.05)} dodge.`, apply: (s, lv) => { s.dodge += 0.1 * lv + 0.05; } },
  headshot: { id: "headshot", name: "Headshot", icon: "☠️", cls: "ranger", kind: "active", cat: "attack",
    desc: (lv) => `Every ${S.headshot(lv).cd}s: an arrow for ×${S.headshot(lv).mult}.` },
  snare: { id: "snare", name: "Snare Trap", icon: "🪤", cls: "ranger", kind: "proc", cat: "defense",
    desc: (lv) => `A trap roots the mob for ${S.snare(lv)}s as it approaches.` },

  fireball: { id: "fireball", name: "Fireball", icon: "🔥", cls: "mage", kind: "active", cat: "attack",
    desc: (lv) => `Every ${S.fireball(lv).cd}s: ×${S.fireball(lv).mult} damage and burn ${S.fireball(lv).burn}/s for 3s.` },
  frostNova: { id: "frostNova", name: "Frost Nova", icon: "❄️", cls: "mage", kind: "active", cat: "defense",
    desc: (lv) => `Every ${S.frostNova(lv).cd}s: freeze the mob for ${S.frostNova(lv).freeze}s.` },
  static: { id: "static", name: "Static Charge", icon: "🌩️", cls: "mage", kind: "active", cat: "attack",
    desc: (lv) => `Every ${num(S.static(lv).cd)}s: your next hit adds a ×${S.static(lv).mult} lightning bolt.` },
  manaShield: { id: "manaShield", name: "Mana Shield", icon: "🔵", cls: "mage", kind: "proc", cat: "defense",
    desc: (lv) => `Barrier of ${pct(S.manaShield(lv).shield)} max HP, refills every ${S.manaShield(lv).refill}s.` },
  arcane: { id: "arcane", name: "Arcane Power", icon: "✨", cls: "mage", kind: "passive", cat: "passive",
    desc: (lv) => `+${pct(0.25 * lv)} spell damage.`, apply: (s, lv) => { s.spellPower += 0.25 * lv; } },
  ignite: { id: "ignite", name: "Ignite", icon: "🌋", cls: "mage", kind: "passive", cat: "passive",
    desc: (lv) => `Burns last ×${S.ignite(lv).durMult} longer and hurt ×${S.ignite(lv).dmgMult}. Bolts burn too.` },
  timeWarp: { id: "timeWarp", name: "Time Warp", icon: "⏳", cls: "mage", kind: "passive", cat: "passive",
    desc: (lv) => `Spell cooldowns −${pct(0.15 * lv)}.`, apply: (s, lv) => { s.cdMult *= 1 - 0.15 * lv; } },
  meteor: { id: "meteor", name: "Meteor", icon: "☄️", cls: "mage", kind: "active", cat: "attack",
    desc: (lv) => `Every ${S.meteor(lv).cd}s: ×${S.meteor(lv).mult} damage.` },

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

export type SkillLevels = Partial<Record<SkillId, number>>;

export function heroStats(base: Stats, levels: SkillLevels): Stats {
  const s = { ...base };
  for (const [id, lv] of Object.entries(levels) as [SkillId, number][]) {
    SKILLS[id].apply?.(s, lv);
  }
  return s;
}
