import { Rng } from "./rng";
import { SKILL_NUM as N, type SkillId, type SkillLevels } from "./skills";
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
}

export type FxKind = "slash" | "arrow" | "bolt" | "fireball" | "frost" | "meteor" | "lightning" | "bash" | "claw" | "spit";

/** What happened during a tick, for floating numbers and projectiles. */
export type BattleEvent =
  | { t: number; type: "damage"; target: Side; amount: number; crit: boolean; fx: FxKind; label?: string }
  | { t: number; type: "dot"; target: Side; amount: number; kind: "poison" | "burn" | "thorns" }
  | { t: number; type: "heal"; target: Side; amount: number }
  | { t: number; type: "dodge"; target: Side }
  | { t: number; type: "status"; target: Side; label: string };

export type Outcome = "win" | "loss";

type ActiveId = "shieldBash" | "headshot" | "fireball" | "frostNova" | "meteor";

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
  private hits = 0;
  private cds = new Map<SkillId, number>();
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
    this.hero = { side: "hero", s: heroStats, hp: heroStats.maxHp, x: ARENA.heroStart, atkTimer: 0, stun: 0, root: 0, shield: 0 };
    this.mob = { side: "mob", s: mobStats, hp: mobStats.maxHp, x: ARENA.mobStart, atkTimer: 0.4, stun: 0, root: 0, shield: 0 };
    if (this.lv("manaShield")) this.hero.shield = heroStats.maxHp * N.manaShield(this.lv("manaShield")).shield;
    this.snareX = this.lv("snare") ? ARENA.heroStart + heroStats.range + 1.5 : null;
    // Active skills start at half cooldown so the first cast comes early.
    for (const id of ["shieldBash", "headshot", "fireball", "frostNova", "meteor"] as const) {
      if (this.lv(id)) this.cds.set(id, this.cooldown(id) / 2);
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
      : id === "fireball" ? N.fireball(lv).cd : id === "frostNova" ? N.frostNova(lv).cd : N.meteor(lv).cd;
    return base * this.hero.s.cdMult;
  }

  private tickStatuses(): void {
    for (const f of [this.hero, this.mob]) {
      f.stun = Math.max(0, f.stun - TICK);
      f.root = Math.max(0, f.root - TICK);
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
    if (me.stun > 0) return;
    const dist = Math.abs(foe.x - me.x);
    if (me.side === "hero") this.castActives(dist);
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

  private castActives(dist: number): void {
    const h = this.hero;
    const ready = (id: SkillId) => this.lv(id) > 0 && this.cds.get(id) === 0;
    if (ready("frostNova") && dist <= h.s.range) {
      const n = N.frostNova(this.lv("frostNova"));
      this.cds.set("frostNova", this.cooldown("frostNova"));
      this.mob.stun = Math.max(this.mob.stun, n.freeze);
      this.spell(h.s.dmg * n.mult, "frost", "Frost Nova");
    }
    if (ready("meteor") && dist <= h.s.range) {
      this.cds.set("meteor", this.cooldown("meteor"));
      this.spell(h.s.dmg * N.meteor(this.lv("meteor")).mult, "meteor", "Meteor!");
    }
    if (ready("fireball") && dist <= h.s.range) {
      const n = N.fireball(this.lv("fireball"));
      this.cds.set("fireball", this.cooldown("fireball"));
      this.spell(h.s.dmg * n.mult, "fireball", "Fireball");
      this.addBurn(n.burn, 3);
    }
    if (ready("headshot") && dist <= h.s.range) {
      this.cds.set("headshot", this.cooldown("headshot"));
      this.physical(h.s.dmg * N.headshot(this.lv("headshot")).mult, "arrow", "Headshot!");
    }
    if (ready("shieldBash") && dist <= h.s.range) {
      const n = N.shieldBash(this.lv("shieldBash"));
      this.cds.set("shieldBash", this.cooldown("shieldBash"));
      this.physical(h.s.dmg * n.mult, "bash", "Bash!");
      this.mob.stun = Math.max(this.mob.stun, n.stun);
    }
  }

  private addBurn(dps: number, dur: number): void {
    const ig = this.lv("ignite") ? N.ignite(this.lv("ignite")) : { durMult: 1, dmgMult: 1 };
    this.burn.push({ dps: dps * this.hero.s.spellPower * ig.dmgMult, left: dur * ig.durMult });
  }

  private heroAttack(): void {
    const h = this.hero;
    this.hits++;
    let mult = 1;
    let label: string | undefined;
    if (this.hits === 1 && this.lv("charge")) {
      const c = N.charge(this.lv("charge"));
      mult *= c.mult;
      this.mob.stun = Math.max(this.mob.stun, c.stun);
      label = "Charge!";
    }
    if (this.lv("heavyStrike")) {
      const hs = N.heavyStrike(this.lv("heavyStrike"));
      if (this.hits % hs.every === 0) {
        mult *= hs.mult;
        label = "Heavy Strike!";
      }
    }
    const fx: FxKind = h.s.magic ? "bolt" : h.s.range > 2 ? "arrow" : "slash";
    const landed = this.physical(h.s.dmg * mult, fx, label);
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
    if (this.lv("static") && this.rng.next() < N.static(this.lv("static")).chance) {
      this.spell(h.s.dmg * N.static(this.lv("static")).mult, "lightning", "Zap!");
    }
    if (this.lv("ignite") && h.s.magic) this.addBurn(h.s.dmg * 0.3, 2);
  }

  /** Physical or magic basic damage. Returns false if dodged. */
  private physical(raw: number, fx: FxKind, label?: string): boolean {
    const h = this.hero;
    const m = this.mob;
    if (!h.s.magic && this.rng.next() < m.s.dodge) {
      this.emit({ t: this.time, type: "dodge", target: "mob" });
      return false;
    }
    const crit = this.rng.next() < h.s.crit;
    let dmg = raw * (crit ? h.s.critMult : 1) * this.execute();
    if (!h.s.magic) dmg = Math.max(1, dmg - m.s.armor);
    if (h.s.magic) dmg *= h.s.spellPower;
    this.dealToMob(dmg, crit, fx, label);
    return true;
  }

  /** Spells never miss and ignore armor. */
  private spell(raw: number, fx: FxKind, label: string): void {
    const crit = this.rng.next() < this.hero.s.crit;
    this.dealToMob(raw * this.hero.s.spellPower * (crit ? this.hero.s.critMult : 1) * this.execute(), crit, fx, label);
  }

  private execute(): number {
    if (!this.lv("executioner")) return 1;
    const e = N.executioner(this.lv("executioner"));
    return this.mob.hp < this.mob.s.maxHp * e.below ? e.mult : 1;
  }

  private dealToMob(dmg: number, crit: boolean, fx: FxKind, label?: string): void {
    this.mob.hp -= dmg;
    this.emit({ t: this.time, type: "damage", target: "mob", amount: dmg, crit, fx, label });
    const heal = dmg * (this.hero.s.lifesteal + (this.lv("bloodlust") ? N.bloodlust(this.lv("bloodlust")) : 0));
    this.healHero(heal);
    this.checkDeath();
  }

  private healHero(amount: number): void {
    const h = this.hero;
    const before = h.hp;
    h.hp = Math.min(h.s.maxHp, h.hp + amount);
    if (h.hp - before >= 1) this.emit({ t: this.time, type: "heal", target: "hero", amount: h.hp - before });
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
      const t = dmg * N.thorns(this.lv("thorns"));
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
