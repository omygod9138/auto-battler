import { Rng } from "./rng";
import { COMBOS, SKILL_NUM as N, type Combo, type SkillId, type SkillLevels } from "./skills";
import type { Stats } from "./stats";

export const TICK = 1 / 20;
export const TIME_LIMIT = 60;
export const ARENA = { length: 22, heroStart: 2, mobStart: 20 };

export type Side = "hero" | "mob";

export interface Fighter {
  side: Side;
  s: Stats;
  hp: number;
  x: number;
  atkTimer: number;
  stun: number;
  root: number;
  shield: number;
  /** Knockback distance still to slide, signed along x. */
  push: number;
  /** Seconds left of Wall Slam: takes extra damage. */
  vuln: number;
}

/** Wall Slam: a kick into the far wall makes the mob take this much more damage for WALL_SLAM_TIME. */
export const WALL_SLAM_MULT = 1.33;
export const WALL_SLAM_TIME = 5;

export type FxKind = "slash" | "arrow" | "bolt" | "fireball" | "frost" | "meteor" | "lightning" | "bash" | "claw" | "spit";

/** What happened during a tick, for floating numbers and projectiles. */
export type BattleEvent =
  | { t: number; type: "damage"; target: Side; amount: number; crit: boolean; fx: FxKind; label?: string; skill?: SkillId }
  | { t: number; type: "dot"; target: Side; amount: number; kind: "poison" | "burn" | "thorns" }
  | { t: number; type: "heal"; target: Side; amount: number }
  | { t: number; type: "dodge"; target: Side }
  | { t: number; type: "status"; target: Side; label: string }
  /** A skill starts winding up; its hit lands WINDUP[skill] seconds later. combo is the label it will complete. */
  | { t: number; type: "windup"; target: Side; skill: SkillId; combo?: string };

export type Outcome = "win" | "loss";

type ActiveId = "shieldBash" | "headshot" | "fireball" | "frostNova" | "meteor" | "charge" | "spartanKick" | "heavyStrike" | "static";

/** Skills that wind up before they hit, in seconds, so the art can gather momentum first. */
export const WINDUP: Partial<Record<SkillId, number>> = { shieldBash: 0.3 };

/** Seconds after a skill lands before the next attack (and after a swing before the next skill), so two never look simultaneous. */
export const SKILL_RECOVERY = 0.35;

/** Charge dash and knockback slide speeds, in arena units per second. */
const DASH_SPEED = 16;
const PUSH_SPEED = 12;

interface Dot {
  dps: number;
  left: number;
}

export class Battle {
  hero: Fighter;
  mob: Fighter;
  time = 0;
  outcome: Outcome | null = null;
  events: BattleEvent[] = [];

  private rng: Rng;
  private lv: (id: SkillId) => number;
  /** Charge has landed at least once, so held skills may follow it. */
  private charged = false;
  /** The hero is mid Charge dash. */
  dashing = false;
  /** A wound-up skill waiting to land. */
  private pending: { skill: SkillId; at: number } | null = null;
  /** The skill behind the hero's previous attack, or null if it was a plain swing; combos need it to be the very last attack. */
  private lastSkill: SkillId | null = null;
  private cds = new Map<SkillId, number>();
  /** When the hero last hit (swing or skill); skills wait SKILL_RECOVERY after it too. */
  private lastHit = -99;
  private poison: Dot[] = [];
  private burn: Dot[] = [];
  private secondWindUsed = false;
  private snareSprung = false;
  private shieldRefill = 0;
  private enraged = false;
  readonly snareX: number | null;

  constructor(
    heroStats: Stats,
    levels: SkillLevels,
    mobStats: Stats,
    seed: number,
    private mobEnrages = false,
  ) {
    this.rng = new Rng(seed);
    this.lv = (id) => levels[id] ?? 0;
    this.hero = { side: "hero", s: heroStats, hp: heroStats.maxHp, x: ARENA.heroStart, atkTimer: 0, stun: 0, root: 0, shield: 0, push: 0, vuln: 0 };
    this.mob = { side: "mob", s: mobStats, hp: mobStats.maxHp, x: ARENA.mobStart, atkTimer: 0.4, stun: 0, root: 0, shield: 0, push: 0, vuln: 0 };
    if (this.lv("manaShield")) this.hero.shield = heroStats.maxHp * N.manaShield(this.lv("manaShield")).shield;
    this.snareX = this.lv("snare") ? ARENA.heroStart + heroStats.range + 1.5 : null;
    // Active skills start at half cooldown so the first cast comes early.
    for (const id of ["shieldBash", "headshot", "fireball", "frostNova", "meteor", "spartanKick", "heavyStrike", "static"] as const) {
      if (this.lv(id)) this.cds.set(id, this.cooldown(id) / 2);
    }
    // Charge opens the fight, with Shield Bash ready to follow it.
    if (this.lv("charge")) {
      this.cds.set("charge", 0);
      if (this.lv("shieldBash")) this.cds.set("shieldBash", 0);
    }
  }

  /** Active skills with seconds left and full cooldown, for the HUD. */
  cooldowns(): { id: SkillId; left: number; total: number }[] {
    return [...this.cds.keys()].map((id) => ({ id, left: this.cds.get(id)!, total: this.cooldown(id as ActiveId) }));
  }

  get distance(): number {
    return this.mob.x - this.hero.x;
  }

  runToEnd(): Outcome {
    while (!this.outcome) this.step();
    return this.outcome;
  }

  step(): void {
    if (this.outcome) return;
    this.time += TICK;
    this.tickStatuses();
    if (!this.outcome) this.act(this.hero, this.mob);
    if (!this.outcome) this.act(this.mob, this.hero);
    if (!this.outcome && this.time >= TIME_LIMIT) this.outcome = "loss";
  }

  private emit(e: BattleEvent): void {
    this.events.push(e);
  }

  private cooldown(id: ActiveId): number {
    const lv = this.lv(id);
    const base = id === "shieldBash" ? N.shieldBash(lv).cd : id === "headshot" ? N.headshot(lv).cd
      : id === "fireball" ? N.fireball(lv).cd : id === "frostNova" ? N.frostNova(lv).cd
      : id === "charge" ? N.charge(lv).cd : id === "spartanKick" ? N.spartanKick(lv).cd
      : id === "heavyStrike" ? N.heavyStrike(lv).cd : id === "static" ? N.static(lv).cd : N.meteor(lv).cd;
    return base * this.hero.s.cdMult;
  }

  private tickStatuses(): void {
    for (const f of [this.hero, this.mob]) {
      f.stun = Math.max(0, f.stun - TICK);
      f.root = Math.max(0, f.root - TICK);
      f.vuln = Math.max(0, f.vuln - TICK);
      if (f.push !== 0) {
        const step = Math.sign(f.push) * Math.min(Math.abs(f.push), PUSH_SPEED * TICK);
        const x = Math.max(0, Math.min(ARENA.length, f.x + step));
        f.push = x === f.x + step ? f.push - step : 0;
        f.x = x;
      }
      if (f.s.regen > 0 && f.hp < f.s.maxHp) f.hp = Math.min(f.s.maxHp, f.hp + f.s.maxHp * f.s.regen * TICK);
    }
    for (const [list, kind] of [[this.poison, "poison"], [this.burn, "burn"]] as const) {
      let total = 0;
      for (const d of list) {
        total += d.dps * TICK;
        d.left -= TICK;
      }
      const alive = list.filter((d) => d.left > 0);
      list.length = 0;
      list.push(...alive);
      if (total > 0) {
        total *= this.slam();
        this.mob.hp -= total;
        // Report DoT roughly twice a second so numbers stay readable.
        if (Math.round(this.time * 20) % 10 === 0) this.emit({ t: this.time, type: "dot", target: "mob", amount: total * 10, kind });
      }
    }
    if (this.lv("manaShield")) {
      this.shieldRefill += TICK;
      const { shield, refill } = N.manaShield(this.lv("manaShield"));
      if (this.shieldRefill >= refill) {
        this.shieldRefill = 0;
        this.hero.shield = this.hero.s.maxHp * shield;
      }
    }
    for (const id of this.cds.keys()) this.cds.set(id, Math.max(0, this.cds.get(id)! - TICK));
    this.checkDeath();
  }

  private act(me: Fighter, foe: Fighter): void {
    if (me.stun > 0 || me.push !== 0) return;
    if (me.side === "hero" && this.dashing) return this.dash();
    if (me.side === "hero" && this.pending) {
      if (this.time >= this.pending.at - 1e-9) {
        this.land(this.pending.skill);
        this.recover();
      }
      return;
    }
    const dist = Math.abs(foe.x - me.x);
    // One action per tick: a skill (including the start of a dash or wind-up) replaces the swing.
    const recovered = this.time - this.lastHit >= SKILL_RECOVERY - 1e-9;
    if (me.side === "hero" && recovered && this.castActives(dist)) return this.recover();
    if (this.outcome) return;

    if (dist > me.s.range + 1e-6) {
      if (me.root > 0) return;
      const dir = me.side === "hero" ? 1 : -1;
      const step = Math.min(me.s.speed * TICK, dist - me.s.range);
      me.x += dir * step;
      if (me.side === "mob" && this.snareX !== null && !this.snareSprung && me.x <= this.snareX) {
        this.snareSprung = true;
        me.root = N.snare(this.lv("snare"));
        this.emit({ t: this.time, type: "status", target: "mob", label: "Snared!" });
      }
      return;
    }

    me.atkTimer -= TICK;
    if (me.atkTimer > 0) return;
    me.atkTimer = this.interval(me);
    if (me.side === "hero") this.heroAttack();
    else this.mobAttack();
  }

  private interval(f: Fighter): number {
    if (f.side === "mob") {
      if (this.mobEnrages && f.hp < f.s.maxHp / 2) {
        if (!this.enraged) {
          this.enraged = true;
          this.emit({ t: this.time, type: "status", target: "mob", label: "Enraged!" });
        }
        return f.s.interval / 1.5;
      }
      return f.s.interval;
    }
    const berserk = this.lv("berserk") ? N.berserk(this.lv("berserk")) * (1 - f.hp / f.s.maxHp) : 0;
    return f.s.interval / (1 + berserk);
  }

  /** Fire at most one ready active skill. Returns true if one fired: that is the hero's whole action this tick. */
  private castActives(dist: number): boolean {
    const h = this.hero;
    const ready = (id: SkillId) => this.lv(id) > 0 && this.cds.get(id) === 0;
    // Same tolerance as movement: fighters stop at range plus float error.
    const inRange = dist <= h.s.range + 1e-6;
    if (ready("frostNova") && inRange) {
      const n = N.frostNova(this.lv("frostNova"));
      this.cds.set("frostNova", this.cooldown("frostNova"));
      this.mob.stun = Math.max(this.mob.stun, n.freeze);
      this.spell(h.s.dmg * n.mult, "frost", "Frost Nova", "frostNova");
      return true;
    }
    if (ready("meteor") && inRange) {
      this.cds.set("meteor", this.cooldown("meteor"));
      this.spell(h.s.dmg * N.meteor(this.lv("meteor")).mult, "meteor", "Meteor!", "meteor");
      return true;
    }
    if (ready("fireball") && inRange) {
      const n = N.fireball(this.lv("fireball"));
      this.cds.set("fireball", this.cooldown("fireball"));
      this.spell(h.s.dmg * n.mult, "fireball", "Fireball", "fireball");
      this.addBurn(n.burn, 3);
      return true;
    }
    if (ready("headshot") && inRange) {
      this.cds.set("headshot", this.cooldown("headshot"));
      this.physical(h.s.dmg * N.headshot(this.lv("headshot")).mult, "arrow", "Headshot!", "headshot");
      return true;
    }
    // Charge only when Shield Bash can follow it.
    const bashReady = !this.lv("shieldBash") || ready("shieldBash");
    if (ready("charge") && bashReady && !inRange && dist <= N.charge(this.lv("charge")).range && this.mob.push === 0) {
      this.cds.set("charge", this.cooldown("charge"));
      this.dashing = true;
      return true;
    }
    // Hold the bash until Charge has opened the fight, so the two can combo. With Spartan Kick
    // Charge comes back every cycle, so the bash is saved for right after each Charge.
    const awaitCharge = this.lv("charge") > 0 && !this.charged;
    const saveBash = this.lv("charge") > 0 && this.lv("spartanKick") > 0 && this.lastSkill !== "charge";
    if (ready("shieldBash") && inRange && !awaitCharge && !saveBash) {
      this.cds.set("shieldBash", this.cooldown("shieldBash"));
      this.windUp("shieldBash");
      return true;
    }
    // Kick only when Charge (and the Bash after it) can follow, so the knockback sets up the combo.
    if (ready("spartanKick") && dist <= h.s.range + 1e-6 && !awaitCharge && (!this.lv("charge") || (ready("charge") && bashReady))) {
      const n = N.spartanKick(this.lv("spartanKick"));
      this.cds.set("spartanKick", this.cooldown("spartanKick"));
      this.combo("spartanKick");
      if (this.physical(h.s.dmg * n.mult, "bash", "Kick!", "spartanKick")) {
        // Against the far wall the kicker bounces back instead, so the gap still opens,
        // and the mob is slammed into the wall.
        const slide = Math.min(n.push, ARENA.length - this.mob.x);
        this.mob.push += slide;
        h.push -= n.push - slide;
        if (slide < n.push - 1e-9) {
          this.mob.vuln = WALL_SLAM_TIME;
          this.emit({ t: this.time, type: "status", target: "mob", label: "Wall Slam!" });
        }
      }
      return true;
    }
    return false;
  }

  /** Close the gap at dash speed, then hit with Charge on arrival. */
  private dash(): void {
    const h = this.hero;
    const gap = this.mob.x - h.x - h.s.range;
    h.x += Math.max(0, Math.min(DASH_SPEED * TICK, gap));
    if (gap > DASH_SPEED * TICK) return;
    this.dashing = false;
    this.charged = true;
    this.recover();
    const n = N.charge(this.lv("charge"));
    const c = this.combo("charge");
    if (this.physical(h.s.dmg * n.mult * (c?.dmgMult ?? 1), "bash", "Charge!", "charge")) {
      this.mob.stun = Math.max(this.mob.stun, n.stun * (c?.stunMult ?? 1) + (c?.stunAdd ?? 0));
    }
  }

  private recover(): void {
    this.hero.atkTimer = Math.max(this.hero.atkTimer, SKILL_RECOVERY);
  }

  /** Start a wound-up skill; it lands from act() once WINDUP has passed. */
  private windUp(skill: SkillId): void {
    this.pending = { skill, at: this.time + (WINDUP[skill] ?? 0) };
    this.emit({ t: this.time, type: "windup", target: "mob", skill, combo: this.peekCombo(skill)?.label });
  }

  private land(skill: SkillId): void {
    this.pending = null;
    const h = this.hero;
    if (skill === "shieldBash") {
      const n = N.shieldBash(this.lv("shieldBash"));
      const c = this.combo("shieldBash");
      this.physical(h.s.dmg * n.mult * (c?.dmgMult ?? 1), "bash", "Bash!", "shieldBash");
      this.mob.stun = Math.max(this.mob.stun, n.stun * (c?.stunMult ?? 1));
    }
  }

  /** Heavy Strike is held for the swing right after Shield Bash, unless the bash is further off than a whole Heavy cooldown. */
  private heavyReady(): boolean {
    if (!this.lv("heavyStrike") || this.cds.get("heavyStrike") !== 0) return false;
    if (!this.lv("shieldBash") || this.lastSkill === "shieldBash") return true;
    return this.cds.get("shieldBash")! > this.cooldown("heavyStrike");
  }

  /** The combo a skill would complete if it landed now. */
  private peekCombo(skill: SkillId): Combo | undefined {
    return COMBOS.find(({ pair }) => pair[0] === this.lastSkill && pair[1] === skill);
  }

  /** Record an attack skill and return the combo it completes, if any. */
  private combo(skill: SkillId): Combo | undefined {
    const c = this.peekCombo(skill);
    this.lastSkill = skill;
    if (c) this.emit({ t: this.time, type: "status", target: "hero", label: c.label });
    return c;
  }

  private addBurn(dps: number, dur: number): void {
    const ig = this.lv("ignite") ? N.ignite(this.lv("ignite")) : { durMult: 1, dmgMult: 1 };
    this.burn.push({ dps: dps * this.hero.s.spellPower * ig.dmgMult, left: dur * ig.durMult });
  }

  private heroAttack(): void {
    const h = this.hero;
    let mult = 1;
    let label: string | undefined;
    let skill: SkillId | undefined;
    if (this.heavyReady()) {
      this.cds.set("heavyStrike", this.cooldown("heavyStrike"));
      mult *= N.heavyStrike(this.lv("heavyStrike")).mult;
      label = "Heavy Strike!";
      skill = "heavyStrike";
    }
    const c = skill && this.combo(skill);
    // A plain swing sits between any two skills, so it breaks the chain.
    if (!skill) this.lastSkill = null;
    if (c) mult *= c.dmgMult ?? 1;
    const fx: FxKind = h.s.magic ? "bolt" : h.s.range > 2 ? "arrow" : "slash";
    const landed = this.physical(h.s.dmg * mult, fx, label, skill);
    if (!landed) return;

    if (this.lv("multishot")) {
      const m = N.multishot(this.lv("multishot"));
      for (let i = 0; i < m.arrows && !this.outcome; i++) this.physical(h.s.dmg * m.mult, "arrow");
    }
    if (this.lv("poison")) {
      const p = N.poison(this.lv("poison"));
      if (this.poison.length < p.maxStacks) this.poison.push({ dps: p.dps, left: p.dur });
      else this.poison.sort((a, b) => a.left - b.left)[0].left = p.dur;
    }
    if (this.lv("knockback") && this.rng.next() < N.knockback(this.lv("knockback")).chance) {
      this.mob.x = Math.min(ARENA.length, this.mob.x + N.knockback(1).dist);
    }
    if (this.lv("static") && this.cds.get("static") === 0) {
      this.cds.set("static", this.cooldown("static"));
      this.spell(h.s.dmg * N.static(this.lv("static")).mult, "lightning", "Zap!");
    }
    if (this.lv("ignite") && h.s.magic) this.addBurn(h.s.dmg * 0.3, 2);
  }

  /** Physical or magic basic damage. Returns false if dodged. */
  private physical(raw: number, fx: FxKind, label?: string, skill?: SkillId): boolean {
    const h = this.hero;
    const m = this.mob;
    this.lastHit = this.time;
    if (!h.s.magic && this.rng.next() < m.s.dodge) {
      this.emit({ t: this.time, type: "dodge", target: "mob" });
      return false;
    }
    const crit = this.rng.next() < h.s.crit;
    let dmg = raw * (crit ? h.s.critMult : 1) * this.execute();
    if (!h.s.magic) dmg = Math.max(1, dmg - m.s.armor);
    if (h.s.magic) dmg *= h.s.spellPower;
    this.dealToMob(dmg, crit, fx, label, skill);
    return true;
  }

  /** Spells never miss and ignore armor. */
  private spell(raw: number, fx: FxKind, label: string, skill?: SkillId): void {
    this.lastHit = this.time;
    const crit = this.rng.next() < this.hero.s.crit;
    this.dealToMob(raw * this.hero.s.spellPower * (crit ? this.hero.s.critMult : 1) * this.execute(), crit, fx, label, skill);
  }

  private execute(): number {
    if (!this.lv("executioner")) return 1;
    const e = N.executioner(this.lv("executioner"));
    return this.mob.hp < this.mob.s.maxHp * e.below ? e.mult : 1;
  }

  private slam(): number {
    return this.mob.vuln > 0 ? WALL_SLAM_MULT : 1;
  }

  private dealToMob(dmg: number, crit: boolean, fx: FxKind, label?: string, skill?: SkillId): void {
    dmg *= this.slam();
    this.mob.hp -= dmg;
    this.emit({ t: this.time, type: "damage", target: "mob", amount: dmg, crit, fx, label, skill });
    const heal = dmg * (this.hero.s.lifesteal + (this.lv("bloodlust") ? N.bloodlust(this.lv("bloodlust")) : 0));
    this.healHero(heal);
    this.checkDeath();
  }

  private healHero(amount: number): void {
    const h = this.hero;
    const before = h.hp;
    h.hp = Math.min(h.s.maxHp, h.hp + amount);
    if (h.hp - before >= 0.05) this.emit({ t: this.time, type: "heal", target: "hero", amount: h.hp - before });
  }

  private mobAttack(): void {
    const h = this.hero;
    const m = this.mob;
    if (!m.s.magic && this.rng.next() < h.s.dodge) {
      this.emit({ t: this.time, type: "dodge", target: "hero" });
      return;
    }
    const crit = this.rng.next() < m.s.crit;
    let dmg = m.s.dmg * (crit ? m.s.critMult : 1);
    if (!m.s.magic) dmg = Math.max(1, dmg - h.s.armor);
    dmg *= h.s.dmgTaken;
    if (h.shield > 0) {
      const absorbed = Math.min(h.shield, dmg);
      h.shield -= absorbed;
      dmg -= absorbed;
    }
    h.hp -= dmg;
    this.emit({ t: this.time, type: "damage", target: "hero", amount: dmg, crit, fx: m.s.range > 2 ? (m.s.magic ? "fireball" : "spit") : "claw" });
    if (this.lv("thorns") && dmg > 0) {
      const t = dmg * N.thorns(this.lv("thorns")) * this.slam();
      m.hp -= t;
      this.emit({ t: this.time, type: "dot", target: "mob", amount: t, kind: "thorns" });
    }
    if (this.lv("secondWind") && !this.secondWindUsed && h.hp > 0 && h.hp < h.s.maxHp * 0.3) {
      this.secondWindUsed = true;
      this.healHero(h.s.maxHp * N.secondWind(this.lv("secondWind")));
      this.emit({ t: this.time, type: "status", target: "hero", label: "Second Wind!" });
    }
    this.checkDeath();
  }

  private checkDeath(): void {
    if (this.outcome) return;
    if (this.mob.hp <= 0) {
      this.mob.hp = 0;
      this.outcome = "win";
    } else if (this.hero.hp <= 0) {
      this.hero.hp = 0;
      this.outcome = "loss";
    }
  }
}
