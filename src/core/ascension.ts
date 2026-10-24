import { SKILLS, type SkillId } from "./skills";
import type { ClassId, PathId, Stats } from "./stats";

/** Beating this round's boss lets the class ascend. */
export const ASCEND_ROUND = 20;

/** What every ascended path gets on top of its own skills: bigger numbers, and hits that stop
 * the mob regenerating for SUNDER seconds (else Cave Troll regen walls ascended runs on the fight timer). */
export const ASCEND = { dmg: 3, hp: 2.5 };
export const SUNDER = 3;

export interface PathDef {
  id: PathId;
  cls: ClassId;
  name: string;
  icon: string;
  role: string;
  desc: string;
}

export const PATHS: Record<PathId, PathDef> = {
  berserker: {
    id: "berserker", cls: "warrior", name: "Berserker", icon: "🪓", role: "Damage",
    desc: "Drops the shield for two axes. Rage fills as you hit and get hit; spend it on Whirlwind, or ride it for lifesteal and toughness.",
  },
};

/** Paths a class can ascend into. A class with none just fights on past round 20. */
export function pathsOf(cls: ClassId): PathDef[] {
  return Object.values(PATHS).filter((p) => p.cls === cls);
}

export function ascendStats(s: Stats): Stats {
  return { ...s, dmg: s.dmg * ASCEND.dmg, maxHp: Math.round(s.maxHp * ASCEND.hp) };
}

/** Class skills a path keeps but shows differently: the Berserker has no shield. */
export const RESKIN: Record<PathId, Partial<Record<SkillId, { name: string; icon: string; note?: string }>>> = {
  berserker: {
    shieldBash: { name: "Axe Hook", icon: "🪝", note: "Hooks the mob 1m toward you." },
    heavyStrike: { name: "Twin Chop", icon: "🪓" },
    ironSkin: { name: "Thick Hide", icon: "🐻" },
    thorns: { name: "Spiked Hide", icon: "🦔" },
  },
};

/** A skill's name, icon and description as this path shows it. */
export function skillLook(id: SkillId, path: PathId | null | undefined): { name: string; icon: string; desc: (lv: number) => string } {
  const def = SKILLS[id];
  const skins = path ? RESKIN[path] : undefined;
  if (!skins) return def;
  const own = skins[id];
  // Other skills' descriptions name reskinned ones (combos), so rename those too.
  const rename = (text: string) =>
    (Object.entries(skins) as [SkillId, { name: string }][]).reduce((t, [k, v]) => t.replaceAll(SKILLS[k].name, v.name), text);
  return {
    name: own?.name ?? def.name,
    icon: own?.icon ?? def.icon,
    desc: (lv) => `${rename(def.desc(lv))}${own?.note ? ` ${own.note}` : ""}`,
  };
}
