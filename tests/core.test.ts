import { describe, expect, it } from "vitest";
import { ARENA, Battle, SKILL_RECOVERY, WALL_SLAM_MULT, WALL_SLAM_TIME, WINDUP } from "../src/core/battle";
import { mobForRound } from "../src/core/mobs";
import { chooseSkill, finishBattle, newRun, reroll, skillPool, startBattle } from "../src/core/run";
import { COMBOS, MAX_LEVEL, SKILLS, SKILL_NUM, heroStats } from "../src/core/skills";
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

  it.each(["warrior", "ranger", "mage"] as const)("%s offers one attack, one defense and one passive or shared skill", (cls) => {
    for (let seed = 1; seed <= 20; seed++) {
      const s = newRun(seed, cls);
      const [atk, def, pas] = s.offers.map((id) => SKILLS[id]);
      expect([atk.cls, atk.cat]).toEqual([cls, "attack"]);
      expect([def.cls, def.cat]).toEqual([cls, "defense"]);
      expect(pas.cls === "any" || (pas.cls === cls && pas.cat === "passive")).toBe(true);
    }
  });

  it("a maxed-out slot is filled from the other skills", () => {
    const s = newRun(4, "warrior");
    for (const id of Object.keys(SKILLS) as (keyof typeof SKILLS)[]) if (SKILLS[id].cat === "attack") s.levels[id] = MAX_LEVEL;
    reroll(s);
    expect(s.offers).toHaveLength(3);
    expect(new Set(s.offers).size).toBe(3);
    expect(s.offers.some((id) => SKILLS[id].cat === "attack")).toBe(false);
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

  it("spartan kick knocks the mob back, then charge combos for +3s stun", () => {
    const b = new Battle(CLASSES.warrior.base, { charge: 1, spartanKick: 1 }, dummy, 1);
    // Away from the far wall, so the whole knockback goes to the mob.
    b.mob.x = 12;
    const x0 = b.mob.x;
    for (let i = 0; i < 600 && !b.events.some((e) => e.type === "damage" && e.skill === "spartanKick"); i++) b.step();
    while (b.mob.push !== 0) b.step();
    // The dummy never walks, so all of its movement is the knockback.
    expect(b.mob.x - x0).toBeCloseTo(SKILL_NUM.spartanKick(1).push, 5);
    // Then it's immobilized for 1s from where it landed.
    expect(b.mob.root).toBeCloseTo(SKILL_NUM.spartanKick(1).root, 5);
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
    // A Charge in the last moments may not get its Bash before the cut-off.
    const charges = count((e) => e.type === "damage" && e.skill === "charge" && e.t < 57);
    expect(charges).toBeGreaterThan(4);
    expect(count((e) => e.type === "status" && e.label === "Combo! Stun ×2" && e.t < 58)).toBe(charges);
    expect(count((e) => e.type === "status" && e.label === "Combo! Stun +3s" && e.t < 57)).toBe(charges - 1);
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

  it("shield bash then heavy strike is a combo on its own, no charge needed", () => {
    const b = new Battle(CLASSES.warrior.base, { shieldBash: 1, heavyStrike: 1 }, dummy, 1);
    for (let i = 0; i < 400; i++) b.step();
    const labels = b.events.flatMap((e) => (e.type === "status" ? [e.label] : []));
    expect(labels).toContain("Combo! +33%");
    expect(labels).not.toContain("Combo! Stun ×2");
  });

  it("shield bash winds up first and announces the combo it will land", () => {
    const b = new Battle(CLASSES.warrior.base, { charge: 1, shieldBash: 1 }, dummy, 1);
    for (let i = 0; i < 300; i++) b.step();
    const wind = b.events.find((e) => e.type === "windup" && e.skill === "shieldBash");
    const hit = b.events.find((e) => e.type === "damage" && e.skill === "shieldBash");
    expect(wind?.type === "windup" && wind.combo).toBe("Combo! Stun ×2");
    expect(hit!.t - wind!.t).toBeCloseTo(WINDUP.shieldBash!, 5);
  });

  it.each([1, 2, 3, 4, 5])("a combo only counts when its second skill is the very next attack (seed %i)", (seed) => {
    const wall = stats({ maxHp: 1e6, dmg: 0, interval: 99, range: 1.2, speed: 0 });
    const b = new Battle(CLASSES.warrior.base, { charge: 2, spartanKick: 2, shieldBash: 2, heavyStrike: 3 }, wall, seed);
    for (let i = 0; i < 59 * 20; i++) b.step();
    let prevAttack: string | null = null;
    let combos = 0;
    for (const e of b.events) {
      if (e.type === "status" && e.label.startsWith("Combo")) {
        const c = COMBOS.find((c) => c.label === e.label)!;
        expect(prevAttack).toBe(c.pair[0]);
        combos++;
      }
      // Every hero attack (hit or dodged) moves the chain along; a plain swing has no skill.
      if (e.type === "damage" && e.target === "mob") prevAttack = e.skill ?? "swing";
    }
    expect(combos).toBeGreaterThan(5);
  });

  it("heavy strike is a cooldown skill held for the swing right after shield bash", () => {
    const wall = stats({ maxHp: 1e6, dmg: 0, interval: 99, range: 1.2, speed: 0 });
    const b = new Battle(CLASSES.warrior.base, { shieldBash: 1, heavyStrike: 1 }, wall, 1);
    for (let i = 0; i < 59 * 20; i++) b.step();
    const hits = b.events.flatMap((e) => (e.type === "damage" && e.target === "mob" ? [e.skill ?? "swing"] : []));
    const heavies = hits.flatMap((s, i) => (s === "heavyStrike" ? [hits[i - 1]] : []));
    expect(heavies.length).toBeGreaterThan(5);
    expect(new Set(heavies)).toEqual(new Set(["shieldBash"]));
  });

  it("static charge fires on its cooldown", () => {
    const wall = stats({ maxHp: 1e6, dmg: 0, interval: 99, range: 4, speed: 0 });
    const b = new Battle(CLASSES.mage.base, { static: 1 }, wall, 1);
    for (let i = 0; i < 40 * 20; i++) b.step();
    const zaps = b.events.filter((e) => e.type === "damage" && e.label === "Zap!").map((e) => e.t);
    expect(zaps.length).toBeGreaterThan(5);
    for (let i = 1; i < zaps.length; i++) expect(zaps[i] - zaps[i - 1]).toBeGreaterThanOrEqual(4 - 1e-6);
  });

  it.each([1, 2, 3])("never fires a skill and another attack together (seed %i)", (seed) => {
    const wall = stats({ maxHp: 1e6, dmg: 0, interval: 99, range: 1.2, speed: 0 });
    const b = new Battle(CLASSES.warrior.base, { charge: 1, spartanKick: 1, shieldBash: 1, heavyStrike: 1 }, wall, seed);
    for (let i = 0; i < 59 * 20; i++) b.step();
    const hits = b.events.flatMap((e) => (e.type === "damage" && e.target === "mob" ? [e] : []));
    expect(hits.length).toBeGreaterThan(20);
    for (let i = 1; i < hits.length; i++) {
      const gap = hits[i].t - hits[i - 1].t;
      expect(gap).toBeGreaterThan(1e-9);
      // A normal swing (or a swing-borne Heavy Strike) waits out the recovery after a skill.
      if (hits[i - 1].skill && (!hits[i].skill || hits[i].skill === "heavyStrike")) expect(gap).toBeGreaterThanOrEqual(SKILL_RECOVERY - 1e-9);
    }
  });

  it.each([
    ["warrior", { charge: 2, spartanKick: 2, shieldBash: 2, heavyStrike: 2 }],
    ["mage", { fireball: 2, frostNova: 2, meteor: 2, static: 2 }],
    ["ranger", { headshot: 3, rapidFire: 3 }],
  ] as const)("%s never starts a skill right on top of another attack", (cls, levels) => {
    const wall = stats({ maxHp: 1e6, dmg: 0, interval: 99, range: 1.2, speed: 0 });
    const b = new Battle(CLASSES[cls].base, levels, wall, 1);
    for (let i = 0; i < 59 * 20; i++) b.step();
    // One entry per attack: extra arrows and bolts land in the same tick as their swing.
    const attacks: { t: number; skill?: string }[] = [];
    for (const e of b.events) {
      if (e.type !== "damage" || e.target !== "mob") continue;
      const last = attacks[attacks.length - 1];
      if (last && Math.abs(last.t - e.t) < 1e-9) last.skill ??= e.skill;
      else attacks.push({ t: e.t, skill: e.skill });
    }
    const bad: unknown[] = [];
    for (let i = 1; i < attacks.length; i++) {
      if (!attacks[i].skill && !attacks[i - 1].skill) continue;
      if (attacks[i].t - attacks[i - 1].t < SKILL_RECOVERY - 1e-6) bad.push([attacks[i - 1], attacks[i]]);
    }
    expect(bad).toEqual([]);
  });

  it.each([1, 2, 3])("every combo winds up and is announced one step before it lands (seed %i)", (seed) => {
    const wall = stats({ maxHp: 1e6, dmg: 0, interval: 99, range: 1.2, speed: 0 });
    const b = new Battle(CLASSES.warrior.base, { charge: 2, spartanKick: 2, shieldBash: 2, heavyStrike: 2 }, wall, seed);
    let combos = 0;
    for (let i = 0; i < 59 * 20; i++) {
      const next = b.comboNext();
      const before = b.events.length;
      b.step();
      const landed = b.events.slice(before).filter((e) => e.type === "status" && e.label.startsWith("Combo"));
      // A combo lands exactly when it was announced, and never unannounced.
      expect(landed.map((e) => (e.type === "status" ? e.label : ""))).toEqual(next ? [next] : []);
      combos += landed.length;
    }
    expect(combos).toBeGreaterThan(10);
    // Every skill hit was preceded by its wind-up.
    for (const e of b.events) {
      if (e.type !== "damage" || !e.skill) continue;
      expect(b.events.some((w) => w.type === "windup" && w.skill === e.skill && w.t < e.t)).toBe(true);
    }
  });

  it("a kicked mob can't walk for 1s after it lands", () => {
    const walker = stats({ maxHp: 1e6, dmg: 0, interval: 99, range: 1.2, speed: 2 });
    const b = new Battle(CLASSES.warrior.base, { spartanKick: 1 }, walker, 1);
    b.mob.x = 12;
    for (let i = 0; i < 600 && !b.events.some((e) => e.type === "damage" && e.skill === "spartanKick"); i++) b.step();
    while (b.mob.push !== 0) b.step();
    const landed = b.mob.x;
    for (let i = 0; i < 19; i++) b.step();
    expect(b.mob.x).toBe(landed);
    for (let i = 0; i < 5; i++) b.step();
    expect(b.mob.x).toBeLessThan(landed);
  });

  it.each([1, 2, 3])("a dodged hit never announces or lands a combo (seed %i)", (seed) => {
    const dodgy = stats({ maxHp: 1e6, dmg: 0, interval: 99, range: 1.2, speed: 0, dodge: 0.5 });
    const b = new Battle(CLASSES.warrior.base, { charge: 2, spartanKick: 2, shieldBash: 2, heavyStrike: 2 }, dodgy, seed);
    for (let i = 0; i < 59 * 20; i++) b.step();
    let combos = 0;
    let dodgedSkills = 0;
    for (const [i, e] of b.events.entries()) {
      if (e.type === "windup" && e.combo) {
        // The skill this wind-up announced must actually hit (unless the fight ends first).
        const hit = b.events.slice(i + 1).find((x) => (x.type === "damage" && x.target === "mob") || (x.type === "dodge" && x.target === "mob"));
        if (hit) expect(hit.type).toBe("damage");
      }
      if (e.type === "status" && e.label.startsWith("Combo")) {
        combos++;
        const next = b.events.slice(i + 1).find((x) => (x.type === "damage" && x.target === "mob") || (x.type === "dodge" && x.target === "mob"));
        expect(next?.type).toBe("damage");
      }
      if (e.type === "dodge" && e.target === "mob") dodgedSkills++;
    }
    expect(combos).toBeGreaterThan(2);
    expect(dodgedSkills).toBeGreaterThan(2);
  });

  it("no combo from a single skill", () => {
    const b = new Battle(CLASSES.warrior.base, { heavyStrike: 1 }, dummy, 1);
    for (let i = 0; i < 400; i++) b.step();
    expect(b.events.some((e) => e.type === "status" && e.label.startsWith("Combo"))).toBe(false);
  });

  it("combo descriptions come from the combo list", () => {
    expect(SKILLS.heavyStrike.desc(1)).toContain("after Shield Bash: +33% damage");
    expect(SKILLS.shieldBash.desc(1)).toContain("after Charge: stun ×2; Heavy Strike next: +33% damage");
    expect(SKILLS.spartanKick.desc(1)).toContain("Charge next: stun +3s");
  });

  it("times out as a loss", () => {
    expect(new Battle(CLASSES.warrior.base, {}, stats({ maxHp: 1e9, dmg: 0, interval: 99, range: 1, speed: 1 }), 1).runToEnd()).toBe("loss");
  });
});
