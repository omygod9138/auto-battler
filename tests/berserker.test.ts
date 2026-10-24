import { describe, expect, it } from "vitest";
import { ASCEND, ASCEND_ROUND, skillLook } from "../src/core/ascension";
import { Battle } from "../src/core/battle";
import { ascend, chooseSkill, currentStats, finishBattle, newRun, skillPool } from "../src/core/run";
import { RAGE, SKILLS, SKILL_NUM, type SkillId } from "../src/core/skills";
import { CLASSES, stats, type ClassId } from "../src/core/stats";

const dummy = stats({ maxHp: 1e6, dmg: 0, interval: 99, range: 1.2, speed: 0 });

/** A run that has just beaten the ascension round's boss. */
function atAscension(cls: ClassId, levels: Partial<Record<SkillId, number>> = {}) {
  const s = newRun(5, cls);
  s.levels = { ...levels };
  s.round = ASCEND_ROUND;
  s.phase = "battle";
  finishBattle(s, true);
  return s;
}

describe("ascension", () => {
  it("beating round 20 as Warrior opens the path choice; Berserker then joins the run", () => {
    const s = atAscension("warrior");
    expect(s.phase).toBe("ascend");
    expect(s.round).toBe(ASCEND_ROUND + 1);
    const before = currentStats(s);
    ascend(s, "berserker");
    expect(s.path).toBe("berserker");
    expect(s.phase).toBe("choose");
    expect(currentStats(s).dmg).toBeCloseTo(before.dmg * ASCEND.dmg);
  });

  it("classes without a path fight on past round 20", () => {
    expect(atAscension("ranger").phase).toBe("choose");
    expect(atAscension("mage").phase).toBe("choose");
  });

  it("path skills only show up after ascending, and then unlearned Warrior skills leave the pool", () => {
    const pre = newRun(1, "warrior");
    expect(skillPool(pre).some((id) => SKILLS[id].path)).toBe(false);
    const s = atAscension("warrior", { shieldBash: 1, thorns: 1 });
    ascend(s, "berserker");
    const pool = skillPool(s);
    expect(pool).toContain("whirlwind");
    expect(pool).toContain("shieldBash");
    expect(pool).toContain("thorns");
    expect(pool).not.toContain("charge");
    expect(pool).not.toContain("ironSkin");
  });

  it("the attack card is a new Berserker skill until all four are learned", () => {
    const s = atAscension("warrior", { heavyStrike: 1 });
    ascend(s, "berserker");
    for (let i = 0; i < 4; i++) {
      const atk = s.offers[0];
      expect(SKILLS[atk].path).toBe("berserker");
      expect(s.levels[atk]).toBeUndefined();
      chooseSkill(s, atk);
      finishBattle(s, true);
    }
    expect(["whirlwind", "leapSmash", "twinFury", "recklessSwing"].every((id) => s.levels[id as SkillId])).toBe(true);
  });

  it("learned shield skills are reskinned for the Berserker", () => {
    expect(skillLook("shieldBash", "berserker").name).toBe("Axe Hook");
    expect(skillLook("heavyStrike", "berserker").desc(1)).toContain("Axe Hook");
    expect(skillLook("shieldBash", null).name).toBe("Shield Bash");
  });
});

describe("Berserker Rage", () => {
  const fight = (levels: Partial<Record<SkillId, number>>, mob = dummy) =>
    new Battle(CLASSES.warrior.base, levels, mob, 1, false, undefined, "berserker");

  it("fills on hits and drains when idle", () => {
    const b = fight({});
    b.mob.x = b.hero.x + 1;
    while (b.time < 3) b.step();
    expect(b.rage).toBeGreaterThan(0);
    const peak = b.rage;
    b.mob.x = 1e3;
    b.mob.s = { ...b.mob.s, speed: 0 };
    b.hero.s = { ...b.hero.s, speed: 0 };
    while (b.time < 3 + RAGE.idle + 2) b.step();
    expect(b.rage).toBeLessThan(peak);
  });

  it("a Warrior without the path has no Rage", () => {
    const b = new Battle(CLASSES.warrior.base, {}, dummy, 1);
    b.mob.x = b.hero.x + 1;
    while (b.time < 3) b.step();
    expect(b.rageMax).toBe(0);
    expect(b.rage).toBe(0);
  });

  it("Whirlwind spends Rage for a spin of axe hits", () => {
    const b = fight({ whirlwind: 1 });
    b.mob.x = b.hero.x + 1;
    b.rage = RAGE.max;
    while (b.time < 6) b.step();
    const hits = b.events.filter((e) => e.type === "status" || e.type === "damage").filter((e) => e.type === "damage" && e.label === "Whirlwind!");
    expect(hits.length).toBeGreaterThanOrEqual(1);
  });

  it("Undying Rage turns a lethal hit into 1 HP once", () => {
    const killer = stats({ maxHp: 1e6, dmg: 1e5, interval: 1, range: 1.2, speed: 0 });
    const b = fight({ undyingRage: 1 }, killer);
    b.mob.x = b.hero.x + 1;
    b.rage = RAGE.max;
    while (!b.outcome && b.time < 1.5) b.step();
    expect(b.events.some((e) => e.type === "status" && e.label.includes("Undying Rage"))).toBe(true);
    expect(b.frenzy).toBeGreaterThan(0);
    b.runToEnd();
    expect(b.outcome).toBe("loss");
  });

  it("Axe Hook drags a grounded mob in", () => {
    const b = fight({ shieldBash: 1 });
    b.mob.x = b.hero.x + CLASSES.warrior.base.range;
    const x0 = b.mob.x;
    while (!b.events.some((e) => e.type === "damage" && e.skill === "shieldBash")) b.step();
    for (let i = 0; i < 10; i++) b.step();
    expect(b.mob.x).toBeLessThan(x0);
  });

  it("Leap Smash closes the gap from range", () => {
    const b = fight({ leapSmash: 1 });
    b.mob.x = b.hero.x + SKILL_NUM.leapSmash(1).range;
    while (!b.events.some((e) => e.type === "damage" && e.skill === "leapSmash") && b.time < 10) b.step();
    expect(b.distance).toBeLessThanOrEqual(CLASSES.warrior.base.range + 0.6);
  });
});
