import { describe, expect, it } from "vitest";
import { ARENA, Battle, WALL_SLAM_MULT, WALL_SLAM_TIME } from "../src/core/battle";
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

  it("bloodlust reports a heal for each hit once the hero is hurt", () => {
    // Armor keeps each heal under 1 HP, which used to go unreported.
    const armored = stats({ maxHp: 1000, dmg: 0, interval: 99, range: 1.2, speed: 0, armor: 3 });
    const b = new Battle(CLASSES.warrior.base, { bloodlust: 1 }, armored, 1);
    for (let i = 0; i < 200; i++) {
      b.hero.hp = b.hero.s.maxHp / 2;
      b.step();
    }
    const hits = b.events.filter((e) => e.type === "damage" && e.target === "mob").length;
    const heals = b.events.filter((e) => e.type === "heal").length;
    expect(hits).toBeGreaterThan(3);
    expect(heals).toBe(hits);
  });

  it("frost nova freezes and fireball burns", () => {
    const b = new Battle(CLASSES.mage.base, { frostNova: 1, fireball: 1 }, dummy, 1);
    for (let i = 0; i < 200; i++) b.step();
    expect(b.events.some((e) => e.type === "damage" && e.label === "Frost Nova")).toBe(true);
    expect(b.events.some((e) => e.type === "dot" && e.kind === "burn")).toBe(true);
  });

  it("tags skill hits with their skill", () => {
    const b = new Battle(CLASSES.warrior.base, { charge: 1, heavyStrike: 1, shieldBash: 1 }, dummy, 1);
    for (let i = 0; i < 400; i++) b.step();
    const skills = new Set(b.events.flatMap((e) => (e.type === "damage" && e.skill ? [e.skill] : [])));
    expect([...skills].sort()).toEqual(["charge", "heavyStrike", "shieldBash"]);
  });

  it("charge -> shield bash -> heavy strike combos", () => {
    const b = new Battle(CLASSES.warrior.base, { charge: 1, shieldBash: 1, heavyStrike: 1 }, dummy, 1);
    let bashStun = 0;
    for (let i = 0; i < 200 && !bashStun; i++) {
      b.step();
      if (b.events.some((e) => e.type === "damage" && e.skill === "shieldBash")) bashStun = b.mob.stun;
    }
    // Lv1 bash stuns 1.2s; the combo doubles it (one tick already elapsed is fine).
    expect(bashStun).toBeGreaterThan(2.3);
    for (let i = 0; i < 200; i++) b.step();
    const combos = b.events.flatMap((e) => (e.type === "status" ? [e.label] : []));
    expect(combos).toContain("Combo! Stun ×2");
    expect(combos).toContain("Combo! +33%");
  });

  it("charge dashes in from a distance", () => {
    const b = new Battle(CLASSES.warrior.base, { charge: 1 }, dummy, 1);
    let startGap = 0;
    for (let i = 0; i < 200 && !startGap; i++) {
      b.step();
      if (b.dashing) startGap = b.distance;
    }
    expect(startGap).toBeGreaterThan(5);
    expect(startGap).toBeLessThanOrEqual(6);
    while (b.dashing) b.step();
    expect(b.events.some((e) => e.type === "damage" && e.skill === "charge")).toBe(true);
    expect(b.distance).toBeLessThanOrEqual(1.3 + 1e-6);
  });

  it("spartan kick knocks back 2m, then charge combos for +3s stun", () => {
    const b = new Battle(CLASSES.warrior.base, { charge: 1, spartanKick: 1 }, dummy, 1);
    const x0 = b.mob.x;
    for (let i = 0; i < 600 && !b.events.some((e) => e.type === "damage" && e.skill === "spartanKick"); i++) b.step();
    while (b.mob.push !== 0) b.step();
    // The dummy never walks, so all of its movement is the knockback.
    expect(b.mob.x - x0).toBeCloseTo(2, 5);
    let stun = 0;
    for (let i = 0; i < 100 && !stun; i++) {
      const before = b.events.length;
      b.step();
      if (b.events.slice(before).some((e) => e.type === "damage" && e.skill === "charge")) stun = b.mob.stun;
    }
    // Lv1 charge stuns 1s; the combo adds 3s.
    expect(stun).toBeCloseTo(4, 5);
    expect(b.events.some((e) => e.type === "status" && e.label === "Combo! Stun +3s")).toBe(true);
  });

  it.each([1, 2, 3])("every charge is followed by a shield bash combo (lv %i)", (lv) => {
    const wall = stats({ maxHp: 1e6, dmg: 0, interval: 99, range: 1.2, speed: 0 });
    const b = new Battle(CLASSES.warrior.base, { charge: lv, spartanKick: lv, shieldBash: lv, heavyStrike: lv }, wall, 1);
    // The fight drifts into the far wall; kicks must still open a gap there.
    for (let i = 0; i < 59 * 20; i++) b.step();
    const count = (pred: (e: (typeof b.events)[number]) => boolean) => b.events.filter(pred).length;
    const charges = count((e) => e.type === "damage" && e.skill === "charge");
    expect(charges).toBeGreaterThan(4);
    expect(count((e) => e.type === "status" && e.label === "Combo! Stun ×2")).toBe(charges);
    expect(count((e) => e.type === "status" && e.label === "Combo! Stun +3s")).toBe(charges - 1);
  });

  it("a kick into the far wall slams: +33% damage taken for 5s", () => {
    const wall = stats({ maxHp: 1e6, dmg: 0, interval: 99, range: 1.2, speed: 0 });
    const b = new Battle(CLASSES.warrior.base, { spartanKick: 1 }, wall, 1);
    b.mob.x = ARENA.length;
    let slamAt = -1;
    for (let i = 0; i < 600 && slamAt < 0; i++) {
      b.step();
      const e = b.events.find((e) => e.type === "status" && e.label === "Wall Slam!");
      if (e) slamAt = e.t;
    }
    expect(slamAt).toBeGreaterThan(0);
    expect(b.mob.x).toBe(ARENA.length);
    for (let i = 0; i < 8 * 20; i++) b.step();
    const plain = (from: number, to: number) =>
      b.events.flatMap((e) => (e.type === "damage" && e.target === "mob" && !e.skill && !e.crit && e.t > from && e.t <= to ? [e.amount] : []));
    const during = plain(slamAt, slamAt + WALL_SLAM_TIME - 0.1);
    // Before the next kick (7s cooldown) slams again.
    const after = plain(slamAt + WALL_SLAM_TIME + 0.1, slamAt + 6.9);
    expect(during.length).toBeGreaterThan(0);
    expect(after.length).toBeGreaterThan(0);
    for (const d of during) expect(d).toBeCloseTo(12 * WALL_SLAM_MULT, 5);
    for (const d of after) expect(d).toBeCloseTo(12, 5);
  });

  it("no combo without the opener", () => {
    const b = new Battle(CLASSES.warrior.base, { shieldBash: 1, heavyStrike: 1 }, dummy, 1);
    for (let i = 0; i < 400; i++) b.step();
    expect(b.events.some((e) => e.type === "status" && e.label.startsWith("Combo"))).toBe(false);
  });

  it("times out as a loss", () => {
    expect(new Battle(CLASSES.warrior.base, {}, stats({ maxHp: 1e9, dmg: 0, interval: 99, range: 1, speed: 1 }), 1).runToEnd()).toBe("loss");
  });
});
