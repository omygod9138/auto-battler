// Pixel-art melee effects for the Warrior, drawn in whole art pixels (PIXEL screen px each) like spellFx.
// Each effect is a pure function of its age, animated at a low frame rate like sprite art.
import { PIXEL as P } from "./backdrop";

export type MeleeFxKind = "slash";

/** An effect anchored to the mob: x follows it, so a knocked-back mob keeps its effect. */
export interface MeleeFx {
  kind: MeleeFxKind;
  /** Scene time it started. */
  born: number;
  /** A crit: bigger, with a second cross cut. */
  big?: boolean;
}

export const MELEE_FX_DUR: Record<MeleeFxKind, number> = { slash: 0.42 };

/** Animation frames per second; low on purpose so the cut reads as pixel art. */
const FPS = 12;

/** Steel edge: hot white core out to cold blue. */
const STEEL = ["#ffffff", "#e4f4ff", "#9fd2f5", "#4f8fc8"];
const SPARK = ["#fff6c2", "#ffd34a", "#ff9a2a"];

function hash(a: number, b: number, c: number): number {
  let n = Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

type Dot = (gx: number, gy: number, color: string, w?: number, h?: number) => void;

/** Draw every live effect. x is the mob's screen x, ground the screen y of the floor, h the mob's height. */
export function drawMeleeFx(ctx: CanvasRenderingContext2D, list: MeleeFx[], now: number, x: number, ground: number, h: number): void {
  const dot: Dot = (gx, gy, color, w = 1, hh = 1) => {
    ctx.fillStyle = color;
    ctx.fillRect(gx * P, gy * P, w * P, hh * P);
  };
  const ax = Math.round(x / P);
  const ag = Math.round(ground / P);
  const ah = Math.round(h / P);
  for (const f of list) {
    const age = now - f.born;
    if (age < 0 || age >= MELEE_FX_DUR[f.kind]) continue;
    if (f.kind === "slash") slash(dot, ax, ag, ah, age, !!f.big);
  }
}

/**
 * One crescent cut swept across an arc. a0 → a1 is the swing (radians, y down); the leading edge
 * travels along it on frame 0, the whole crescent shows on frame 1, then it thins and breaks up.
 */
function crescent(dot: Dot, cx: number, cy: number, r: number, a0: number, a1: number, frame: number, seed: number): void {
  if (frame < 0 || frame > 3) return;
  const head = frame === 0 ? 0.55 : 1;
  const thin = [1, 1, 0.6, 0.3][frame];
  const span = a1 - a0;
  const reach = r + 4;
  for (let gy = -reach; gy <= reach; gy++) {
    for (let gx = -reach; gx <= reach; gx++) {
      const d = Math.hypot(gx, gy);
      let a = Math.atan2(gy, gx);
      // Put the angle on the swing's side of the circle.
      while (a < Math.min(a0, a1)) a += Math.PI * 2;
      while (a > Math.max(a0, a1)) a -= Math.PI * 2;
      const k = (a - a0) / span;
      if (k < 0 || k > head) continue;
      // Thick in the middle of the swing, tapering to points at both ends.
      const w = Math.sin((k / head) * Math.PI) * 4.2 * thin;
      const depth = r - d;
      if (depth < -0.5 || depth > w) continue;
      // Late frames dissolve into dither.
      if (frame >= 2 && hash(gx, gy, seed + frame) < (frame === 2 ? 0.25 : 0.55)) continue;
      const edge = depth / Math.max(1, w);
      const c = frame >= 2 ? STEEL[Math.min(3, 1 + Math.floor(edge * 3) + (frame - 2))] : STEEL[Math.min(3, Math.floor(edge * 3.2))];
      dot(cx + gx, cy + gy, c);
    }
  }
}

/** The Warrior's sword swing: a steel crescent across the mob, a contact star, and sparks off the blade. */
function slash(dot: Dot, ax: number, ag: number, ah: number, age: number, big: boolean): void {
  const frame = Math.floor(age * FPS);
  const r = big ? 17 : 13;
  const cx = ax - 3;
  const cy = ag - Math.round(ah * 0.55);
  // Overhead diagonal: from up behind the swing, down and through the mob.
  crescent(dot, cx, cy, r, -2.4, 0.9, frame, 1);
  // A crit cuts back the other way a frame later.
  if (big) crescent(dot, cx + 1, cy + 1, r - 2, 2.5, -0.7, frame - 1, 2);

  // Contact star: a four-point glint where the blade meets the mob.
  if (frame <= 1) {
    const sx = ax - 5;
    const sy = cy + 2;
    const arm = frame === 0 ? (big ? 6 : 4) : big ? 4 : 3;
    dot(sx - arm, sy, STEEL[1], arm * 2 + 1, 1);
    dot(sx, sy - arm, STEEL[1], 1, arm * 2 + 1);
    dot(sx - 1, sy - 1, STEEL[0], 3, 3);
  }

  // Sparks fly forward off the blade and drop.
  const n = big ? 10 : 6;
  for (let i = 0; i < n; i++) {
    const t = age - 0.03;
    if (t < 0) continue;
    const ang = -0.9 + hash(i, 0, 31) * 1.5;
    const v = 70 + hash(i, 1, 31) * 60;
    const gx = Math.round(ax - 4 + Math.cos(ang) * v * t);
    const gy = Math.round(cy + Math.sin(ang) * v * t + 90 * t * t);
    if (t > 0.25 + hash(i, 2, 31) * 0.12) continue;
    dot(gx, gy, SPARK[i % 3], t < 0.1 ? 2 : 1, 1);
  }
}
