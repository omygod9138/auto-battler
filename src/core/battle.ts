import { Rng } from "./rng";
import {
  BAND_EDGE, BAND_HOLD, BAND_NAME, BAND_OF, COMBOS, DERIVED, ELEMENT_OF, MARK_TIME, OFF_BAND, SKILL_NUM as N, SPELL_HOLD, bandAt, findReaction,
  type Band, type Combo, type Derived, type Element, type Reaction, type SkillId, type SkillLevels,
} from "./skills";
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
  /** Seconds left of extra damage taken (Wall Slam, Obsidian, Glass). */
  vuln: number;
  /** How much extra while vuln lasts. */
  vulnMult: number;
}

/** Wall Slam: a kick into the far wall makes the mob take this much more damage for WALL_SLAM_TIME. */
export const WALL_SLAM_MULT = 1.33;
export const WALL_SLAM_TIME = 5;

export type FxKind = "slash" | "arrow" | "bolt" | "fireball" | "water" | "wind" | "stone" | "meteor" | "lightning" | "bash" | "claw" | "spit";

/** What happened during a tick, for floating numbers and projectiles. */
export type BattleEvent =
  | { t: number; type: "damage"; target: Side; amount: number; crit: boolean; fx: FxKind; label?: string; skill?: SkillId }
  | { t: number; type: "dot"; target: Side; amount: number; kind: "poison" | "burn" | "thorns" }
  | { t: number; type: "heal"; target: Side; amount: number }
  | { t: number; type: "dodge"; target: Side }
  | { t: number; type: "status"; target: Side; label: string; /** Name of the element reaction this announces. */ reaction?: string }
  /** A skill starts winding up; its hit lands at battle time `at`. combo is the label it will complete. */
  | { t: number; type: "windup"; target: Side; skill: SkillId; at: number; combo?: string };

export type Outcome = "win" | "loss";

type ActiveId = "shieldBash" | "fireball" | "gust" | "tidalWave" | "stoneSpike" | "charge" | "spartanKick" | "heavyStrike"
  | "longshot" | "pinningArrow" | "scatterShot" | "disengage";
/** Ranger attacks in the order they are tried: the closer the mob, the more urgent. */
const SHOTS = ["scatterShot", "pinningArrow", "longshot"] as const;
const BAND_RANK: Record<Band, number> = { close: 0, mid: 1, far: 2 };
const SPELLS = ["fireball", "gust", "tidalWave", "stoneSpike"] as const;

/** Every attack skill winds up before it hits, so the art can gather momentum and a combo can pause
 * right before the hit. Seconds; skills not listed use WINDUP_DEFAULT. Charge's wind-up is its dash. */
export const WINDUP: Partial<Record<SkillId, number>> = { shieldBash: 0.3, spartanKick: 0.2, longshot: 0.6 };
export const WINDUP_DEFAULT = 0.25;

/** Seconds after a skill lands before the next attack (and after a swing before the next skill), so two never look simultaneous. */
export const SKILL_RECOVERY = 0.35;

/** Charge dash speed, in arena units per second. */
const DASH_SPEED = 16;
/** Knockback covers this share of what's left each tick (with a floor), so it launches fast and skids to a stop. */
const PUSH_SHARE = 0.6;
const PUSH_MIN_STEP = 0.1;

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
  private pending: { skill: SkillId; at: number; onBand: boolean } | null = null;
  /** The skill behind the hero's previous attack, or null if it was a plain swing; combos need it to be the very last attack. */
  private lastSkill: SkillId | null = null;
  private cds = new Map<SkillId, number>();
  /** When the hero last hit (swing or skill); skills wait SKILL_RECOVERY after it too. */
  private lastHit = -99;
  /** Whether the wound-up skill's hit will be dodged, rolled when it starts so a doomed hit never announces a combo. */
  private nextDodge: boolean | null = null;
  private poison: Dot[] = [];
  private burn: Dot[] = [];
  private secondWindUsed = false;
  /** Seconds until a sprung Snare Trap re-arms. */
  private snareRearm = 0;
  /** Seconds left of the mob's Concussive slow, and how strong. */
  private mobSlow = { pct: 0, left: 0 };
  /** Seconds the hero dodges everything after Disengage. */
  evade = 0;
  /** When each side last walked: Poison checks the mob is on the move, and the view picks walk or idle frames. */
  private walkedAt: Record<Side, number> = { hero: -Infinity, mob: 0 };
  /** When each ready Ranger shot started waiting for its band. */
  private bandHold = new Map<SkillId, number>();
  private shieldRefill = 0;
  private enraged = false;
  /** The element waiting on the mob for another to react with it. */
  mark: { el: Element; left: number } | null = null;
  /** What the last reaction left: a ground zone at x, or a cloud or charge on the mob. */
  derived: { kind: Derived; left: number; x: number } | null = null;
  /** When each ready spell started waiting for a better one (smart-cast). */
  private holdSince = new Map<SkillId, number>();
  /** Where the armed Snare Trap sits, or null while it re-arms (or isn't learned). */
  snareX: number | null;

  constructor(
    heroStats: Stats,
    levels: SkillLevels,
    mobStats: Stats,
    seed: number,
    private mobEnrages = false,
    heroStart = ARENA.heroStart,
  ) {
    this.rng = new Rng(seed);
    this.lv = (id) => levels[id] ?? 0;
    this.hero = { side: "hero", s: heroStats, hp: heroStats.maxHp, x: heroStart, atkTimer: 0, stun: 0, root: 0, shield: 0, push: 0, vuln: 0, vulnMult: 1 };
    this.mob = { side: "mob", s: mobStats, hp: mobStats.maxHp, x: ARENA.mobStart, atkTimer: 0.4, stun: 0, root: 0, shield: 0, push: 0, vuln: 0, vulnMult: 1 };
    if (this.lv("manaShield")) this.hero.shield = heroStats.maxHp * N.manaShield(this.lv("manaShield")).shield;
    this.snareX = this.lv("snare") ? heroStart + BAND_EDGE.mid : null;
    // Active skills start at half cooldown so the first cast comes early.
    for (const id of ["shieldBash", ...SHOTS, ...SPELLS, "spartanKick", "heavyStrike"] as const) {
      if (this.lv(id)) this.cds.set(id, this.cooldown(id) / 2);
    }
    if (this.lv("disengage")) this.cds.set("disengage", 0);
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

  /** The hero has a skill that cares about range bands, so the view shows them. */
  get usesBands(): boolean {
    return (Object.keys(BAND_OF) as SkillId[]).some((id) => this.lv(id) > 0);
  }

  /** Whether the mob is on fire (Fireball burn). */
  get burning(): boolean {
    return this.burn.length > 0;
  }

  /** Whether the mob is held in place by a Mage's earth (Stone Spike or an earth reaction). */
  get stoneRooted(): boolean {
    return this.mob.root > 0 && this.lv("stoneSpike") > 0;
  }

  /** The Ranger band the mob is in now. */
  get band(): Band {
    return bandAt(this.distance);
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
    return N[id](this.lv(id)).cd * this.hero.s.cdMult;
  }

  private tickStatuses(): void {
    for (const f of [this.hero, this.mob]) {
      f.stun = Math.max(0, f.stun - TICK);
      // A root waits out a knockback slide, so "immobilized after the kick" starts once it lands.
      if (f.push === 0) f.root = Math.max(0, f.root - TICK);
      f.vuln = Math.max(0, f.vuln - TICK);
      if (f.side === "hero") this.evade = Math.max(0, this.evade - TICK);
      if (f.vuln === 0) f.vulnMult = 1;
      if (f.push !== 0) {
        const step = Math.sign(f.push) * Math.min(Math.abs(f.push), Math.max(PUSH_MIN_STEP, Math.abs(f.push) * PUSH_SHARE));
        const x = Math.max(0, Math.min(ARENA.length, f.x + step));
        f.push = x === f.x + step ? f.push - step : 0;
        f.x = x;
      }
      if (f.s.regen > 0 && f.hp < f.s.maxHp) f.hp = Math.min(f.s.maxHp, f.hp + f.s.maxHp * f.s.regen * TICK);
    }
    this.tickElements();
    this.tickTraps();
    for (const [list, kind] of [[this.poison, "poison"], [this.burn, "burn"]] as const) {
      let total = 0;
      // Poison works faster while the mob is on the move.
      const pace = kind === "poison" && this.mobWalking() ? N.poison(this.lv("poison")).walking : 1;
      for (const d of list) {
        total += d.dps * pace * TICK;
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
      // The Ranger holds its ground while the mob comes to it, so the range bands and traps play out.
      if (me.side === "hero" && me.s.range > 2 && !me.s.magic && this.mobWalking()) return;
      const dir = me.side === "hero" ? 1 : -1;
      const slow = me.side === "mob" ? Math.max(this.zone()?.slow ?? 0, this.mobSlow.left > 0 ? this.mobSlow.pct : 0) : 0;
      const step = Math.min(me.s.speed * (1 - slow) * TICK, dist - me.s.range);
      const from = me.x;
      me.x += dir * step;
      if (step > 0) this.walkedAt[me.side] = this.time;
      if (me.side === "mob" && step > 0) {
        // The trap springs as the mob walks onto it, not when a knockback or a leap moves things around it.
        if (this.snareX !== null && from > this.snareX && me.x <= this.snareX) {
          const n = N.snare(this.lv("snare"));
          this.snareX = null;
          this.snareRearm = n.rearm;
          me.root = Math.max(me.root, n.root);
          this.emit({ t: this.time, type: "status", target: "mob", label: "Snared!" });
        }
      }
      return;
    }

    me.atkTimer -= TICK;
    if (me.atkTimer > 0) return;
    me.atkTimer = this.interval(me);
    if (me.side === "mob") return this.mobAttack();
    // Heavy Strike is a skill, so its swing winds up like any other.
    if (this.heavyReady()) {
      this.cds.set("heavyStrike", this.cooldown("heavyStrike"));
      return this.windUp("heavyStrike");
    }
    this.heroAttack();
  }

  private interval(f: Fighter): number {
    if (f.side === "mob") {
      if (this.mobEnrages && f.hp < f.s.maxHp / 2) {
        if (!this.enraged) {
          this.enraged = true;
          this.emit({ t: this.time, type: "status", target: "mob", label: "Enraged!" });
        }
        return f.s.interval / 1.5 / (1 - (this.zone()?.atkSlow ?? 0));
      }
      return f.s.interval / (1 - (this.zone()?.atkSlow ?? 0));
    }
    const berserk = this.lv("berserk") ? N.berserk(this.lv("berserk")) * (1 - f.hp / f.s.maxHp) : 0;
    // Rapid Fire's bonus counts twice when the mob is Close.
    const panic = this.lv("rapidFire") && this.band === "close" ? N.rapidFire(this.lv("rapidFire")) : 0;
    return f.s.interval / (1 + berserk) / (1 + panic);
  }

  /** Fire at most one ready active skill. Returns true if one fired: that is the hero's whole action this tick. */
  private castActives(dist: number): boolean {
    const h = this.hero;
    const ready = (id: SkillId) => this.lv(id) > 0 && this.cds.get(id) === 0;
    // Same tolerance as movement: fighters stop at range plus float error.
    const inRange = dist <= h.s.range + 1e-6;
    if (inRange) {
      const spell = this.pickSpell();
      if (spell) {
        this.cds.set(spell, this.cooldown(spell));
        this.holdSince.clear();
        this.windUp(spell);
        return true;
      }
    }
    if (this.castRanger(dist, inRange)) return true;
    // Charge only when Shield Bash can follow it.
    const bashReady = !this.lv("shieldBash") || ready("shieldBash");
    if (ready("charge") && bashReady && !inRange && dist <= N.charge(this.lv("charge")).range && this.mob.push === 0) {
      this.cds.set("charge", this.cooldown("charge"));
      this.dashing = true;
      this.rollDodge();
      // The dash is Charge's wind-up; announce roughly when it will hit.
      const ticks = Math.ceil((dist - h.s.range) / (DASH_SPEED * TICK) - 1e-9);
      this.emit({ t: this.time, type: "windup", target: "mob", skill: "charge", at: this.time + ticks * TICK, combo: this.peekCombo("charge")?.label });
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
      this.cds.set("spartanKick", this.cooldown("spartanKick"));
      this.windUp("spartanKick");
      return true;
    }
    return false;
  }

  /** Ranger: Disengage when the mob gets Close, and fire a ready shot once the mob is in its band,
   * or after BAND_HOLD seconds of waiting in range, at OFF_BAND strength. */
  private castRanger(dist: number, inRange: boolean): boolean {
    const ready = (id: SkillId) => this.lv(id) > 0 && this.cds.get(id) === 0;
    const band = bandAt(dist);
    // Scatter Shot clears Close better than a leap, so Disengage waits while it is ready.
    if (ready("disengage") && band === "close" && this.hero.x > 0.5 && this.mob.push === 0 && !ready("scatterShot")) {
      const n = N.disengage(this.lv("disengage"));
      this.cds.set("disengage", this.cooldown("disengage"));
      this.hero.push -= Math.min(n.leap, this.hero.x);
      this.evade = n.evade;
      this.emit({ t: this.time, type: "status", target: "hero", label: "🤸 Disengage!" });
      return true;
    }
    if (!inRange) {
      this.bandHold.clear();
      return false;
    }
    for (const id of SHOTS) {
      if (!ready(id)) continue;
      // No point pinning a mob that is already rooted.
      if (id === "pinningArrow" && this.mob.root > 0) continue;
      const onBand = BAND_OF[id] === band;
      // A mob still walking in toward the shot's band will get there, so that wait doesn't count.
      if (!onBand && this.mobWalking() && BAND_RANK[band] > BAND_RANK[BAND_OF[id]!]) {
        this.bandHold.delete(id);
        continue;
      }
      if (!onBand) {
        if (!this.bandHold.has(id)) this.bandHold.set(id, this.time);
        if (this.time - this.bandHold.get(id)! < BAND_HOLD - 1e-9) continue;
      }
      this.bandHold.delete(id);
      this.cds.set(id, this.cooldown(id));
      this.windUp(id, onBand);
      return true;
    }
    return false;
  }

  /** Re-arm a sprung Snare Trap where Mid begins. */
  private tickTraps(): void {
    if (this.mobSlow.left > 0) this.mobSlow.left = Math.max(0, this.mobSlow.left - TICK);
    if (!this.lv("snare") || this.snareX !== null) return;
    this.snareRearm -= TICK;
    if (this.snareRearm <= 0) this.snareX = this.hero.x + BAND_EDGE.mid;
  }

  /** True while that side is stepping toward its foe (a Ranger holding its ground is not). */
  walking(side: Side): boolean {
    return this.time - this.walkedAt[side] < 2 * TICK - 1e-9;
  }

  private mobWalking(): boolean {
    return this.walking("mob") || this.mob.push !== 0;
  }

  /** Close the gap at dash speed, then hit with Charge on arrival. */
  private dash(): void {
    const h = this.hero;
    const gap = this.mob.x - h.x - h.s.range;
    h.x += Math.max(0, Math.min(DASH_SPEED * TICK, gap));
    this.walkedAt.hero = this.time;
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
  private windUp(skill: SkillId, onBand = true): void {
    const at = this.time + (WINDUP[skill] ?? WINDUP_DEFAULT);
    this.pending = { skill, at, onBand };
    this.rollDodge();
    this.emit({ t: this.time, type: "windup", target: "mob", skill, at, combo: this.peekCombo(skill)?.label });
  }

  /** Decide now whether the coming skill hit is dodged. Spells can't be dodged. */
  private rollDodge(): void {
    this.nextDodge = !this.hero.s.magic && this.rng.next() < this.mob.s.dodge;
  }

  /** The combo label the next step() will land, if any, so the view can pause right before the hit. */
  comboNext(): string | null {
    const h = this.hero;
    if (this.outcome || h.stun > 0 || h.push !== 0) return null;
    if (this.pending && this.time + TICK >= this.pending.at - 1e-9) return this.peekCombo(this.pending.skill)?.label ?? null;
    if (this.dashing && this.mob.x - h.x - h.s.range <= DASH_SPEED * TICK) return this.peekCombo("charge")?.label ?? null;
    return null;
  }

  private land(skill: SkillId): void {
    // A Ranger shot's strength is set by the band when the draw started.
    const f = this.pending?.onBand === false ? OFF_BAND : 1;
    const off = f < 1 ? ` (off ${BAND_NAME[BAND_OF[skill]!]})` : "";
    this.pending = null;
    const h = this.hero;
    if (skill === "heavyStrike") return this.heroAttack(true);
    if (skill === "fireball") {
      const n = N.fireball(this.lv("fireball"));
      this.spell(h.s.dmg * n.mult, "fireball", "Fireball", "fireball");
      this.addBurn(n.burn, 3);
    }
    if (skill === "gust") {
      const n = N.gust(this.lv("gust"));
      this.spell(h.s.dmg * n.mult, "wind", "Gust", "gust");
      this.knock(n.push);
    }
    if (skill === "tidalWave") {
      const n = N.tidalWave(this.lv("tidalWave"));
      this.spell(h.s.dmg * n.mult, "water", "Tidal Wave", "tidalWave");
      this.knock(n.push);
    }
    if (skill === "stoneSpike") {
      const n = N.stoneSpike(this.lv("stoneSpike"));
      this.spell(h.s.dmg * n.mult, "stone", "Stone Spike", "stoneSpike");
      this.mob.root = Math.max(this.mob.root, n.root);
    }
    const el = ELEMENT_OF[skill];
    if (el && !this.outcome) this.applyElement(el);
    if (skill === "longshot") this.physical(h.s.dmg * N.longshot(this.lv("longshot")).mult * f, "arrow", `Longshot!${off}`, "longshot");
    if (skill === "pinningArrow") {
      const n = N.pinningArrow(this.lv("pinningArrow"));
      if (this.physical(h.s.dmg * n.mult, "arrow", `Pinned!${off}`, "pinningArrow")) this.mob.root = Math.max(this.mob.root, n.root * f);
    }
    if (skill === "scatterShot") {
      const n = N.scatterShot(this.lv("scatterShot"));
      if (this.physical(h.s.dmg * n.mult * f, "arrow", `Scatter Shot!${off}`, "scatterShot")) this.knock(n.push * f);
    }
    if (skill === "shieldBash") {
      const n = N.shieldBash(this.lv("shieldBash"));
      const c = this.combo("shieldBash");
      this.physical(h.s.dmg * n.mult * (c?.dmgMult ?? 1), "bash", "Bash!", "shieldBash");
      this.mob.stun = Math.max(this.mob.stun, n.stun * (c?.stunMult ?? 1));
    }
    if (skill === "spartanKick") {
      const n = N.spartanKick(this.lv("spartanKick"));
      this.combo("spartanKick");
      if (this.physical(h.s.dmg * n.mult, "bash", "Kick!", "spartanKick")) {
        // Against the far wall the kicker bounces back instead, so the gap still opens,
        // and the mob is slammed into the wall.
        const slide = Math.min(n.push, ARENA.length - this.mob.x);
        this.mob.push += slide;
        this.mob.root = Math.max(this.mob.root, n.root);
        h.push -= n.push - slide;
        if (slide < n.push - 1e-9) {
          this.makeVulnerable(WALL_SLAM_MULT, WALL_SLAM_TIME);
          this.emit({ t: this.time, type: "status", target: "mob", label: "Wall Slam!" });
        }
      }
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
    if (this.nextDodge) return undefined;
    return COMBOS.find(({ pair }) => pair[0] === this.lastSkill && pair[1] === skill);
  }

  /** Record an attack skill and return the combo it completes, if any. */
  private combo(skill: SkillId): Combo | undefined {
    const c = this.peekCombo(skill);
    // A dodged skill never lands, so it can't finish a combo or start the next one.
    this.lastSkill = this.nextDodge ? null : skill;
    if (c) this.emit({ t: this.time, type: "status", target: "hero", label: c.label });
    return c;
  }

  private addBurn(dps: number, dur: number): void {
    const ig = this.lv("ignite") ? N.ignite(this.lv("ignite")) : { durMult: 1, dmgMult: 1 };
    this.burn.push({ dps: dps * this.hero.s.spellPower * ig.dmgMult, left: dur * ig.durMult });
  }

  private heroAttack(heavy = false): void {
    const h = this.hero;
    let mult = 1;
    let label: string | undefined;
    let skill: SkillId | undefined;
    if (heavy) {
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

    if (this.lv("poison")) {
      const p = N.poison(this.lv("poison"));
      if (this.poison.length < p.maxStacks) this.poison.push({ dps: p.dps, left: p.dur });
      else this.poison.sort((a, b) => a.left - b.left)[0].left = p.dur;
    }
    if (this.lv("ignite") && h.s.magic) this.addBurn(h.s.dmg * 0.3, 2);
  }

  /** Physical or magic basic damage. Returns false if dodged. */
  private physical(raw: number, fx: FxKind, label?: string, skill?: SkillId): boolean {
    const h = this.hero;
    const m = this.mob;
    this.lastHit = this.time;
    const dodged = this.nextDodge ?? (!h.s.magic && this.rng.next() < m.s.dodge);
    this.nextDodge = null;
    if (dodged) {
      this.emit({ t: this.time, type: "dodge", target: "mob" });
      return false;
    }
    const crit = this.rng.next() < h.s.crit;
    const far = this.band === "far";
    const critMult = h.s.critMult + (far && this.lv("eagleEye") ? N.eagleEye(this.lv("eagleEye")).farCrit : 0);
    let dmg = raw * (crit ? critMult : 1) * this.execute();
    if (!h.s.magic) dmg = Math.max(1, dmg - m.s.armor);
    if (far && this.lv("concussive")) {
      const c = N.concussive(this.lv("concussive"));
      this.mobSlow = { pct: c.slow, left: c.dur };
    }
    if (h.s.magic) dmg *= h.s.spellPower;
    this.dealToMob(dmg, crit, fx, label, skill);
    return true;
  }

  /** Spells never miss and ignore armor. */
  private spell(raw: number, fx: FxKind, label: string, skill?: SkillId): void {
    this.nextDodge = null;
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
    return this.mob.vuln > 0 ? this.mob.vulnMult : 1;
  }

  private makeVulnerable(mult: number, dur: number): void {
    this.mob.vulnMult = this.mob.vuln > 0 ? Math.max(this.mob.vulnMult, mult) : mult;
    this.mob.vuln = Math.max(this.mob.vuln, dur);
  }

  /** Push the mob away; the far wall stops it. */
  private knock(dist: number): void {
    this.mob.push += Math.max(0, Math.min(dist, ARENA.length - this.mob.x - this.mob.push));
  }

  /** The ground zone the mob is standing in, if any. */
  zone(): (typeof DERIVED)[Derived] | null {
    const d = this.derived;
    if (!d) return null;
    const def = DERIVED[d.kind];
    return def.zone && Math.abs(this.mob.x - d.x) <= def.zone ? def : null;
  }

  /** The derived state an element would react with now: a zone only while the mob stands in it. */
  private derivedFor(): Derived | null {
    const d = this.derived;
    if (!d) return null;
    return !DERIVED[d.kind].zone || this.zone() ? d.kind : null;
  }

  /** The reaction an element would trigger if it landed now. Derived states react before marks. */
  reactionFor(el: Element): Reaction | undefined {
    const d = this.derivedFor();
    const tier2 = d ? findReaction(d, el) : undefined;
    if (tier2) return tier2;
    return this.mark && this.mark.el !== el ? findReaction(this.mark.el, el) : undefined;
  }

  /** Smart-cast: prefer a ready spell that reacts; a spell that wouldn't react waits up to SPELL_HOLD for one that would. */
  private pickSpell(): (typeof SPELLS)[number] | null {
    const learned = SPELLS.filter((id) => this.lv(id) > 0);
    const ready = learned.filter((id) => this.cds.get(id) === 0);
    if (!ready.length) return null;
    const reacts = (id: SkillId) => this.reactionFor(ELEMENT_OF[id]!) !== undefined;
    const hit = ready.find(reacts);
    if (hit) return hit;
    for (const id of ready) if (!this.holdSince.has(id)) this.holdSince.set(id, this.time);
    const waited = this.time - Math.min(...ready.map((id) => this.holdSince.get(id)!));
    const soon = learned.some((id) => this.cds.get(id)! > 0 && this.cds.get(id)! <= SPELL_HOLD - waited && reacts(id));
    return soon ? null : ready[0];
  }

  /** Mark the mob with an element, or react with what's already there. */
  private applyElement(el: Element): void {
    const linger = N.lingering(this.lv("lingering"));
    const r = this.reactionFor(el);
    if (!r) {
      this.mark = { el, left: MARK_TIME + linger };
      return;
    }
    // A reaction uses up whatever it reacted with.
    if (this.derived && r.mix[0] === this.derived.kind) this.derived = null;
    else this.mark = null;
    const amp = N.attunement(this.lv("attunement"));
    this.emit({ t: this.time, type: "status", target: "mob", label: `${r.icon} ${r.name}!`, reaction: r.name });
    if (r.burst) this.spell(this.hero.s.dmg * r.burst * amp, r.stun ? "lightning" : r.name === "Eruption" ? "meteor" : "bolt", r.name);
    if (r.stun) this.mob.stun = Math.max(this.mob.stun, r.stun * amp);
    if (r.root) this.mob.root = Math.max(this.mob.root, r.root * amp);
    if (r.push) this.knock(r.push);
    if (r.vuln) this.makeVulnerable(r.vuln.mult, r.vuln.dur);
    if (r.burnMult) {
      const ig = this.lv("ignite") ? N.ignite(this.lv("ignite")).durMult : 1;
      for (const b of this.burn) {
        b.dps *= r.burnMult;
        b.left = Math.max(b.left, 3 * ig);
      }
    }
    if (r.leaves) this.derived = { kind: r.leaves, left: DERIVED[r.leaves].dur + linger, x: this.mob.x + this.mob.push };
  }

  private tickElements(): void {
    if (this.mark && (this.mark.left -= TICK) <= 0) this.mark = null;
    if (this.derived && (this.derived.left -= TICK) <= 0) this.derived = null;
    const burn = this.zone()?.burn;
    if (burn) {
      const amount = this.hero.s.dmg * burn * N.attunement(this.lv("attunement")) * this.hero.s.spellPower * this.slam() * TICK;
      this.mob.hp -= amount;
      if (Math.round(this.time * 20) % 10 === 0) this.emit({ t: this.time, type: "dot", target: "mob", amount: amount * 10, kind: "burn" });
    }
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
    const blind = this.derived ? DERIVED[this.derived.kind].blind ?? 0 : 0;
    if (blind && this.rng.next() < blind) {
      this.emit({ t: this.time, type: "dodge", target: "hero" });
      return;
    }
    if (this.evade > 0 || (!m.s.magic && this.rng.next() < h.s.dodge)) {
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
