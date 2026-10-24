// Pixel-art spell effects, drawn in whole art pixels (PIXEL screen px each) to match the backdrop.
// Each effect is a pure function of its age, animated at a low frame rate like sprite art.
import { PIXEL as P } from "./backdrop";

export type SpellFxKind = "wildfire";

/** An effect anchored to the mob: x follows it, so a knocked-back mob keeps its effect. */
export interface SpellFx {
  kind: SpellFxKind;
  /** Scene time it started. */
  born: number;
}

/** Effects by reaction name. */
export const REACTION_FX: Partial<Record<string, SpellFxKind>> = { Wildfire: "wildfire" };

export const SPELL_FX_DUR: Record<SpellFxKind, number> = { wildfire: 1.2 };

/** Animation frames per second; low on purpose so the flicker reads as pixel art. */
const FPS = 12;

/** Stable 0..1 noise for an art pixel on a given frame. */
function hash(a: number, b: number, c: number): number {
  let n = Math.imul(a, 374761393) + Math.imul(b, 668265263) + Math.imul(c, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

const FIRE = ["#fff6c2", "#ffd34a", "#ff9a2a", "#e8501f", "#9c2a1a"];
const WIND = ["#eafcff", "#a9e4ef"];
const SMOKE = ["#3d3236", "#5c4a4a"];

/** Draw every live effect. x is the mob's screen x, ground the screen y of the floor. */
export function drawSpellFx(ctx: CanvasRenderingContext2D, list: SpellFx[], now: number, x: number, ground: number): void {
  for (const f of list) {
    const age = now - f.born;
    if (age < 0 || age >= SPELL_FX_DUR[f.kind]) continue;
    const ax = Math.round(x / P);
    const ag = Math.round(ground / P);
    const dot = (gx: number, gy: number, color: string, w = 1, h = 1) => {
      ctx.fillStyle = color;
      ctx.fillRect(gx * P, gy * P, w * P, h * P);
    };
    if (f.kind === "wildfire") wildfire(dot, ax, ag, age);
  }
}

type Dot = (gx: number, gy: number, color: string, w?: number, h?: number) => void;

/** Fire + Air: a gust whips the flames into a spinning fire tornado around the mob. */
function wildfire(dot: Dot, ax: number, ag: number, age: number): void {
  const frame = Math.floor(age * FPS);
  const dur = SPELL_FX_DUR.wildfire;
  // Gust: wind streaks rush in from both sides before the funnel catches.
  if (age < 0.3) {
    const k = age / 0.3;
    for (let i = 0; i < 6; i++) {
      const gy = ag - 4 - i * 4 - (i % 2) * 2;
      const reach = Math.round((1 - k) * (22 + (i % 3) * 5));
      const len = 3 + (i % 3) * 2;
      dot(ax - 4 - reach - len, gy, WIND[i % 2], len, 1);
      dot(ax + 4 + reach, gy + 1, WIND[(i + 1) % 2], len, 1);
    }
  }
  // Funnel: narrow at the ground, wide at the top; rises fast, then burns down from the bottom.
  const rows = 40;
  const fireRows = 33;
  const rise = Math.min(1, age / 0.25);
  const top = Math.round(rows * rise);
  const fade = Math.max(0, (age - (dur - 0.45)) / 0.45);
  const bottom = Math.round(rows * fade);
  const spin = age * 14;
  for (let r = bottom; r < top; r++) {
    const smoke = r >= fireRows;
    const width = smoke ? 12 - (r - fireRows) * 0.9 : 2 + r * 0.3;
    const sway = Math.round(Math.sin(r * 0.3 - age * 9) * 2);
    for (let c = -Math.ceil(width); c <= Math.ceil(width); c++) {
      const d = Math.abs(c) / width;
      // Ragged edge that flickers per frame.
      if (d > 1 - hash(r, c, frame) * 0.35) continue;
      const n = hash(c, r, frame + 7);
      if (smoke) {
        // Smoke breaks up into dithered puffs.
        if (n < 0.45) continue;
        dot(ax + c + sway, ag - 1 - r, n > 0.8 ? SMOKE[1] : SMOKE[0]);
        continue;
      }
      // The core flickers open so the mob shows through the flames.
      if (d < 0.55 && r > 6 && n < 0.3) continue;
      const heat = d * 0.7 + (r / fireRows) * 0.5 + n * 0.25;
      dot(ax + c + sway, ag - 1 - r, FIRE[Math.min(FIRE.length - 1, Math.floor(heat * FIRE.length * 0.85))]);
    }
    // Wind bands spiral round the funnel; only the front half of each band shows.
    if (!smoke && r % 4 === 1) {
      const a = spin + r * 0.5;
      if (Math.cos(a) > -0.2) {
        const len = Math.max(2, Math.round(width * 0.9));
        dot(ax + sway + Math.round(Math.sin(a) * width) - (len >> 1), ag - 1 - r, WIND[(r >> 2) % 2], len, 1);
      }
    }
  }
  // Embers fly up and out along the spin.
  for (let i = 0; i < 18; i++) {
    const seed = hash(i, 3, 11);
    const t = age - seed * 0.4;
    if (t < 0) continue;
    const a = seed * 6.28 + t * 9;
    const rad = 4 + t * (14 + seed * 10);
    const gy = ag - 4 - Math.round(t * (40 + seed * 30));
    if (gy < ag - 48) continue;
    dot(ax + Math.round(Math.cos(a) * rad), gy, hash(i, frame, 5) > 0.5 ? FIRE[1] : FIRE[2]);
  }
}
