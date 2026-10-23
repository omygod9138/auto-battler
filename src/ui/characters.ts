import type { SkillId } from "../core/skills";
import { sprite, type Clip, type SpriteSet } from "./sprites";

// Procedural, rigged characters drawn with canvas paths. Every character is drawn
// facing right with its feet at (0, 0); the caller flips and positions it.

export interface Pose {
  /** Wall-clock seconds, drives idle motion. */
  t: number;
  /** Walk-cycle phase in radians; advances while moving. */
  walk: number;
  /** 0 = standing, 1 = full stride. */
  moving: number;
  /** Attack progress 0..1 after the hit lands, or -1 when not attacking. */
  attack: number;
  /** Wind-up progress 0..1 before the next hit lands, if one is coming. */
  windup?: number;
  /** Hit-reaction progress 0..1, or -1. */
  hurt: number;
  /** Death progress 0..1, when dying. */
  death?: number;
  /** A skill in progress, 0..1 through its phase, played from its own clip when the art has one.
   * Wound-up skills play the clip's first part as "windup" and the rest as "strike"; others play it all. */
  skill?: { id: SkillId; p: number; phase: "windup" | "strike" | "full" };
}

export const IDLE: Pose = { t: 0, walk: 0, moving: 0, attack: -1, hurt: -1 };

type Weapon = "sword" | "bow" | "staff" | "axe" | "club" | "iceclub";
type Headgear = "horned" | "hood" | "wizard" | "crown" | "none";

interface HumanoidSpec {
  kind: "humanoid";
  scale: number;
  skin: string;
  shirt: string;
  pants: string;
  boots: string;
  weapon: Weapon;
  head: Headgear;
  headColor?: string;
  hair?: string;
  beard?: string;
  shield?: string;
  cape?: string;
  robe?: boolean;
  bulk?: number;
  lean?: number;
  eyes?: string;
  bones?: boolean;
  tusks?: boolean;
  armor?: string;
}

type Spec =
  | HumanoidSpec
  | { kind: "slime"; scale: number; color: string }
  | { kind: "wolf"; scale: number; color: string }
  | { kind: "wraith"; scale: number; color: string }
  | { kind: "drake"; scale: number; color: string; belly: string };

const SPECS: Record<string, Spec> = {
  warrior: { kind: "humanoid", scale: 1.15, skin: "#f0c8a0", shirt: "#9a3b2c", pants: "#4b3a2a", boots: "#2d231b", weapon: "sword", head: "horned", headColor: "#aeb6bf", beard: "#c9772f", shield: "#7a5230", cape: "#5c1f1a", armor: "#8d969f" },
  ranger: { kind: "humanoid", scale: 1.1, skin: "#f0c8a0", shirt: "#3f6b3a", pants: "#5a4630", boots: "#3a2a1c", weapon: "bow", head: "hood", headColor: "#2f5a2c", cape: "#2f5a2c" },
  mage: { kind: "humanoid", scale: 1.1, skin: "#f0c8a0", shirt: "#3b3f9e", pants: "#2c2f75", boots: "#1f1f3a", weapon: "staff", head: "wizard", headColor: "#2c2f75", beard: "#e8e4dc", robe: true },
  slime: { kind: "slime", scale: 1, color: "#5fd36a" },
  wolf: { kind: "wolf", scale: 1, color: "#6d717a" },
  skeleton: { kind: "humanoid", scale: 1.05, skin: "#e9e4d4", shirt: "#e9e4d4", pants: "#e9e4d4", boots: "#e9e4d4", weapon: "bow", head: "none", bones: true, eyes: "#ff5a3c" },
  orc: { kind: "humanoid", scale: 1.3, skin: "#6f9a48", shirt: "#5a3d26", pants: "#3e2c1d", boots: "#2a1e14", weapon: "axe", head: "none", hair: "#1e1e1e", bulk: 1.45, tusks: true, armor: "#6b5a48", lean: 0.08 },
  wraith: { kind: "wraith", scale: 1.1, color: "#2a2638" },
  troll: { kind: "humanoid", scale: 1.5, skin: "#7d8b97", shirt: "#7d8b97", pants: "#5b4a36", boots: "#7d8b97", weapon: "club", head: "none", hair: "#4b5560", bulk: 1.7, lean: 0.28, tusks: true },
  draugr: { kind: "humanoid", scale: 1.45, skin: "#8fa39c", shirt: "#3f4852", pants: "#2c333a", boots: "#20262c", weapon: "sword", head: "crown", headColor: "#c9a43a", beard: "#c8d2cf", cape: "#2b3a3f", eyes: "#6ff0ff", armor: "#56616c", bulk: 1.2, shield: "#3f4852" },
  drake: { kind: "drake", scale: 1.25, color: "#a8322a", belly: "#e3a24f" },
  jotunn: { kind: "humanoid", scale: 1.85, skin: "#9fcbe8", shirt: "#cfe8f7", pants: "#5d7d95", boots: "#40596b", weapon: "iceclub", head: "none", hair: "#eef6fb", beard: "#eef6fb", bulk: 1.6, lean: 0.12, eyes: "#e6fbff" },
};

/** Rig units per art pixel for sprite characters; with the battle's 1.35 zoom that is 2 screen pixels per art pixel. */
export const SPRITE_SCALE = 2 / 1.35;

/** How much a character is enlarged when drawn; the battle draws sprites at 1:1 and applies this itself to keep pixels crisp. */
export function pixelScale(id: string): number {
  const art = sprite(id);
  return art ? SPRITE_SCALE * art.scale : 1;
}

/** True when the character has its own death animation instead of toppling over. */
export function hasDeathAnim(id: string): boolean {
  return !!sprite(id)?.anims.death;
}

/** How a character without death frames falls: it turns `turn` radians backwards about the point `centre`
 * up its height, which comes to rest `rest` up its height. Fractions of the character's height. */
export interface Fall {
  turn: number;
  centre: number;
  rest: number;
}

/** People and the wraith topple flat onto their back, lifted by half the body's thickness so they lie on
 * the ground, not in it; beasts roll belly-up about their middle. */
export function deathFall(id: string): Fall {
  const kind = sprite(id) ? "humanoid" : (SPECS[id] ?? SPECS.slime).kind;
  if (kind === "humanoid" || kind === "wraith") return { turn: Math.PI / 2, centre: 0, rest: 0.12 };
  // The drake's body sits low under its wings.
  if (kind === "drake") return { turn: Math.PI, centre: 0.375, rest: 0.15 };
  return { turn: Math.PI, centre: 0.5, rest: 0.5 };
}

/** Approximate on-screen height, for placing health bars and numbers. */
export function characterHeight(id: string): number {
  const art = sprite(id);
  if (art) return art.visible * SPRITE_SCALE * art.scale;
  const s = SPECS[id] ?? SPECS.slime;
  const base = s.kind === "humanoid" ? 68 : s.kind === "slime" ? 34 : s.kind === "wolf" ? 42 : s.kind === "wraith" ? 74 : 96;
  return base * s.scale;
}

/** Height of the hand / mouth that projectiles leave from. */
export function muzzleHeight(id: string): number {
  return characterHeight(id) * 0.62;
}

export function drawCharacter(ctx: CanvasRenderingContext2D, id: string, pose: Pose): void {
  const art = sprite(id);
  if (art) return drawSprite(ctx, art, pose);
  const s = SPECS[id] ?? SPECS.slime;
  ctx.save();
  ctx.scale(s.scale, s.scale);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  switch (s.kind) {
    case "humanoid":
      humanoid(ctx, s, pose);
      break;
    case "slime":
      slime(ctx, s.color, pose);
      break;
    case "wolf":
      wolf(ctx, s.color, pose);
      break;
    case "wraith":
      wraith(ctx, s.color, pose);
      break;
    case "drake":
      drake(ctx, s.color, s.belly, pose);
      break;
  }
  ctx.restore();
}

/** Fraction of an attack clip played before the hit lands; the rest follows through. */
const STRIKE = 0.55;
/** Skill clips whose impact frame sits elsewhere: Charge hits on frame 3 of 9 (the dash before it), the kick on frame 4. */
const SKILL_STRIKE: Partial<Record<SkillId, number>> = { charge: 3 / 9, spartanKick: 4 / 9 };

function drawSprite(ctx: CanvasRenderingContext2D, art: SpriteSet, pose: Pose): void {
  const { anims } = art;
  const at = (clip: Clip | undefined, i: number): [Clip, HTMLImageElement] | undefined =>
    clip && [clip, clip.frames[Math.max(0, Math.min(clip.frames.length - 1, i))]];
  const loop = (clip: Clip | undefined, cycles: number) => clip && at(clip, Math.floor(cycles * clip.frames.length) % clip.frames.length);
  let pick: [Clip, HTMLImageElement] | undefined;
  let hop = 0;
  if (pose.death !== undefined) pick = at(anims.death, Math.floor(pose.death * (anims.death?.frames.length ?? 0)));
  const skillClip = pose.skill && art.skills[pose.skill.id];
  if (!pick && skillClip) {
    const { p, phase } = pose.skill!;
    const n = skillClip.frames.length;
    const k = Math.max(1, Math.round(n * (SKILL_STRIKE[pose.skill!.id] ?? STRIKE)));
    pick = at(skillClip, phase === "windup" ? Math.min(k - 1, Math.floor(p * k)) : phase === "strike" ? k + Math.floor(p * (n - k)) : Math.floor(p * n));
  }
  if (!pick && anims.attack) {
    const n = anims.attack.frames.length;
    const strike = Math.round(n * STRIKE);
    if (pose.attack >= 0) pick = at(anims.attack, strike + Math.floor(pose.attack * (n - strike)));
    else if (pose.windup !== undefined && pose.windup > 0) pick = at(anims.attack, Math.floor(pose.windup * strike));
  }
  if (!pick && pose.hurt >= 0) pick = at(anims.hurt, Math.floor(pose.hurt * (anims.hurt?.frames.length ?? 0)));
  if (!pick && pose.moving > 0.5) {
    pick = loop(anims.walk, pose.walk / (Math.PI * 2));
    // Without walk frames, hop the still a pixel or two in step.
    if (!pick) hop = Math.round(Math.abs(Math.sin(pose.walk)) * 2 * pose.moving);
  }
  pick ??= loop(anims.idle, (pose.t * 8) / (anims.idle?.frames.length ?? 1)) ?? at(art.still, 0)!;
  const [clip, img] = pick;
  let foot = clip.foot;
  if (clip.rest !== undefined && clip.frames.length > 1) {
    // Sink from the feet to where the body lies, so the fall ends on the ground.
    foot += Math.round(((clip.rest - clip.foot) * clip.frames.indexOf(img)) / (clip.frames.length - 1));
  }
  ctx.save();
  ctx.scale(SPRITE_SCALE * art.scale, SPRITE_SCALE * art.scale);
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, -Math.round(img.width / 2), -foot - hop);
  ctx.restore();
}

const portraits = new Map<string, string>();

/** A still, idle image of a character as a data URL, for menus. */
export function portrait(id: string, size = 96): string {
  const key = `${id}@${size}`;
  const hit = portraits.get(key);
  if (hit) return hit;
  const c = document.createElement("canvas");
  c.width = size * 2;
  c.height = size * 2;
  const g = c.getContext("2d")!;
  const h = characterHeight(id);
  const k = (size * 1.6) / Math.max(h, 60);
  g.translate(size, size * 1.85);
  g.scale(k, k);
  drawCharacter(g, id, { ...IDLE, t: 0.4 });
  const url = c.toDataURL();
  portraits.set(key, url);
  return url;
}

// ---------------------------------------------------------------------------

/** Angle convention: 0 points down, +π/2 points forward (right), π points up. */
const dirX = (a: number) => Math.sin(a);
const dirY = (a: number) => Math.cos(a);

interface Pt {
  x: number;
  y: number;
}

function seg(ctx: CanvasRenderingContext2D, from: Pt, angle: number, len: number, width: number, color: string): Pt {
  const to = { x: from.x + dirX(angle) * len, y: from.y + dirY(angle) * len };
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  return to;
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
}

function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.max(0, Math.min(255, Math.round(v * k)));
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

const easeOut = (k: number) => 1 - (1 - k) ** 3;

function humanoid(ctx: CanvasRenderingContext2D, s: HumanoidSpec, p: Pose): void {
  const bulk = s.bulk ?? 1;
  const limbW = s.bones ? 3 : 5.5 * Math.sqrt(bulk);
  const stride = Math.sin(p.walk) * 0.55 * p.moving;
  const bob = Math.abs(Math.cos(p.walk)) * 2 * p.moving;
  const breathe = Math.sin(p.t * 3) * 0.8;
  const hurtLean = p.hurt >= 0 ? -Math.sin(p.hurt * Math.PI) * 0.25 : 0;
  const atkLean = p.attack >= 0 && s.weapon !== "bow" ? Math.sin(p.attack * Math.PI) * 0.18 : 0;
  const lean = (s.lean ?? 0.04) + hurtLean + atkLean;
  const hips: Pt = { x: 0, y: -27 + bob };

  const leg = (phase: number, front: boolean) => {
    const sw = front ? stride : -stride;
    const knee = Math.max(0, Math.sin(p.walk + phase)) * 0.7 * p.moving + 0.08;
    const color = front ? s.pants : shade(s.pants, 0.75);
    const k = seg(ctx, hips, sw, 13.5, limbW + 0.5, color);
    const foot = seg(ctx, k, sw - knee, 13.5, limbW, color);
    if (!s.bones) {
      ctx.fillStyle = front ? s.boots : shade(s.boots, 0.75);
      ctx.beginPath();
      ctx.ellipse(foot.x + 2.5, foot.y, 5, 2.8, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  const shoulder: Pt = { x: hips.x + dirX(Math.PI - lean) * 21, y: hips.y + dirY(Math.PI - lean) * 21 + breathe * 0.3 };
  const headC: Pt = { x: shoulder.x + Math.sin(lean) * 10, y: shoulder.y - 9 + breathe * 0.2 };

  // Cape flutters behind everything.
  if (s.cape) {
    const flutter = Math.sin(p.t * 4) * 3 + p.moving * 6;
    ctx.fillStyle = s.cape;
    ctx.beginPath();
    ctx.moveTo(shoulder.x - 4, shoulder.y);
    ctx.quadraticCurveTo(-12 - flutter, -14, -10 - flutter * 1.4, -2 + bob);
    ctx.lineTo(-1, -6 + bob);
    ctx.lineTo(shoulder.x + 2, shoulder.y + 2);
    ctx.fill();
  }

  const weaponPose = armPose(s.weapon, p);
  // Back arm (behind torso).
  const backColor = shade(s.bones ? s.skin : s.shirt, 0.72);
  const be = seg(ctx, shoulder, weaponPose.backUpper, 11, limbW, backColor);
  const bh = seg(ctx, be, weaponPose.backFore, 10.5, limbW - 0.5, s.bones ? backColor : shade(s.skin, 0.8));
  if (s.weapon === "bow") bowString(ctx, bh, p);
  if (s.shield) {
    circle(ctx, bh.x + 1, bh.y - 1, 9, shade(s.shield, 0.85));
    ctx.strokeStyle = "#c9a43a";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(bh.x + 1, bh.y - 1, 9, 0, Math.PI * 2);
    ctx.stroke();
    circle(ctx, bh.x + 1, bh.y - 1, 2.5, "#d8d8d8");
  }

  leg(Math.PI, false);

  // Torso.
  if (s.bones) {
    seg(ctx, hips, Math.PI - lean, 21, 2.5, s.skin);
    ctx.strokeStyle = s.skin;
    ctx.lineWidth = 2;
    for (let i = 0; i < 4; i++) {
      const y = shoulder.y + 4 + i * 4;
      const x = shoulder.x + Math.sin(lean) * -i * 3;
      ctx.beginPath();
      ctx.moveTo(x - 6, y);
      ctx.quadraticCurveTo(x, y + 2, x + 6, y);
      ctx.stroke();
    }
  } else {
    const w = 7 * bulk;
    ctx.fillStyle = s.shirt;
    ctx.beginPath();
    ctx.moveTo(hips.x - w * 0.85, hips.y + 2);
    ctx.lineTo(shoulder.x - w, shoulder.y);
    ctx.quadraticCurveTo(shoulder.x, shoulder.y - 4, shoulder.x + w, shoulder.y);
    ctx.lineTo(hips.x + w * 0.85, hips.y + 2);
    ctx.closePath();
    ctx.fill();
    if (s.robe) {
      ctx.beginPath();
      ctx.moveTo(hips.x - w * 0.85, hips.y);
      ctx.lineTo(-11 - p.moving * 3, -1 + bob);
      ctx.quadraticCurveTo(0, 2 + Math.sin(p.t * 3) * 1.5, 12 + stride * 6, -1 + bob);
      ctx.lineTo(hips.x + w * 0.85, hips.y);
      ctx.fill();
    }
    if (s.armor) {
      ctx.fillStyle = s.armor;
      ctx.beginPath();
      ctx.ellipse(shoulder.x + 1, shoulder.y + 1, w * 0.9, 4, -lean, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = shade(s.shirt, 0.6);
    ctx.fillRect(hips.x - w * 0.85, hips.y - 2, w * 1.7, 3.5);
  }

  if (!s.robe) leg(0, true);

  // Head.
  if (s.head === "hood") {
    ctx.fillStyle = s.headColor!;
    ctx.beginPath();
    ctx.moveTo(headC.x - 10, headC.y + 7);
    ctx.quadraticCurveTo(headC.x - 13, headC.y - 12, headC.x + 1, headC.y - 11);
    ctx.quadraticCurveTo(headC.x + 11, headC.y - 8, headC.x + 9, headC.y + 7);
    ctx.fill();
  }
  if (s.hair) circle(ctx, headC.x - 1.5, headC.y - 1, 7.6, s.hair);
  if (s.bones) {
    circle(ctx, headC.x, headC.y, 7, s.skin);
    ctx.fillStyle = s.skin;
    ctx.fillRect(headC.x - 3, headC.y + 4, 7, 4);
    circle(ctx, headC.x + 2, headC.y - 0.5, 2.2, "#1b1b1b");
    circle(ctx, headC.x + 5.5, headC.y - 0.5, 1.8, "#1b1b1b");
  } else {
    circle(ctx, headC.x, headC.y, 7, s.skin);
    // Ear and nose give the head a direction.
    circle(ctx, headC.x - 2, headC.y + 0.5, 2, shade(s.skin, 0.85));
    circle(ctx, headC.x + 6.6, headC.y + 1, 1.6, shade(s.skin, 0.9));
  }
  if (s.beard) {
    ctx.fillStyle = s.beard;
    ctx.beginPath();
    ctx.moveTo(headC.x - 1, headC.y + 2);
    ctx.quadraticCurveTo(headC.x + 3, headC.y + 13 + Math.sin(p.t * 3) * 0.5, headC.x + 7, headC.y + 3);
    ctx.fill();
  }
  if (s.tusks) {
    ctx.fillStyle = "#f3eedc";
    ctx.beginPath();
    ctx.moveTo(headC.x + 4, headC.y + 4);
    ctx.lineTo(headC.x + 6, headC.y + 0.5);
    ctx.lineTo(headC.x + 6.5, headC.y + 4.5);
    ctx.fill();
  }
  const eye = { x: headC.x + 3.5, y: headC.y - 1.5 };
  const blink = Math.sin(p.t * 1.3) > 0.985;
  if (s.eyes) {
    const g = ctx.createRadialGradient(eye.x, eye.y, 0.5, eye.x, eye.y, 5);
    g.addColorStop(0, s.eyes);
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(eye.x, eye.y, 5, 0, Math.PI * 2);
    ctx.fill();
    circle(ctx, eye.x, eye.y, 1.4, s.eyes);
  } else if (!s.bones) {
    if (blink) {
      ctx.strokeStyle = "#222";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(eye.x - 1.5, eye.y);
      ctx.lineTo(eye.x + 1.5, eye.y);
      ctx.stroke();
    } else circle(ctx, eye.x, eye.y, 1.3, "#222");
  }
  headgear(ctx, s, headC, p);

  // Front arm + weapon on top.
  const frontColor = s.bones ? s.skin : s.shirt;
  const fe = seg(ctx, shoulder, weaponPose.frontUpper, 11, limbW, frontColor);
  const fh = seg(ctx, fe, weaponPose.frontFore, 10.5, limbW - 0.5, s.bones ? s.skin : s.skin);
  weapon(ctx, s.weapon, fh, weaponPose.weaponAngle, p);
  circle(ctx, fh.x, fh.y, limbW * 0.55, s.skin);
}

interface ArmPose {
  frontUpper: number;
  frontFore: number;
  backUpper: number;
  backFore: number;
  weaponAngle: number;
}

function armPose(weapon: Weapon, p: Pose): ArmPose {
  const swing = Math.sin(p.walk) * 0.6 * p.moving;
  const breathe = Math.sin(p.t * 3) * 0.04;
  if (weapon === "bow") {
    // Bow arm points forward; draw hand pulls back during the attack.
    const pull = p.attack >= 0 ? (p.attack < 0.6 ? p.attack / 0.6 : 0) : 0.15;
    return {
      frontUpper: 1.45 + breathe,
      frontFore: 1.55,
      backUpper: 1.25 - pull * 0.5,
      backFore: 1.6 + pull * 1.6,
      weaponAngle: Math.PI,
    };
  }
  if (weapon === "staff") {
    const thrust = p.attack >= 0 ? Math.sin(p.attack * Math.PI) : 0;
    return {
      frontUpper: 0.75 + thrust * 0.9 + breathe,
      frontFore: 1.5 + thrust * 0.3,
      backUpper: -swing - 0.15,
      backFore: 0.35 - swing,
      weaponAngle: Math.PI - 0.12 + thrust * 0.5,
    };
  }
  // Melee: wind up overhead, then chop down fast.
  let a = 0.55 + swing * 0.4 + breathe;
  if (p.attack >= 0) {
    a = p.attack < 0.35 ? 0.55 + (p.attack / 0.35) * 2.5 : 3.05 - easeOut((p.attack - 0.35) / 0.65) * 2.3;
  }
  return {
    frontUpper: a,
    frontFore: a + 0.55,
    backUpper: -swing - 0.1 + (weapon === "sword" ? 0.6 : 0),
    backFore: 0.6 - swing + (weapon === "sword" ? 0.6 : 0),
    weaponAngle: a + 1.05,
  };
}

function bowString(ctx: CanvasRenderingContext2D, hand: Pt, p: Pose): void {
  // The string runs from the bow tips (set in weapon()) to the drawing hand; drawn there.
  void ctx;
  void hand;
  void p;
}

function weapon(ctx: CanvasRenderingContext2D, w: Weapon, hand: Pt, angle: number, p: Pose): void {
  const tip = (len: number) => ({ x: hand.x + dirX(angle) * len, y: hand.y + dirY(angle) * len });
  switch (w) {
    case "sword": {
      const end = tip(26);
      ctx.strokeStyle = "#dfe6ec";
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(hand.x, hand.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hand.x + 1, hand.y);
      ctx.lineTo(end.x + 1, end.y);
      ctx.stroke();
      const g = { x: hand.x + dirX(angle + Math.PI / 2) * 5, y: hand.y + dirY(angle + Math.PI / 2) * 5 };
      const g2 = { x: hand.x - dirX(angle + Math.PI / 2) * 5, y: hand.y - dirY(angle + Math.PI / 2) * 5 };
      ctx.strokeStyle = "#c9a43a";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(g.x, g.y);
      ctx.lineTo(g2.x, g2.y);
      ctx.stroke();
      break;
    }
    case "axe":
    case "club":
    case "iceclub": {
      const len = w === "axe" ? 26 : 30;
      const back = { x: hand.x - dirX(angle) * 4, y: hand.y - dirY(angle) * 4 };
      const end = tip(len);
      ctx.strokeStyle = w === "iceclub" ? "#d8f2ff" : "#6b4a2b";
      ctx.lineWidth = w === "axe" ? 3.5 : 6;
      ctx.beginPath();
      ctx.moveTo(back.x, back.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      if (w === "axe") {
        const n = angle + Math.PI / 2;
        ctx.fillStyle = "#b9c1c9";
        ctx.beginPath();
        ctx.moveTo(end.x, end.y);
        ctx.quadraticCurveTo(end.x + dirX(n) * 14 + dirX(angle) * 2, end.y + dirY(n) * 14 + dirY(angle) * 2, end.x - dirX(angle) * 12 + dirX(n) * 4, end.y - dirY(angle) * 12 + dirY(n) * 4);
        ctx.closePath();
        ctx.fill();
      } else {
        circle(ctx, end.x, end.y, w === "iceclub" ? 8 : 7, w === "iceclub" ? "#bfe8ff" : "#5a3c22");
        if (w === "club") {
          circle(ctx, end.x + 3, end.y - 2, 1.5, "#cfc6b8");
          circle(ctx, end.x - 3, end.y + 2, 1.5, "#cfc6b8");
        }
      }
      break;
    }
    case "bow": {
      const top = { x: hand.x + 2, y: hand.y - 17 };
      const bot = { x: hand.x + 2, y: hand.y + 17 };
      ctx.strokeStyle = "#8a5a2b";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.quadraticCurveTo(hand.x + 12, hand.y, bot.x, bot.y);
      ctx.stroke();
      const pull = p.attack >= 0 ? (p.attack < 0.6 ? p.attack / 0.6 : 0) : 0.15;
      const nock = { x: hand.x - 6 - pull * 12, y: hand.y };
      ctx.strokeStyle = "rgba(240,240,240,0.85)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(top.x, top.y);
      ctx.lineTo(nock.x, nock.y);
      ctx.lineTo(bot.x, bot.y);
      ctx.stroke();
      if (pull > 0.05) {
        ctx.strokeStyle = "#e8d9a6";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(nock.x, nock.y);
        ctx.lineTo(hand.x + 12, hand.y);
        ctx.stroke();
      }
      break;
    }
    case "staff": {
      const end = tip(32);
      const back = { x: hand.x - dirX(angle) * 12, y: hand.y - dirY(angle) * 12 };
      ctx.strokeStyle = "#6b4a2b";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(back.x, back.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      const flare = p.attack >= 0 ? Math.sin(p.attack * Math.PI) : 0;
      const r = 5 + flare * 4 + Math.sin(p.t * 5) * 0.8;
      const g = ctx.createRadialGradient(end.x, end.y, 1, end.x, end.y, r * 2.6);
      g.addColorStop(0, "#ffffff");
      g.addColorStop(0.3, "#c9a7ff");
      g.addColorStop(1, "rgba(150,100,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(end.x, end.y, r * 2.6, 0, Math.PI * 2);
      ctx.fill();
      circle(ctx, end.x, end.y, r * 0.7, "#efe4ff");
      break;
    }
  }
}

function headgear(ctx: CanvasRenderingContext2D, s: HumanoidSpec, h: Pt, p: Pose): void {
  switch (s.head) {
    case "horned": {
      ctx.fillStyle = s.headColor!;
      ctx.beginPath();
      ctx.arc(h.x, h.y - 1, 7.8, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(h.x - 8, h.y - 1.5, 16, 2.5);
      ctx.fillStyle = "#efe6cf";
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(h.x + side * 6, h.y - 4);
        ctx.quadraticCurveTo(h.x + side * 13, h.y - 7, h.x + side * 12, h.y - 15);
        ctx.quadraticCurveTo(h.x + side * 9, h.y - 8, h.x + side * 3, h.y - 6);
        ctx.fill();
      }
      ctx.fillStyle = shade(s.headColor!, 0.8);
      ctx.fillRect(h.x + 2.5, h.y - 1, 2, 6);
      break;
    }
    case "hood":
      ctx.fillStyle = s.headColor!;
      ctx.beginPath();
      ctx.moveTo(h.x - 8, h.y + 2);
      ctx.quadraticCurveTo(h.x - 6, h.y - 11, h.x + 3, h.y - 9);
      ctx.quadraticCurveTo(h.x + 9, h.y - 7, h.x + 8, h.y - 3);
      ctx.quadraticCurveTo(h.x + 1, h.y - 6, h.x - 2, h.y + 2);
      ctx.fill();
      break;
    case "wizard": {
      const sway = Math.sin(p.t * 2) * 1.5 + p.moving * -3;
      ctx.fillStyle = s.headColor!;
      ctx.beginPath();
      ctx.ellipse(h.x, h.y - 5, 12, 3, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(h.x - 7, h.y - 6);
      ctx.quadraticCurveTo(h.x - 2, h.y - 20, h.x - 9 + sway, h.y - 27);
      ctx.quadraticCurveTo(h.x + 3, h.y - 18, h.x + 7, h.y - 6);
      ctx.fill();
      ctx.fillStyle = "#f5d76e";
      ctx.font = "6px sans-serif";
      ctx.fillText("✦", h.x - 2, h.y - 11);
      break;
    }
    case "crown":
      ctx.fillStyle = s.headColor!;
      ctx.beginPath();
      ctx.moveTo(h.x - 7, h.y - 4);
      for (let i = 0; i <= 4; i++) ctx.lineTo(h.x - 7 + i * 3.5, h.y - (i % 2 ? 7 : 13));
      ctx.lineTo(h.x + 7, h.y - 4);
      ctx.fill();
      break;
    case "none":
      break;
  }
}

function slime(ctx: CanvasRenderingContext2D, color: string, p: Pose): void {
  const hop = Math.abs(Math.sin(p.walk)) * p.moving;
  const wob = Math.sin(p.t * 4) * 0.07;
  const lunge = p.attack >= 0 ? Math.sin(p.attack * Math.PI) : 0;
  const w = 20 * (1 + wob + lunge * 0.3 - hop * 0.15);
  const h = 17 * (1 - wob - lunge * 0.15 + hop * 0.25);
  const y = -hop * 12;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-w, y);
  ctx.quadraticCurveTo(-w, y - h * 2, lunge * 6, y - h * 2);
  ctx.quadraticCurveTo(w + lunge * 8, y - h * 2, w + lunge * 4, y);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.beginPath();
  ctx.ellipse(-w * 0.35, y - h * 1.5, 5, 3, -0.5, 0, Math.PI * 2);
  ctx.fill();
  circle(ctx, w * 0.25, y - h * 1.1, 3, "#fff");
  circle(ctx, w * 0.6, y - h * 1.1, 2.6, "#fff");
  circle(ctx, w * 0.3, y - h * 1.05, 1.5, "#1b1b1b");
  circle(ctx, w * 0.65, y - h * 1.05, 1.3, "#1b1b1b");
}

function wolf(ctx: CanvasRenderingContext2D, color: string, p: Pose): void {
  const gait = p.walk * 1.4;
  const bob = Math.abs(Math.sin(gait)) * 2 * p.moving;
  const lunge = p.attack >= 0 ? Math.sin(p.attack * Math.PI) : 0;
  const body = { x: lunge * 4, y: -24 + bob };
  const dark = shade(color, 0.7);
  const leg = (x: number, phase: number, c: string) => {
    const sw = Math.sin(gait + phase) * 0.6 * p.moving;
    const k = seg(ctx, { x: body.x + x, y: body.y + 3 }, sw, 11, 4.5, c);
    seg(ctx, k, sw - 0.3 + Math.max(0, Math.sin(gait + phase)) * 0.6 * p.moving, 11, 3.5, c);
  };
  leg(-12, Math.PI, dark);
  leg(10, 0, dark);
  // Tail wags.
  ctx.strokeStyle = color;
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.moveTo(body.x - 18, body.y - 2);
  ctx.quadraticCurveTo(body.x - 30, body.y - 10 + Math.sin(p.t * 8) * 4, body.x - 34, body.y - 4 + Math.sin(p.t * 8) * 6);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(body.x, body.y, 21, 9, 0, 0, Math.PI * 2);
  ctx.fill();
  leg(-8, 0.4, color);
  leg(14, Math.PI + 0.4, color);
  // Head lunges forward to bite.
  const hx = body.x + 22 + lunge * 10;
  const hy = body.y - 9 + lunge * 3;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(hx, hy, 9, 7, 0.2, 0, Math.PI * 2);
  ctx.fill();
  const open = lunge * 0.5;
  ctx.beginPath();
  ctx.moveTo(hx + 4, hy - 3);
  ctx.lineTo(hx + 17, hy - 1 - open * 4);
  ctx.lineTo(hx + 6, hy + 1);
  ctx.fill();
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(hx + 4, hy + 1);
  ctx.lineTo(hx + 15, hy + 2 + open * 8);
  ctx.lineTo(hx + 4, hy + 5);
  ctx.fill();
  ctx.fillStyle = color;
  for (const ex of [-4, 0]) {
    ctx.beginPath();
    ctx.moveTo(hx + ex - 2, hy - 5);
    ctx.lineTo(hx + ex, hy - 14);
    ctx.lineTo(hx + ex + 4, hy - 5);
    ctx.fill();
  }
  circle(ctx, hx + 4, hy - 3, 1.6, "#ffd34a");
}

function wraith(ctx: CanvasRenderingContext2D, color: string, p: Pose): void {
  const float = Math.sin(p.t * 2) * 4 - 10;
  const reach = p.attack >= 0 ? Math.sin(p.attack * Math.PI) : 0;
  const top = -70 + float;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-6, top);
  ctx.quadraticCurveTo(14, top - 4, 13, top + 18);
  ctx.lineTo(16, float - 4);
  // Tattered hem ripples.
  for (let i = 0; i <= 6; i++) {
    const x = 16 - i * 6;
    ctx.lineTo(x, float + (i % 2 ? -8 : 0) + Math.sin(p.t * 6 + i) * 3);
  }
  ctx.lineTo(-18, top + 24);
  ctx.quadraticCurveTo(-18, top, -6, top);
  ctx.fill();
  ctx.fillStyle = "#0b0a12";
  ctx.beginPath();
  ctx.ellipse(4, top + 10, 7, 8, 0.15, 0, Math.PI * 2);
  ctx.fill();
  for (const ex of [3, 8]) {
    const g = ctx.createRadialGradient(ex, top + 9, 0.5, ex, top + 9, 5);
    g.addColorStop(0, "#9ff7ff");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(ex, top + 9, 5, 0, Math.PI * 2);
    ctx.fill();
  }
  const sh = { x: 6, y: top + 24 };
  const e = seg(ctx, sh, 1.1 + reach * 0.6, 12, 3, shade(color, 1.4));
  const h = seg(ctx, e, 1.5 + reach * 0.3, 12 + reach * 6, 2.5, shade(color, 1.4));
  ctx.strokeStyle = "#cfd6ff";
  ctx.lineWidth = 1.5;
  for (const d of [-0.4, 0, 0.4]) {
    ctx.beginPath();
    ctx.moveTo(h.x, h.y);
    ctx.lineTo(h.x + dirX(1.5 + d) * 7, h.y + dirY(1.5 + d) * 7);
    ctx.stroke();
  }
}

function drake(ctx: CanvasRenderingContext2D, color: string, belly: string, p: Pose): void {
  const flap = Math.sin(p.t * 5);
  const breath = p.attack >= 0 ? Math.sin(p.attack * Math.PI) : 0;
  const bob = Math.sin(p.t * 2.5) * 2;
  const body = { x: 0, y: -36 + bob };
  const dark = shade(color, 0.65);
  // Far wing.
  wing(ctx, body.x - 2, body.y - 10, -flap * 0.6 - 0.2, dark);
  // Tail.
  ctx.strokeStyle = color;
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(body.x - 20, body.y + 4);
  ctx.quadraticCurveTo(body.x - 46, body.y + 22, body.x - 62, body.y + 10 + Math.sin(p.t * 3) * 6);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(body.x - 60, body.y + 4 + Math.sin(p.t * 3) * 6);
  ctx.lineTo(body.x - 72, body.y + 10 + Math.sin(p.t * 3) * 6);
  ctx.lineTo(body.x - 60, body.y + 16 + Math.sin(p.t * 3) * 6);
  ctx.fill();
  // Legs.
  for (const [x, c] of [[-10, dark], [12, color]] as const) {
    const k = seg(ctx, { x: body.x + x, y: body.y + 8 }, 0.3, 16, 8, c);
    const f = seg(ctx, k, -0.4, 14, 6, c);
    ctx.fillStyle = "#e8e0d0";
    ctx.beginPath();
    ctx.moveTo(f.x, f.y);
    ctx.lineTo(f.x + 7, f.y + 2);
    ctx.lineTo(f.x, f.y + 3);
    ctx.fill();
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(body.x, body.y, 26, 15, -0.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = belly;
  ctx.beginPath();
  ctx.ellipse(body.x + 4, body.y + 6, 18, 7, -0.1, 0, Math.PI * 2);
  ctx.fill();
  // Neck rears back, then thrusts while breathing fire.
  const nx = body.x + 30 + breath * 8 - (p.attack >= 0 && p.attack < 0.3 ? 6 : 0);
  const ny = body.y - 30 + breath * 6;
  ctx.strokeStyle = color;
  ctx.lineWidth = 11;
  ctx.beginPath();
  ctx.moveTo(body.x + 18, body.y - 6);
  ctx.quadraticCurveTo(body.x + 30, body.y - 18, nx, ny);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(nx + 6, ny, 12, 8, 0.2 + breath * 0.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(nx + 10, ny - 4);
  ctx.lineTo(nx + 26, ny + 1 - breath * 3);
  ctx.lineTo(nx + 12, ny + 3);
  ctx.fill();
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.moveTo(nx + 10, ny + 3);
  ctx.lineTo(nx + 24, ny + 5 + breath * 9);
  ctx.lineTo(nx + 8, ny + 7);
  ctx.fill();
  if (breath > 0.2) {
    const g = ctx.createRadialGradient(nx + 28, ny + 4, 1, nx + 28, ny + 4, 18 * breath);
    g.addColorStop(0, "#fff3b0");
    g.addColorStop(0.5, "#ff8a2a");
    g.addColorStop(1, "rgba(255,80,0,0)");
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(nx + 28, ny + 4, 18 * breath, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#e8e0d0";
  for (const hx of [0, 5]) {
    ctx.beginPath();
    ctx.moveTo(nx + hx, ny - 6);
    ctx.lineTo(nx + hx - 8, ny - 16);
    ctx.lineTo(nx + hx + 3, ny - 7);
    ctx.fill();
  }
  circle(ctx, nx + 10, ny - 2, 2, "#ffe14a");
  // Near wing.
  wing(ctx, body.x + 4, body.y - 10, -flap * 0.8, color);
}

function wing(ctx: CanvasRenderingContext2D, x: number, y: number, a: number, color: string): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(a);
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-10, -44);
  ctx.lineTo(-24, -36);
  ctx.quadraticCurveTo(-30, -16, -36, -10);
  ctx.quadraticCurveTo(-18, -12, -16, -2);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = shade(color.startsWith("#") ? color : "#a8322a", 0.55);
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(-24, -36);
  ctx.moveTo(0, 0);
  ctx.lineTo(-36, -10);
  ctx.stroke();
  ctx.restore();
}
