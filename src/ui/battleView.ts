import { ARENA, TICK, type Battle, type BattleEvent, type FxKind, type Side } from "../core/battle";
import { AIRBORNE_LABEL, BAND_EDGE, GROUND_SLAM_LABEL, UPPERCUT_LABEL, BAND_NAME, DERIVED, ELEMENT_ICON, SKILLS, type Band, type SkillId } from "../core/skills";
import { backdrop, PIXEL } from "./backdrop";
import { drawBurnFx, drawDerivedFx, drawProjectile, drawRootFx, drawSpellFx, drawZoneFx, REACTION_FX, SPELL_FX_DUR, type SpellFx } from "./spellFx";
import { drawMeleeFx, drawStunStars, meleeFxDur, preloadMeleeFx, type MeleeFx } from "./meleeFx";
import { characterHeight, deathFall, drawCharacter, hasDeathAnim, muzzleHeight, pixelScale, type Fall, type Pose } from "./characters";

const W = 880;
const H = 320;
const GROUND = 240;
const PAD = 40;
/** Room on the right for the wall, so a mob slammed into it stays fully on screen. */
const PAD_R = 96;
const SCALE = (W - PAD - PAD_R) / ARENA.length;

const px = (x: number) => PAD + x * SCALE;
/** Characters are drawn larger than their rig units. */
const CHAR_SCALE = 1.35;
/** Visual gap so melee fighters stand face to face instead of overlapping. */
const STANDOFF = 16;
/** Left face of the far wall: just behind a mob standing at the arena's end. */
const WALL_X = W - PAD_R + STANDOFF + 30;
/** Real seconds the whole scene freezes when a combo lands: a quick beat, not a stop. */
const COMBO_PAUSE = 0.45;
/** How far the camera pushes in on a combo. */
const COMBO_ZOOM = 1.3;
/** Real seconds the camera takes to push in, and to ease back out once the hit lands. */
const ZOOM_IN = 0.12;
const ZOOM_OUT = 0.4;
/** Real seconds after a combo freeze that time ramps from slow motion back to full speed. */
const SLOWMO = 0.35;
/** Seconds a skill clip takes to play from the moment its hit lands. */
const SKILL_ANIM = 0.5;
const fx = (battle: Battle, side: Side) => px(side === "hero" ? battle.hero.x : battle.mob.x) + (side === "hero" ? -STANDOFF : STANDOFF);
const height = (id: string) => characterHeight(id) * CHAR_SCALE;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const easeOut = (k: number) => 1 - (1 - k) ** 3;
/** Combos and the hidden airborne launch share the pause, zoom, flash and banner. */
const isCombo = (label: string) => label.startsWith("Combo") || label === AIRBORNE_LABEL || label === UPPERCUT_LABEL || label === GROUND_SLAM_LABEL;
/** Uppercut Flurry slashes rise, cut flat, then come down, so a Heavy Strike taking the third reads as the downswing.
 * The slash sheet is an overhead downswing: flipped it rises, squashed it cuts across. */
const FLURRY_ANGLES: { flip?: boolean; squash?: number }[] = [{ flip: true }, { squash: 0.4 }, {}];
/** Screen px per arena unit of height: flatter than across, so a juggled mob stays on screen. */
const LIFT_SCALE = 22;
/** Screen px a fighter is lifted off the ground while airborne. */
const lift = (battle: Battle, side: Side) => (side === "mob" ? battle.mob : battle.hero).z * LIFT_SCALE;

export interface BattleLook {
  /** Character ids: a class id for the hero, a mob id for the mob. */
  hero: string;
  mob: string;
  mobBoss: boolean;
}

interface Floater {
  born: number;
  side: Side;
  text: string;
  color: string;
  size: number;
  dx: number;
  /** Extra height, to stack callouts that land together. */
  dy?: number;
}

interface Shot {
  born: number;
  from: Side;
  fx: FxKind;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  color: string;
  gravity: number;
  glyph?: string;
}

/** Flashes, rings and arcs that live for a fixed time in real (wall-clock) seconds. */
interface Burst {
  born: number;
  dur: number;
  kind: "slash" | "ring" | "bolt" | "flash";
  x: number;
  y: number;
  color: string;
  size: number;
  dir: 1 | -1;
}

interface FighterAnim {
  /** Real time of the last hit landed / taken / attack, for squash and lunge. */
  lunge: number;
  hurt: number;
  walk: number;
  moving: number;
  deathAt: number | null;
  /** The skill behind the latest hit and when it landed. */
  /** at: scene time the phase began; simAt/simEnd: battle times a wind-up runs between. */
  skill: { id: SkillId; at: number; phase: "windup" | "strike" | "full"; simAt: number; simEnd: number } | null;
}

/** Real-time (not battle-time) animation state, so idle motion keeps going while paused or after the end. */
class Scene {
  particles: Particle[] = [];
  bursts: Burst[] = [];
  floaters: Floater[] = [];
  shots: Shot[] = [];
  /** Pixel-art spell effects on the mob. */
  spells: SpellFx[] = [];
  /** Pixel-art Warrior melee effects on the mob. */
  melee: MeleeFx[] = [];
  shake = 0;
  now = 0;
  /** Wall-clock seconds, which keep running through a combo freeze. */
  real = 0;
  /** Real seconds left of a combo freeze; nothing moves while it runs. */
  freeze = 0;
  /** Real time the last freeze ended. */
  freezeEnded = -99;
  /** Battle time of the last freeze, so resuming doesn't freeze on the same step again. */
  frozeAt = -1;
  /** The mob was airborne last frame, to catch it landing. */
  mobAir = false;
  /** When the mob was last slammed into the wall, for cracks. */
  wallHit = -9;
  /** Battle time of the last combo, so the hit that lands with it can play its combo look. */
  comboAt = -1;
  /** Camera push-in on a combo, centred between the fighters (real time). */
  cam: { born: number; x: number; y: number } | null = null;
  /** Real time a combo hit landed, for the zoom punch. */
  punch = -9;
  /** Full-screen flashes in real time, so they still fade during a freeze. */
  flashes: { born: number; dur: number; color: string }[] = [];
  /** A large centred callout, for combos. */
  banner: { text: string; born: number } | null = null;
  anim: Record<Side, FighterAnim> = {
    hero: { lunge: -9, hurt: -9, walk: 0, moving: 0, deathAt: null, skill: null },
    mob: { lunge: -9, hurt: -9, walk: 0, moving: 0, deathAt: null, skill: null },
  };
  ambient: Particle[] = Array.from({ length: 40 }, () => this.flake(rand(0, H)));

  flake(y = -10): Particle {
    return { x: rand(0, W), y, vx: rand(-8, -2), vy: rand(10, 25), life: 0, max: 1e9, size: rand(1, 2.5), color: "rgba(255,255,255,0.6)", gravity: 0 };
  }

  burst(x: number, y: number, n: number, color: string, speed = 160, gravity = 380, size = 3): void {
    for (let i = 0; i < n; i++) {
      const a = rand(0, Math.PI * 2);
      const v = rand(speed * 0.3, speed);
      this.particles.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * 0.4, life: 0, max: rand(0.35, 0.8), size: rand(size * 0.5, size), color, gravity });
    }
  }

  add(b: Omit<Burst, "born">): void {
    this.bursts.push({ ...b, born: this.now });
  }
}

/** Animates a Battle on a side-view canvas, stepping the deterministic sim in real time. */
export function playBattle(
  canvas: HTMLCanvasElement,
  hud: HTMLElement,
  battle: Battle,
  look: BattleLook,
  speed: () => number,
  onEnd: () => void,
): () => void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);

  const reduced = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  const scene = new Scene();
  preloadMeleeFx();
  const heights: Record<Side, number> = { hero: height(look.hero), mob: height(look.mob) };
  const layers = new LayerCache();
  let seen = 0;
  let acc = 0;
  let last = performance.now();
  let raf = 0;
  let stopped = false;
  let endedAt: number | null = null;

  // Mob arrives in a puff of smoke.
  scene.burst(px(battle.mob.x), GROUND - 20, 24, "rgba(200,200,210,0.8)", 120, -40, 7);

  const centerY = (side: Side) => GROUND - heights[side] * 0.5;
  const sideX = (side: Side) => fx(battle, side);

  const ingest = (e: BattleEvent) => {
    const dx = rand(-16, 16);
    const target = e.target;
    const x = sideX(target);
    const y = centerY(target);
    const dir: 1 | -1 = target === "mob" ? 1 : -1;
    switch (e.type) {
      case "damage": {
        const attacker: Side = target === "mob" ? "hero" : "mob";
        const big = e.crit || e.label !== undefined;
        scene.anim[target].hurt = scene.now;
        // A slash of an Uppercut Flurry looks like a quick sword swing, not another bash.
        const flurrySlash = !!e.flurry && e.skill === "shieldBash";
        if (e.skill && !flurrySlash) {
          // After its wind-up a clip plays the strike part; a skill that never wound up plays it whole.
          const wound = scene.anim[attacker].skill?.id === e.skill && scene.anim[attacker].skill?.phase === "windup";
          scene.anim[attacker].skill = { id: e.skill, at: scene.now, phase: wound ? "strike" : "full", simAt: e.t, simEnd: e.t };
        }
        if (e.fx === "slash" && (!e.skill || flurrySlash) && target === "mob") {
          // A plain sword swing: a steel crescent across the mob, then a hit flash where the blade meets it.
          // Flurry slashes cut from different angles: up, across, then down.
          scene.anim[attacker].lunge = scene.now;
          const angle = flurrySlash ? FLURRY_ANGLES[(e.flurry! - 1) % FLURRY_ANGLES.length] : {};
          scene.melee.push({ kind: "slash", born: scene.now, big: e.crit || flurrySlash, ...angle });
          scene.melee.push({ kind: "hit", born: scene.now + 0.06, big: e.crit, dx: -12 });
        } else if (e.skill === "heavyStrike" || e.skill === "shieldBash" || e.skill === "charge" || e.skill === "spartanKick") {
          // These skills draw their own sprite effects in skillImpact.
          scene.anim[attacker].lunge = scene.now;
        } else if (e.fx === "slash" || e.fx === "claw" || e.fx === "bash") {
          scene.anim[attacker].lunge = scene.now;
          scene.add({ kind: "slash", dur: 0.22, x: x - dir * 10, y, color: e.fx === "claw" ? "#ff9f9f" : "#ffffff", size: big ? 46 : 34, dir });
          scene.burst(x, y, big ? 16 : 8, target === "mob" ? "#ffd9a0" : "#ff5a4a", 180);
        } else {
          scene.anim[attacker].lunge = scene.now;
          // Eruption bursts up from the ground, so it skips the falling meteor.
          if (!(e.fx === "meteor" && e.label && REACTION_FX[e.label])) scene.shots.push({ born: scene.now, from: attacker, fx: e.fx });
          // Reactions with pixel art draw their own hit.
          if (e.skill === "fireball" || e.skill === "gust" || e.skill === "tidalWave" || e.skill === "stoneSpike") scene.spells.push({ kind: e.skill, born: scene.now + 0.16 });
          else if (!(e.label && REACTION_FX[e.label])) impact(scene, e.fx, x, y, big);
        }
        if (e.fx === "meteor") scene.shake = Math.max(scene.shake, 14);
        else if (big) scene.shake = Math.max(scene.shake, e.crit ? 7 : 5);
        else if (target === "hero") scene.shake = Math.max(scene.shake, 3);
        const color = target === "mob" ? (e.crit ? "#ffd84a" : "#ffffff") : "#ff6b5e";
        const absorbed = e.amount < 0.5;
        scene.floaters.push({ born: scene.now, side: target, text: absorbed ? "absorbed" : `${Math.round(e.amount)}${e.crit ? "!" : ""}`, color: absorbed ? "#6fb6ff" : color, size: absorbed ? 14 : e.crit ? 26 : 18, dx });
        if (flurrySlash) scene.floaters.push({ born: scene.now, side: attacker, text: e.label ?? "", color: "#ffe9a8", size: 17, dx: 0 });
        else if (e.skill) skillImpact(scene, e.skill, dir, scene.comboAt === e.t);
        else if (e.label) scene.floaters.push({ born: scene.now, side: attacker, text: e.label, color: "#9fd3ff", size: 15, dx: 0 });
        break;
      }
      case "dot": {
        const color = e.kind === "poison" ? "#8be36b" : e.kind === "burn" ? "#ff9b3d" : "#d9c27a";
        scene.floaters.push({ born: scene.now, side: target, text: `${Math.round(e.amount)}`, color, size: 14, dx });
        if (e.kind === "poison") for (let i = 0; i < 5; i++) scene.particles.push({ x: x + rand(-14, 14), y: y + rand(0, 20), vx: rand(-8, 8), vy: rand(-50, -25), life: 0, max: rand(0.6, 1), size: rand(3, 5), color: "rgba(139,227,107,0.85)", gravity: 0, glyph: "○" });
        if (e.kind === "burn") scene.burst(x, y + 10, 8, "#ff9b3d", 60, -120, 4);
        break;
      }
      case "heal":
        // Lifesteal heals are small, so show every one; tenths keep "+0.8" from reading as "+1".
        if (e.amount >= 0.05) {
          const text = e.amount < 9.95 ? e.amount.toFixed(1).replace(/\.0$/, "") : `${Math.round(e.amount)}`;
          scene.floaters.push({ born: scene.now, side: target, text: `+${text}`, color: "#5fe07a", size: 15, dx });
          for (let i = 0; i < 4; i++) scene.particles.push({ x: x + rand(-18, 18), y: y + rand(-10, 20), vx: 0, vy: rand(-45, -25), life: 0, max: 0.8, size: 12, color: "#7dffa0", gravity: 0, glyph: "+" });
        }
        break;
      case "dodge": {
        scene.floaters.push({ born: scene.now, side: target, text: "Dodge!", color: "#b9c2cc", size: 15, dx });
        scene.anim[target].lunge = -9;
        // A dodged skill still swings through: play its follow-through as a whiff instead of holding the wind-up.
        const swinger = scene.anim[target === "mob" ? "hero" : "mob"];
        if (swinger.skill?.phase === "windup") swinger.skill = { ...swinger.skill, at: scene.now, phase: "strike" };
        swinger.lunge = scene.now;
        scene.add({ kind: "ring", dur: 0.25, x, y, color: "rgba(200,220,255,0.6)", size: 26, dir });
        break;
      }
      case "windup":
        scene.anim.hero.skill = { id: e.skill, at: scene.now, phase: "windup", simAt: e.t, simEnd: e.at };
        break;
      case "status":
        if (isCombo(e.label)) scene.comboAt = e.t;
        if (e.label === AIRBORNE_LABEL) launchFx(scene, x);
        if (e.label === GROUND_SLAM_LABEL) {
          // Driven into the floor: the ground cracks wide and a shockwave rolls out both ways.
          scene.melee.push({ kind: "groundCrack", born: scene.now, big: true, floor: true });
          scene.melee.push({ kind: "shockwave", born: scene.now + 0.04, big: true, floor: true });
          scene.burst(x, GROUND - 4, 34, "rgba(190,170,140,0.9)", 220, 300, 7);
          scene.shake = Math.max(scene.shake, 16);
        }
        if (e.label === UPPERCUT_LABEL) {
          // The bash swings up through the airborne mob: a gold rising cleave and a burst of wind.
          scene.melee.push({ kind: "heavySlash", born: scene.now, big: true, dx: -10 });
          for (let i = 0; i < 12; i++) scene.particles.push({ x: x + rand(-18, 18), y: y + rand(0, 30), vx: rand(-15, 15), vy: -rand(260, 400), life: 0, max: rand(0.15, 0.3), size: rand(2, 4), color: "rgba(255,240,200,0.9)", gravity: 0 });
        }
        if (isCombo(e.label)) {
          // The combo hit lands: a bright flash, a kick of the camera and a shake.
          scene.flashes.push({ born: scene.real, dur: 0.2, color: "255,236,170" });
          scene.punch = scene.real;
          scene.shake = Math.max(scene.shake, 10);
        }
        if (e.reaction || isCombo(e.label)) {
          // The pause before the hit already showed this banner; don't pop it again.
          if (scene.banner?.text === e.label && scene.real - scene.banner.born < COMBO_PAUSE + 0.6) break;
          scene.banner = { text: e.label, born: scene.real };
          // Combos flash on the camera punch above; reactions keep their warm flash.
          if (e.reaction) scene.add({ kind: "flash", dur: 0.25, x: 0, y: 0, color: "rgba(255,210,80,0.35)", size: 0, dir });
          const kind = e.reaction && REACTION_FX[e.reaction];
          if (kind) {
            scene.spells.push({ kind, born: scene.now });
            scene.shake = Math.max(scene.shake, 6);
          }
          break;
        }
        if (e.label === "Wall Slam!") {
          scene.wallHit = scene.now;
          scene.shake = Math.max(scene.shake, 12);
          scene.burst(WALL_X, GROUND - 50, 30, "rgba(150,140,130,0.9)", 200, 400, 6);
          // The mob smacks into the stones: a big impact star and dust against the wall.
          scene.melee.push({ kind: "kickImpact", born: scene.now, big: true, dx: 18 });
          scene.melee.push({ kind: "groundCrack", born: scene.now + 0.05, dx: 6 });
          scene.floaters.push({ born: scene.now, side: "mob", text: "🧱 Wall Slam! +33%", color: "#ff9a4d", size: 22, dx: 0, dy: 30 });
          break;
        }
        scene.floaters.push({ born: scene.now, side: target, text: e.label, color: "#c9a7ff", size: 17, dx: 0 });
        if (e.label === "Enraged!") {
          scene.shake = 10;
          scene.burst(x, y, 30, "#ff3b2f", 220, 200, 4);
        }
        if (e.label === "Second Wind!") scene.add({ kind: "ring", dur: 0.6, x, y, color: "#7dffa0", size: 70, dir });
        break;
    }
  };

  const frame = (nowMs: number) => {
    if (stopped) return;
    const dt = Math.min(0.05, (nowMs - last) / 1000);
    last = nowMs;
    scene.real += dt;
    const frozen = scene.freeze > 0;
    if (frozen) {
      scene.freeze -= dt;
      if (scene.freeze <= 0) scene.freezeEnded = scene.real;
    }
    else {
      // Coming out of a combo freeze, time eases from slow motion back to full speed.
      const slow = reduced ? 1 : Math.min(1, 0.25 + 0.75 * ((scene.real - scene.freezeEnded) / SLOWMO));
      scene.now += dt * slow;
      acc += dt * slow * speed();
    }
    while (acc >= TICK && !battle.outcome) {
      // Every combo pauses at the end of its wind-up, right before the hit: momentum gathered, swing to come.
      // Every combo pauses, zooms in on the fighters and flashes.
      const combo = battle.comboNext();
      if (combo && scene.frozeAt !== battle.time) {
        scene.freeze = COMBO_PAUSE;
        scene.frozeAt = battle.time;
        scene.shake = 0;
        scene.banner = { text: combo, born: scene.real };
        // An airborne mob is the centre of attention, so the zoom keeps it in frame; otherwise it's between the fighters.
        const up = lift(battle, "mob");
        scene.cam = up > 0
          ? { born: scene.real, x: sideX("mob") + 10, y: GROUND - up - heights.mob * 0.4 }
          : { born: scene.real, x: (sideX("hero") + sideX("mob")) / 2, y: GROUND - Math.max(heights.hero, heights.mob) * 0.55 };
        scene.flashes.push({ born: scene.real, dur: 0.14, color: "255,255,255" });
        acc = 0;
        break;
      }
      battle.step();
      acc -= TICK;
    }
    while (seen < battle.events.length) ingest(battle.events[seen++]);
    if (battle.outcome && endedAt === null) {
      endedAt = nowMs;
      const loser: Side = battle.outcome === "win" ? "mob" : "hero";
      scene.anim[loser].deathAt = scene.now;
      scene.burst(sideX(loser), centerY(loser), 40, loser === "mob" ? "#ffcf6b" : "#ff5a4a", 260, 300, 5);
      scene.shake = 9;
      if (battle.outcome === "win") {
        for (let i = 0; i < 40; i++) scene.particles.push({ x: rand(0, W), y: rand(-60, 0), vx: rand(-20, 20), vy: rand(60, 140), life: 0, max: 2.5, size: rand(3, 6), color: `hsl(${rand(0, 360)},90%,65%)`, gravity: 30 });
      }
    }
    update(scene, battle, frozen ? 0 : dt, reduced);
    draw(ctx, battle, look, scene, layers, heights, reduced);
    renderHud(hud, battle);
    // Let the death animation and last numbers play before showing the result.
    if (endedAt !== null && nowMs - endedAt > 1100) {
      onEnd();
      // Keep idling in the background so the scene stays alive behind the result.
      endedAt = Infinity;
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
  };
}

function impact(scene: Scene, fx: FxKind, x: number, y: number, big: boolean): void {
  // Impacts land when the projectile arrives.
  const at = (fn: () => void) => setTimeout(fn, 160);
  switch (fx) {
    case "arrow":
    case "spit":
      at(() => scene.burst(x, y, big ? 10 : 5, "#e8d9a6", 140));
      break;
    case "bolt":
      at(() => {
        scene.burst(x, y, 10, "#c9a7ff", 150, 0, 3);
        scene.add({ kind: "ring", dur: 0.25, x, y, color: "#b98cff", size: 24, dir: 1 });
      });
      break;
    case "fireball":
      at(() => {
        scene.burst(x, y, 26, "#ff8a2a", 200, -60, 5);
        scene.add({ kind: "ring", dur: 0.35, x, y, color: "#ffb347", size: 46, dir: 1 });
      });
      break;
    case "water":
      at(() => {
        scene.burst(x, y, 24, "#7fc8ff", 180, 300, 4);
        scene.add({ kind: "ring", dur: 0.5, x, y, color: "#5fb0ff", size: 70, dir: 1 });
      });
      break;
    case "wind":
      at(() => {
        scene.burst(x, y, 16, "rgba(210,255,240,0.8)", 220, 0, 3);
        scene.add({ kind: "ring", dur: 0.3, x, y, color: "#bff5e6", size: 40, dir: 1 });
      });
      break;
    case "stone":
      at(() => {
        scene.burst(x, GROUND - 6, 22, "rgba(160,125,80,0.95)", 200, 500, 5);
        scene.add({ kind: "ring", dur: 0.35, x, y: GROUND - 6, color: "#c9a06a", size: 50, dir: 1 });
      });
      break;
    case "lightning":
      scene.add({ kind: "bolt", dur: 0.2, x, y, color: "#fff59a", size: 1, dir: 1 });
      scene.add({ kind: "flash", dur: 0.12, x, y, color: "rgba(255,250,200,0.25)", size: 1, dir: 1 });
      scene.burst(x, y, 10, "#fff59a", 180, 0, 3);
      break;
    case "meteor":
      setTimeout(() => {
        scene.burst(x, GROUND - 10, 50, "#ff7b2a", 320, 400, 6);
        scene.add({ kind: "ring", dur: 0.6, x, y: GROUND - 10, color: "#ffcf6b", size: 110, dir: 1 });
        scene.add({ kind: "flash", dur: 0.2, x, y, color: "rgba(255,200,120,0.35)", size: 1, dir: 1 });
      }, 300);
      break;
    default:
      break;
  }
}

function update(scene: Scene, battle: Battle, dt: number, reduced: boolean): void {
  scene.shake = reduced ? 0 : Math.max(0, scene.shake - dt * 40);
  for (const p of scene.particles) {
    p.life += dt;
    p.vy += p.gravity * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    if (p.gravity > 0 && p.y > GROUND + 6 && !p.glyph) {
      p.y = GROUND + 6;
      p.vy *= -0.3;
      p.vx *= 0.6;
    }
  }
  scene.particles = scene.particles.filter((p) => p.life < p.max);
  scene.bursts = scene.bursts.filter((b) => scene.now - b.born < b.dur);
  scene.floaters = scene.floaters.filter((f) => scene.now - f.born < 1.1);
  scene.shots = scene.shots.filter((s) => scene.now - s.born < (s.fx === "meteor" ? 0.32 : 0.18));
  scene.spells = scene.spells.filter((s) => scene.now - s.born < SPELL_FX_DUR[s.kind]);
  scene.melee = scene.melee.filter((m) => scene.now - m.born < meleeFxDur(m.kind));
  for (const f of scene.ambient) {
    f.x += f.vx * dt + Math.sin(scene.now + f.y * 0.05) * 0.2;
    f.y += f.vy * dt;
    if (f.y > GROUND) Object.assign(f, scene.flake());
  }
  for (const side of ["hero", "mob"] as const) {
    const a = scene.anim[side];
    // Ask the sim rather than watching x: it steps at 20 Hz, so most frames see no change.
    const moving = !battle.outcome && battle.walking(side);
    a.moving += ((moving ? 1 : 0) - a.moving) * Math.min(1, dt * 10);
    if (moving || a.moving > 0.05) a.walk += dt * 9;
    const f = side === "hero" ? battle.hero : battle.mob;
    const dashing = side === "hero" && battle.dashing;
    if (dashing) a.walk += dt * 14;
    if (side === "mob") {
      const air = f.z > 0;
      if (scene.mobAir && !air && battle.mob.hp > 0) landFx(scene, px(f.x) + STANDOFF);
      scene.mobAir = air;
      // Wind streaks trail a mob flying through the air.
      if (air && !reduced) scene.particles.push({ x: px(f.x) + STANDOFF + rand(-14, 14), y: GROUND - lift(battle, "mob") - rand(10, 60), vx: f.push !== 0 ? -rand(120, 220) : rand(-20, 20), vy: f.vz > 0 ? rand(60, 140) : -rand(20, 60), life: 0, max: rand(0.15, 0.3), size: rand(2, 4), color: "rgba(255,255,255,0.8)", gravity: 0 });
    }
    // Dust kicks up behind a dash and under a knocked-back fighter.
    if ((dashing || f.push !== 0) && f.z === 0 && !reduced) {
      const fx0 = px(f.x);
      for (let i = 0; i < 2; i++) scene.particles.push({ x: fx0 + rand(-6, 6), y: GROUND - rand(0, 6), vx: (dashing ? -1 : 1) * rand(30, 90), vy: rand(-40, -10), life: 0, max: rand(0.3, 0.6), size: rand(3, 6), color: "rgba(190,170,140,0.7)", gravity: 60 });
    }
  }
}

function draw(
  ctx: CanvasRenderingContext2D,
  battle: Battle,
  look: BattleLook,
  scene: Scene,
  layers: LayerCache,
  heights: Record<Side, number>,
  reduced: boolean,
): void {
  const t = scene.now;
  ctx.save();
  const cam = reduced ? null : camera(scene);
  if (cam) {
    ctx.translate(cam.x, cam.y);
    ctx.scale(cam.z, cam.z);
    ctx.translate(-cam.x, -cam.y);
  }
  ctx.save();
  if (scene.shake > 0) ctx.translate(rand(-scene.shake, scene.shake), rand(-scene.shake, scene.shake) * 0.6);
  drawBackground(ctx, scene, t, look.mobBoss);

  if (battle.usesBands) drawBands(ctx, battle);

  if (battle.snareX !== null) {
    const sx = px(battle.snareX);
    ctx.font = "22px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("🪤", sx, GROUND + 20 + (battle.mob.root > 0 ? Math.sin(t * 40) * 2 : 0));
  }

  drawElements(ctx, battle, t, heights.mob);

  for (const side of ["hero", "mob"] as const) {
    const f = side === "hero" ? battle.hero : battle.mob;
    const a = scene.anim[side];
    const facing = side === "hero" ? 1 : -1;
    const melee = f.s.range <= 2;
    // Melee lunges forward then eases back; ranged only rocks slightly.
    const lk = (t - a.lunge) / 0.28;
    const attack = lk >= 0 && lk < 1 ? lk : -1;
    const skillHit = a.skill !== null && a.skill.phase !== "windup" && t - a.skill.at < 0.3;
    const lunge = attack >= 0 ? Math.sin(attack * Math.PI) * (melee ? (skillHit ? 24 : 12) : 3) * facing : 0;
    const hk = (t - a.hurt) / 0.25;
    const hurt = hk >= 0 && hk < 1 ? hk : -1;
    const recoil = hurt >= 0 ? (1 - hurt) * -7 * facing : 0;
    const x = fx(battle, side) + lunge + recoil;
    const enraged = side === "mob" && look.mobBoss && f.hp < f.s.maxHp / 2 && f.hp > 0;
    const frozen = side === "mob" && f.stun > 0 && battle.events.some((e) => e.type === "status" && e.label.endsWith("Obsidian!") && battle.time - e.t < 3);
    // Electrocuted: the mob strobes white while the current runs through it.
    const shocked = side === "mob" && f.stun > 0 && battle.events.some((e) => e.type === "status" && e.label.endsWith("Electrocute!") && battle.time - e.t < 1.4);
    const id = side === "hero" ? look.hero : look.mob;
    const layer = layers.get(side);
    const death = a.deathAt === null ? null : Math.min(1, (t - a.deathAt) / 0.7);
    layer.draw(id, {
      t: reduced ? 0 : t + (side === "mob" ? 1.7 : 0),
      walk: a.walk,
      moving: a.moving,
      attack,
      windup: windup(battle, side),
      hurt,
      death: death ?? undefined,
      skill: skillPose(a.skill, battle, t),
    });
    drawFighter(ctx, layer, {
      x, facing, h: heights[side],
      flash: shocked && Math.floor(t * 12) % 3 === 0 ? 0.8 : hurt >= 0 && hurt < 0.5 ? 1 - hurt * 2 : 0,
      death,
      animatedDeath: hasDeathAnim(id),
      fall: deathFall(id),
      zoom: pixelScale(id),
      squash: hurt >= 0 ? 1 - Math.sin(hurt * Math.PI) * 0.08 : 1,
      frozen,
      aura: enraged ? "rgba(255,60,40,0.35)" : side === "hero" && f.shield > 0 ? "rgba(111,182,255,0.28)" : null,
      t,
      lift: lift(battle, side),
      // Thrown head over heels away from the hit: back on the way up, levelling out to land.
      tilt: side === "mob" && f.z > 0 ? -facing * Math.min(1, f.z / 1.5) * (f.vz > 0 ? 0.9 : 0.5) : 0,
    });
    if (f.vuln > 0) {
      // Wall Slam debuff marker beside the health bar.
      ctx.font = "16px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("🧱", x + 42, GROUND - heights[side] - 10 - lift(battle, side));
    }
    drawBars(ctx, x, heights[side], f.hp / f.s.maxHp, side === "hero" ? "#5fe07a" : "#ff7a6b", f.shield / f.s.maxHp, f.stun > 0, f.root > 0, t, lift(battle, side));
  }

  drawShots(ctx, scene, battle, look);
  if (battle.stoneRooted && battle.mob.hp > 0) drawRootFx(ctx, fx(battle, "mob"), GROUND, t);
  if (battle.burning && battle.mob.hp > 0) drawBurnFx(ctx, fx(battle, "mob"), GROUND, heights.mob, t);
  drawSpellFx(ctx, scene.spells, t, fx(battle, "mob"), GROUND, heights.mob);
  drawMeleeFx(ctx, scene.melee, t, fx(battle, "mob"), GROUND, heights.mob, lift(battle, "mob"));
  drawBursts(ctx, scene);
  drawParticles(ctx, scene.particles);
  ctx.restore();

  for (const b of scene.bursts) {
    if (b.kind !== "flash") continue;
    ctx.fillStyle = b.color;
    ctx.globalAlpha = 1 - (t - b.born) / b.dur;
    ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 1;
  }
  drawFloaters(ctx, scene, battle, heights);
  ctx.restore();
  drawFlashes(ctx, scene);
  drawBanner(ctx, scene);

  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = "13px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`${battle.time.toFixed(1)}s`, 10, 18);
}

function skillPose(s: FighterAnim["skill"], battle: Battle, t: number): Pose["skill"] {
  if (!s) return undefined;
  // The wind-up follows battle time, so it holds still through a freeze and ends as the hit lands.
  // It reaches its last wind-up frame on the step before the hit, where a combo pause holds it.
  if (s.phase === "windup") {
    // Safety net: a wind-up whose hit never came (e.g. the fight ended) lets go shortly after.
    if (battle.time > s.simEnd + 0.3) return undefined;
    const span = s.simEnd - s.simAt - TICK;
    return { id: s.id, phase: s.phase, p: span <= 1e-9 || battle.time >= s.simEnd - TICK - 1e-9 ? 1 : Math.min(1, (battle.time - s.simAt) / span) };
  }
  return t - s.at < SKILL_ANIM ? { id: s.id, phase: s.phase, p: (t - s.at) / SKILL_ANIM } : undefined;
}

/** Per-skill impact: a big name callout plus effects loud enough to read at a glance. */
const BAND_COLOR: Record<Band, string> = { close: "255,123,123", mid: "255,209,102", far: "110,231,160" };

/** Ranger range bands as strips on the ground in front of the hero; the mob's band glows brighter. */
function drawBands(ctx: CanvasRenderingContext2D, battle: Battle): void {
  const h = battle.hero.x;
  const edges: [Band, number, number][] = [
    ["close", 0, BAND_EDGE.close], ["mid", BAND_EDGE.close, BAND_EDGE.mid], ["far", BAND_EDGE.mid, battle.hero.s.range],
  ];
  ctx.save();
  ctx.font = "bold 11px sans-serif";
  ctx.textAlign = "center";
  for (const [band, a, b] of edges) {
    const x0 = px(Math.min(ARENA.length, h + a));
    const x1 = px(Math.min(ARENA.length, h + b));
    const on = battle.band === band && battle.distance <= battle.hero.s.range + 1e-6;
    ctx.fillStyle = `rgba(${BAND_COLOR[band]},${on ? 0.55 : 0.22})`;
    ctx.fillRect(x0 + 1, GROUND + 2, x1 - x0 - 2, 10);
    ctx.fillStyle = `rgba(${BAND_COLOR[band]},${on ? 1 : 0.6})`;
    ctx.fillText(BAND_NAME[band], (x0 + x1) / 2, GROUND + 38);
  }
  ctx.restore();
}

function skillImpact(scene: Scene, skill: SkillId, dir: 1 | -1, combo: boolean): void {
  const k = SKILLS[skill];
  scene.floaters.push({ born: scene.now, side: dir === 1 ? "hero" : "mob", text: `${k.icon} ${k.name}`, color: "#ffd34d", size: 24, dx: 0 });
  switch (skill) {
    case "shieldBash":
      // The shield's face meets the mob: a white flash and a ring of force, then stun stars circle its head.
      // As the Charge → Bash combo it flashes the screen and hits bigger.
      scene.melee.push({ kind: "shieldBash", born: scene.now, big: combo, dx: -14 });
      scene.melee.push({ kind: "hit", born: scene.now + 0.04, dx: -14 });
      if (combo) scene.add({ kind: "flash", dur: 0.18, x: 0, y: 0, color: "rgba(220,240,255,0.45)", size: 0, dir });
      scene.shake = Math.max(scene.shake, combo ? 13 : 9);
      break;
    case "heavyStrike":
      // A gold overhead cleave, then the ground cracks under the blow. As a combo finisher it cuts
      // bigger and a shockwave rolls out along the floor.
      scene.melee.push({ kind: "heavySlash", born: scene.now, big: combo, dx: -20 });
      scene.melee.push({ kind: "hit", born: scene.now + 0.05, big: combo, dx: -12 });
      scene.melee.push({ kind: "groundCrack", born: scene.now + 0.1, big: combo });
      if (combo) scene.melee.push({ kind: "shockwave", born: scene.now + 0.1, big: true });
      scene.shake = Math.max(scene.shake, combo ? 14 : 10);
      break;
    case "charge":
      // The dash ends in a gold lance streak through the hero's path and a burst where it lands.
      // As the Kick → Charge combo it hits bigger with a gold screen flash.
      scene.melee.push({ kind: "chargeStreak", born: scene.now, big: combo, dx: combo ? -80 : -56 });
      scene.melee.push({ kind: "hit", born: scene.now + 0.04, big: combo, dx: -14 });
      if (combo) scene.add({ kind: "flash", dur: 0.18, x: 0, y: 0, color: "rgba(255,210,80,0.4)", size: 0, dir });
      scene.shake = Math.max(scene.shake, combo ? 14 : 11);
      break;
    case "spartanKick":
      // A cream star where the boot lands, then a puff of smoke as the mob is sent flying.
      scene.melee.push({ kind: "kickImpact", born: scene.now, dx: -12 });
      scene.shake = Math.max(scene.shake, 8);
      break;
    default:
      scene.shake = Math.max(scene.shake, 5);
  }
}

/** Hidden airborne launch: the boot or shoulder lands big, a ring bursts off the floor, and dust and wind shoot up. */
function launchFx(scene: Scene, x: number): void {
  scene.melee.push({ kind: "kickImpact", born: scene.now, big: true, dx: -6 });
  scene.melee.push({ kind: "shockwave", born: scene.now + 0.03, big: true, floor: true });
  scene.burst(x, GROUND - 4, 26, "rgba(200,190,170,0.85)", 160, -260, 6);
  for (let i = 0; i < 14; i++) scene.particles.push({ x: x + rand(-22, 22), y: GROUND - rand(0, 40), vx: rand(-15, 15), vy: -rand(260, 420), life: 0, max: rand(0.18, 0.32), size: rand(2, 4), color: "rgba(255,255,255,0.9)", gravity: 0 });
  scene.shake = Math.max(scene.shake, 12);
}

/** The airborne mob crashes back down: the ground cracks and a dust ring rolls out. */
function landFx(scene: Scene, x: number): void {
  scene.melee.push({ kind: "groundCrack", born: scene.now, floor: true });
  scene.melee.push({ kind: "shockwave", born: scene.now, floor: true });
  scene.burst(x, GROUND - 4, 22, "rgba(190,170,140,0.85)", 150, 300, 6);
  scene.shake = Math.max(scene.shake, 9);
}

/** Mage element state: ground zones under the mob, clouds around it, and the waiting mark above it. */
function drawElements(ctx: CanvasRenderingContext2D, battle: Battle, t: number, mobH: number): void {
  const d = battle.derived;
  if (d) {
    const def = DERIVED[d.kind];
    const fade = Math.min(1, d.left / 0.5);
    if (def.zone) {
      const x0 = px(d.x - def.zone);
      const x1 = px(d.x + def.zone);
      if (!drawZoneFx(ctx, d.kind, x0, x1, GROUND, t, fade)) {
        const color = d.kind === "lava" ? "255,90,30" : "120,85,50";
        ctx.fillStyle = `rgba(${color},${0.55 * fade})`;
        ctx.beginPath();
        ctx.ellipse((x0 + x1) / 2, GROUND + 6, (x1 - x0) / 2, 9, 0, 0, Math.PI * 2);
        ctx.fill();
        if (d.kind === "lava") {
          ctx.fillStyle = `rgba(255,200,80,${0.5 * fade * (0.6 + 0.4 * Math.sin(t * 6))})`;
          ctx.beginPath();
          ctx.ellipse((x0 + x1) / 2, GROUND + 6, (x1 - x0) / 3, 4, 0, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else if (!drawDerivedFx(ctx, d.kind, fx(battle, "mob"), GROUND, mobH, t, fade)) {
      ctx.globalAlpha = fade;
      ctx.font = "26px sans-serif";
      ctx.textAlign = "center";
      const mx = fx(battle, "mob");
      ctx.fillText(def.icon, mx + Math.sin(t * 3) * 14, GROUND - 110);
      ctx.globalAlpha = 1;
    }
  }
  if (battle.mark) {
    ctx.globalAlpha = Math.min(1, battle.mark.left / 0.5);
    ctx.font = "18px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(ELEMENT_ICON[battle.mark.el], fx(battle, "mob") + 26, GROUND - 92 + Math.sin(t * 4) * 3);
    ctx.globalAlpha = 1;
  }
}

/** The combo camera: pushes in fast while frozen, punches on the hit, then eases back out. */
function camera(scene: Scene): { x: number; y: number; z: number } | null {
  const c = scene.cam;
  if (!c) return null;
  let k: number;
  if (scene.freeze > 0) k = easeOut(Math.min(1, (scene.real - c.born) / ZOOM_IN));
  else {
    const out = (scene.real - Math.max(scene.freezeEnded, c.born)) / ZOOM_OUT;
    if (out >= 1) {
      scene.cam = null;
      return null;
    }
    k = 1 - out * out * (3 - 2 * out);
  }
  const pk = (scene.real - scene.punch) / 0.2;
  const punch = pk >= 0 && pk < 1 ? 0.06 * (1 - pk) : 0;
  return { x: c.x, y: c.y, z: 1 + (COMBO_ZOOM - 1) * k + punch };
}

function drawFlashes(ctx: CanvasRenderingContext2D, scene: Scene): void {
  scene.flashes = scene.flashes.filter((f) => scene.real - f.born < f.dur);
  for (const f of scene.flashes) {
    ctx.fillStyle = `rgba(${f.color},${0.55 * (1 - (scene.real - f.born) / f.dur)})`;
    ctx.fillRect(0, 0, W, H);
  }
}

function drawBanner(ctx: CanvasRenderingContext2D, scene: Scene): void {
  const b = scene.banner;
  if (!b) return;
  const age = scene.real - b.born;
  if (scene.freeze > 0) {
    // Darken the edges of the frozen frame so the eye goes to the fighters.
    const g = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, W * 0.6);
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, "rgba(0,0,0,0.45)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }
  if (age > COMBO_PAUSE + 0.6) {
    scene.banner = null;
    return;
  }
  const pop = age < 0.15 ? 0.5 + (age / 0.15) * 0.7 : age < 0.25 ? 1.2 - ((age - 0.15) / 0.1) * 0.2 : 1;
  ctx.globalAlpha = Math.max(0, 1 - Math.max(0, age - COMBO_PAUSE - 0.1) * 2);
  ctx.textAlign = "center";
  ctx.font = `900 ${Math.round(34 * pop)}px system-ui, sans-serif`;
  ctx.lineWidth = 6;
  ctx.strokeStyle = "rgba(60,20,0,0.85)";
  ctx.strokeText(b.text, W / 2, 70);
  ctx.fillStyle = "#ffd34d";
  ctx.fillText(b.text, W / 2, 70);
  ctx.globalAlpha = 1;
}

/** How far into the swing before the next hit, so attack art can wind up ahead of the damage. */
function windup(battle: Battle, side: Side): number | undefined {
  const me = side === "hero" ? battle.hero : battle.mob;
  const foe = side === "hero" ? battle.mob : battle.hero;
  if (battle.outcome || me.stun > 0 || Math.abs(foe.x - me.x) > me.s.range + 1e-6) return undefined;
  const lead = Math.min(0.3, me.s.interval * 0.5);
  return me.atkTimer < lead ? 1 - me.atkTimer / lead : undefined;
}

function drawBackground(ctx: CanvasRenderingContext2D, scene: Scene, t: number, boss: boolean): void {
  backdrop(W, H, GROUND, WALL_X, boss).draw(ctx, t);
  drawWall(ctx, scene, t);

  // Snow falls in whole art pixels so it matches the backdrop.
  ctx.fillStyle = "rgba(255,255,255,0.7)";
  for (const f of scene.ambient) ctx.fillRect(Math.round(f.x / PIXEL) * PIXEL, Math.round(f.y / PIXEL) * PIXEL, f.size > 1.8 ? PIXEL : 2, f.size > 1.8 ? PIXEL : 2);
}

/** Cracks in the far wall (drawn by the backdrop) after Spartan Kick slams the mob into it. */
function drawWall(ctx: CanvasRenderingContext2D, scene: Scene, t: number): void {
  const x0 = WALL_X;
  const k = (t - scene.wallHit) / 1.5;
  if (k >= 0 && k < 1) {
    ctx.globalAlpha = 1 - k;
    ctx.strokeStyle = "#1c1b1f";
    ctx.lineWidth = 2.5;
    const cy = GROUND - 50;
    for (const [dx, dy] of [[-10, -26], [-6, 22], [8, -18], [10, 30], [-12, 4]]) {
      ctx.beginPath();
      ctx.moveTo(x0 + 4, cy);
      ctx.lineTo(x0 + 4 + dx * 0.5, cy + dy * 0.5);
      ctx.lineTo(x0 + 4 + dx, cy + dy);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

interface FighterPose {
  x: number;
  facing: 1 | -1;
  h: number;
  flash: number;
  death: number | null;
  /** The character plays its own death frames, so only fade it. */
  animatedDeath: boolean;
  fall: Fall;
  /** Extra enlargement of the layer; sprite art is drawn 1:1 there and scaled once here. */
  zoom: number;
  squash: number;
  frozen: boolean;
  aura: string | null;
  t: number;
  /** Screen px off the ground, and a tumble in radians, while airborne. */
  lift: number;
  tilt: number;
}

function drawFighter(ctx: CanvasRenderingContext2D, layer: Layer, p: FighterPose): void {
  // The shadow stays on the floor and shrinks as the fighter rises.
  const shadow = 1 / (1 + p.lift / 80);
  ctx.fillStyle = `rgba(0,0,0,${0.3 * shadow})`;
  ctx.beginPath();
  ctx.ellipse(p.x, GROUND + 3, Math.max(16, p.h * 0.35) * shadow, 6 * shadow, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(p.x, GROUND - p.lift);
  if (p.tilt) {
    // Tumble about the body's middle.
    ctx.translate(0, -p.h / 2);
    ctx.rotate(p.tilt);
    ctx.translate(0, p.h / 2);
  }
  if (p.death !== null) {
    // Fall backwards onto the ground, unless the clip plays the fall itself.
    if (!p.animatedDeath) {
      const e = easeOut(p.death);
      const { turn, centre, rest } = p.fall;
      ctx.translate(0, -p.h * (centre + (rest - centre) * e));
      ctx.rotate(-p.facing * e * turn);
      ctx.translate(0, p.h * centre);
    }
    ctx.globalAlpha = 1 - p.death * 0.65;
  }
  ctx.scale(p.facing * (2 - p.squash) * CHAR_SCALE, p.squash * CHAR_SCALE);
  if (p.aura) {
    const h = p.h / CHAR_SCALE;
    const g = ctx.createRadialGradient(0, -h / 2, 4, 0, -h / 2, h * 0.85);
    g.addColorStop(0, p.aura);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, -h / 2, h * (0.85 + Math.sin(p.t * 6) * 0.05), 0, Math.PI * 2);
    ctx.fill();
  }
  if (p.zoom !== 1) {
    ctx.scale(p.zoom, p.zoom);
    ctx.imageSmoothingEnabled = false;
  }
  ctx.drawImage(layer.canvas, -Layer.OX, -Layer.OY);
  if (p.flash > 0) {
    ctx.globalAlpha = p.flash * 0.85;
    ctx.drawImage(layer.tinted("#ffffff"), -Layer.OX, -Layer.OY);
    ctx.globalAlpha = 1;
  }
  if (p.frozen) {
    // Locked in obsidian: a dark glassy tint.
    ctx.globalAlpha = 0.4;
    ctx.drawImage(layer.tinted("#3a3354"), -Layer.OX, -Layer.OY);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function drawBars(ctx: CanvasRenderingContext2D, x: number, size: number, hpFrac: number, hpColor: string, shieldFrac: number, stunned: boolean, rooted: boolean, t: number, hop: number): void {
  const w = 64;
  const top = GROUND - size - 16 - hop;
  ctx.fillStyle = "#111";
  ctx.fillRect(x - w / 2 - 1, top - 1, w + 2, 9);
  ctx.fillStyle = hpColor;
  ctx.fillRect(x - w / 2, top, w * Math.max(0, hpFrac), 7);
  if (shieldFrac > 0) {
    ctx.fillStyle = "#6fb6ff";
    ctx.fillRect(x - w / 2, top - 5, w * Math.min(1, shieldFrac * 2), 3);
  }
  ctx.font = "16px sans-serif";
  ctx.textAlign = "center";
  if (stunned) {
    // Pixel stun stars circle the head; glyphs stand in until the sheet loads.
    if (!drawStunStars(ctx, t, x, top - 8)) {
      for (let i = 0; i < 3; i++) {
        const a = t * 5 + (i * Math.PI * 2) / 3;
        ctx.fillText("✦", x + Math.cos(a) * 18, top - 10 + Math.sin(a) * 5);
      }
    }
  } else if (rooted) ctx.fillText("🌿", x, top - 8);
}

function drawShots(ctx: CanvasRenderingContext2D, scene: Scene, battle: Battle, look: BattleLook): void {
  const heroX = fx(battle, "hero");
  const mobX = fx(battle, "mob");
  for (const s of scene.shots) {
    const dur = s.fx === "meteor" ? 0.32 : 0.18;
    const k = Math.min(1, (scene.now - s.born) / dur);
    const from = s.from === "hero" ? heroX : mobX;
    const to = s.from === "hero" ? mobX : heroX;
    const fy = GROUND - muzzleHeight(s.from === "hero" ? look.hero : look.mob) * CHAR_SCALE;
    const ty = GROUND - height(s.from === "hero" ? look.mob : look.hero) * 0.5;
    if (s.fx === "meteor") {
      const x = to - 160 + 160 * k;
      const y = -40 + (ty + 40) * k;
      trail(ctx, x, y, x - 50, y - 90, "#ff9b3d", 10);
      glyph(ctx, "☄️", x, y, 44, 0.9);
      continue;
    }
    if (s.fx === "lightning") continue;
    const dir = Math.sign(to - from);
    const x = from + dir * 20 + (to - from - dir * 20) * k;
    const arc = s.fx === "arrow" ? Math.sin(k * Math.PI) * 26 : Math.sin(k * Math.PI) * 8;
    const y = fy + (ty - fy) * k - arc;
    const ang = Math.atan2(ty - fy - Math.cos(k * Math.PI) * 26 * Math.PI, to - from);
    switch (s.fx) {
      case "arrow":
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(s.from === "hero" ? ang * 0.3 : Math.PI);
        ctx.strokeStyle = "#e8d9a6";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(-18, 0);
        ctx.lineTo(8, 0);
        ctx.stroke();
        ctx.fillStyle = "#f5f5f5";
        ctx.beginPath();
        ctx.moveTo(12, 0);
        ctx.lineTo(5, -4);
        ctx.lineTo(5, 4);
        ctx.fill();
        ctx.restore();
        break;
      case "spit":
        trail(ctx, x, y, x + 24, y, "#d7c8a0", 3);
        break;
      case "bolt":
        trail(ctx, x, y, x - (to - from) * 0.15, y, "#b98cff", 8);
        glow(ctx, x, y, 12, "#e2ccff");
        break;
      case "fireball":
        drawProjectile(ctx, "fireball", x, y, dir, scene.now);
        if (Math.random() < 0.6) scene.particles.push({ x, y, vx: rand(-20, 20), vy: rand(-40, -10), life: 0, max: 0.4, size: 4, color: "#ffb347", gravity: -50 });
        break;
      case "water":
        drawProjectile(ctx, "water", x, GROUND, dir, scene.now);
        break;
      case "wind":
        drawProjectile(ctx, "wind", x, y, dir, scene.now);
        break;
      case "stone":
        drawProjectile(ctx, "stone", x, GROUND, dir, scene.now);
        break;
      default:
        break;
    }
  }
}

function drawBursts(ctx: CanvasRenderingContext2D, scene: Scene): void {
  for (const b of scene.bursts) {
    const k = (scene.now - b.born) / b.dur;
    ctx.globalAlpha = 1 - k;
    if (b.kind === "slash") {
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 5 * (1 - k) + 1;
      ctx.beginPath();
      const start = b.dir === 1 ? -1.2 : Math.PI - 0.6;
      ctx.arc(b.x, b.y, b.size, start + k * 0.6, start + 1.8 + k * 0.6);
      ctx.stroke();
    } else if (b.kind === "ring") {
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 4 * (1 - k) + 1;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.size * easeOut(k) + 4, 0, Math.PI * 2);
      ctx.stroke();
    } else if (b.kind === "bolt") {
      ctx.strokeStyle = b.color;
      ctx.lineWidth = 3;
      ctx.beginPath();
      let y = -10;
      let x = b.x + rand(-10, 10);
      ctx.moveTo(x, y);
      while (y < b.y) {
        y += rand(14, 26);
        x = b.x + rand(-16, 16);
        ctx.lineTo(x, Math.min(y, b.y));
      }
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

function drawParticles(ctx: CanvasRenderingContext2D, particles: Particle[]): void {
  for (const p of particles) {
    ctx.globalAlpha = Math.max(0, 1 - p.life / p.max);
    ctx.fillStyle = p.color;
    if (p.glyph) {
      ctx.font = `700 ${p.size * 2}px system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.fillText(p.glyph, p.x, p.y);
    } else {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

function drawFloaters(ctx: CanvasRenderingContext2D, scene: Scene, battle: Battle, heights: Record<Side, number>): void {
  ctx.textAlign = "center";
  for (const f of scene.floaters) {
    const age = scene.now - f.born;
    const pop = age < 0.12 ? 0.6 + (age / 0.12) * 0.6 : age < 0.2 ? 1.2 - ((age - 0.12) / 0.08) * 0.2 : 1;
    ctx.globalAlpha = Math.max(0, 1 - Math.max(0, age - 0.5) * 1.6);
    ctx.font = `800 ${Math.round(f.size * pop)}px system-ui, sans-serif`;
    const y = GROUND - heights[f.side] - 34 - (f.dy ?? 0) - age * 55;
    // Keep text inside the canvas when the fight is at either end.
    const half = ctx.measureText(f.text).width / 2 + 6;
    const x = Math.max(half, Math.min(W - half, fx(battle, f.side) + f.dx * (1 + age)));
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0,0,0,0.7)";
    ctx.strokeText(f.text, x, y);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, x, y);
  }
  ctx.globalAlpha = 1;
}

function trail(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, width: number): void {
  const g = ctx.createLinearGradient(x1, y1, x2, y2);
  g.addColorStop(0, color);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.strokeStyle = g;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.lineCap = "butt";
}

function glow(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  const g = ctx.createRadialGradient(x, y, 1, x, y, r);
  g.addColorStop(0, "#ffffff");
  g.addColorStop(0.4, color);
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function glyph(ctx: CanvasRenderingContext2D, g: string, x: number, y: number, size: number, alpha: number): void {
  ctx.globalAlpha = alpha;
  ctx.font = `${size}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(g, x, y);
  ctx.textBaseline = "alphabetic";
  ctx.globalAlpha = 1;
}

/** An offscreen canvas a character is drawn into each frame, so it can be tinted for hit flashes. */
class Layer {
  static readonly W = 340;
  static readonly H = 280;
  static readonly OX = 170;
  static readonly OY = 250;
  canvas = document.createElement("canvas");
  private tint = document.createElement("canvas");

  constructor() {
    for (const c of [this.canvas, this.tint]) {
      c.width = Layer.W;
      c.height = Layer.H;
    }
  }

  draw(id: string, pose: Parameters<typeof drawCharacter>[2]): void {
    const g = this.canvas.getContext("2d")!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, Layer.W, Layer.H);
    g.translate(Layer.OX, Layer.OY);
    const zoom = pixelScale(id);
    g.scale(1 / zoom, 1 / zoom);
    drawCharacter(g, id, pose);
  }

  tinted(color: string): HTMLCanvasElement {
    const g = this.tint.getContext("2d")!;
    g.globalCompositeOperation = "source-over";
    g.clearRect(0, 0, Layer.W, Layer.H);
    g.drawImage(this.canvas, 0, 0);
    g.globalCompositeOperation = "source-atop";
    g.fillStyle = color;
    g.fillRect(0, 0, Layer.W, Layer.H);
    return this.tint;
  }
}

class LayerCache {
  private layers = new Map<Side, Layer>();

  get(side: Side): Layer {
    let l = this.layers.get(side);
    if (!l) {
      l = new Layer();
      this.layers.set(side, l);
    }
    return l;
  }
}

function renderHud(hud: HTMLElement, battle: Battle): void {
  const html = battle
    .cooldowns()
    .map(({ id, left, total }) => {
      const ready = left <= 0;
      const pct = ready ? 100 : Math.round((1 - left / total) * 100);
      return `<span class="cd ${ready ? "ready" : ""}" style="--p:${pct}%" title="${SKILLS[id].name}">${SKILLS[id].icon}</span>`;
    })
    .join("");
  if (hud.dataset.html !== html) {
    hud.innerHTML = html;
    hud.dataset.html = html;
  }
}
