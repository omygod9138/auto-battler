import { describe, expect, it } from "vitest";
import { Battle } from "../src/core/battle";
import { mobForRound } from "../src/core/mobs";
import { chooseSkill, finishBattle, newRun, reroll, skillPool, startBattle } from "../src/core/run";
import { MAX_LEVEL, SKILLS, heroStats } from "../src/core/skills";
import { CLASSES, stats } from "../src/core/stats";

const dummy = stats({ maxHp: 1000, dmg: 0, interval: 99, range: 1.2, speed: 0 });

describe("run loop", () => {
  it("choose skill -> battle -> win -> choose again", () => {
    const s = newRun(1, "warrior");
    expect(s.offers).toHaveLength(3);
    chooseSkill(s, s.offers[0]);
    expect(s.phase).toBe("battle");
    finishBattle(s, true);
    expect(s.round).toBe(2);
    expect(s.phase).toBe("choose");
    expect(s.offers).toHaveLength(3);
  });

  it("a loss ends the run", () => {
    const s = newRun(1, "mage");
    chooseSkill(s, s.offers[0]);
    finishBattle(s, false);
    expect(s.phase).toBe("over");
  });

  it("offers only own-class or shared skills, at least two from the class", () => {
    const s = newRun(5, "ranger");
    expect(s.offers.every((id) => ["ranger", "any"].includes(SKILLS[id].cls))).toBe(true);
    expect(s.offers.filter((id) => SKILLS[id].cls === "ranger").length).toBeGreaterThanOrEqual(2);
  });

  it("picking a skill again levels it, and maxed skills leave the pool", () => {
    const s = newRun(2, "warrior");
    s.levels.vitality = MAX_LEVEL;
    expect(skillPool(s)).not.toContain("vitality");
    s.levels.might = 1;
    s.offers = ["might", "ironSkin", "thorns"];
    chooseSkill(s, "might");
    expect(s.levels.might).toBe(2);
  });

  it("rerolls are limited", () => {
    const s = newRun(3, "mage");
    for (let i = 0; i < 10; i++) reroll(s);
    expect(s.rerollsLeft).toBe(0);
  });
});

describe("mobs", () => {
  it("get stronger every round with a boss every 5th", () => {
    expect(mobForRound(2).stats.maxHp).toBeGreaterThan(mobForRound(1).stats.maxHp * 0.8);
    expect(mobForRound(5).def.boss).toBe(true);
    expect(mobForRound(6).def.boss).toBe(false);
    expect(mobForRound(11).stats.dmg).toBeGreaterThan(mobForRound(1).stats.dmg);
  });
});

describe("battle", () => {
  it("is deterministic for a seed", () => {
    const run = () => startBattle(newRun(9, "ranger")).runToEnd();
    const a = new Battle(CLASSES.ranger.base, {}, mobForRound(3).stats, 7);
    const b = new Battle(CLASSES.ranger.base, {}, mobForRound(3).stats, 7);
    a.runToEnd();
    b.runToEnd();
    expect(a.time).toBe(b.time);
    expect(a.hero.hp).toBe(b.hero.hp);
    expect(run()).toBe(run());
  });

  it("base heroes beat the round 1 mob", () => {
    for (const cls of Object.values(CLASSES)) {
      expect(new Battle(cls.base, {}, mobForRound(1).stats, 1).runToEnd()).toBe("win");
    }
  });

  it("passives change stats", () => {
    const s = heroStats(CLASSES.warrior.base, { vitality: 2, might: 1 });
    expect(s.maxHp).toBe(Math.round(160 * 1.5));
    expect(s.dmg).toBeCloseTo(12 * 1.15);
  });

  it("melee closes the gap, ranged shoots from afar", () => {
    const w = new Battle(CLASSES.warrior.base, {}, dummy, 1);
    const r = new Battle(CLASSES.ranger.base, {}, dummy, 1);
    for (let i = 0; i < 200; i++) {
      w.step();
      r.step();
    }
    expect(w.distance).toBeLessThanOrEqual(1.3 + 1e-6);
    expect(r.hero.x).toBeCloseTo(2 + (20 - 2 - 8), 0);
    expect(r.mob.hp).toBeLessThan(1000);
  });

  it("frost nova freezes and fireball burns", () => {
    const b = new Battle(CLASSES.mage.base, { frostNova: 1, fireball: 1 }, dummy, 1);
    for (let i = 0; i < 200; i++) b.step();
    expect(b.events.some((e) => e.type === "damage" && e.label === "Frost Nova")).toBe(true);
    expect(b.events.some((e) => e.type === "dot" && e.kind === "burn")).toBe(true);
  });

  it("times out as a loss", () => {
    expect(new Battle(CLASSES.warrior.base, {}, stats({ maxHp: 1e9, dmg: 0, interval: 99, range: 1, speed: 1 }), 1).runToEnd()).toBe("loss");
  });
});
