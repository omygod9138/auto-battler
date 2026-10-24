// Pixel-art spell effects, drawn in whole art pixels (PIXEL screen px each) to match the backdrop.
// Each effect is a pure function of its age, animated at a low frame rate like sprite art.
import { PIXEL as P } from "./backdrop";

export type SpellFxKind = "wildfire" | "storm" | "sandstorm";

/** An effect anchored to the mob: x follows it, so a knocked-back mob keeps its effect. */
export interface SpellFx {
  kind: SpellFxKind;
  /** Scene time it started. */
  born: number;
}

/** Effects by reaction name. */
export const REACTION_FX: Partial<Record<string, SpellFxKind>> = { Wildfire: "wildfire", Storm: "storm", Sandstorm: "sandstorm" };

export const SPELL_FX_DUR: Record<SpellFxKind, number> = { wildfire: 1.2, storm: 1.2, sandstorm: 1.1 };

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
const CLOUD = ["#3e4058", "#646884", "#9a9fbc", "#d2d6ea"];
const RAIN = "#8fb8e0";
const BOLT = ["#ffffff", "#fff59a", "#9fd8ff"];
const SAND = ["#f4e2a8", "#d9b46a", "#b08848", "#7a5a32"];

/** Fills whole art pixels on ctx. */
const dotter = (ctx: CanvasRenderingContext2D): Dot => (gx, gy, color, w = 1, h = 1) => {
  ctx.fillStyle = color;
  ctx.fillRect(gx * P, gy * P, w * P, h * P);
};

/** Draw every live effect. x is the mob's screen x, ground the screen y of the floor, h the mob's height. */
export function drawSpellFx(ctx: CanvasRenderingContext2D, list: SpellFx[], now: number, x: number, ground: number, h: number): void {
  const dot = dotter(ctx);
  const ax = Math.round(x / P);
  const ag = Math.round(ground / P);
  const ah = Math.round(h / P);
  for (const f of list) {
    const age = now - f.born;
    if (age < 0 || age >= SPELL_FX_DUR[f.kind]) continue;
    if (f.kind === "wildfire") wildfire(dot, ax, ag, age);
    if (f.kind === "storm") storm(dot, ax, ag, ah, age, ctx);
    if (f.kind === "sandstorm") sandstorm(dot, ax, ag, ah, age);
  }
}

/** A lingering state left on the mob (not a ground zone), drawn until it runs out. Returns false if it has no pixel art yet. */
export function drawDerivedFx(ctx: CanvasRenderingContext2D, kind: string, x: number, ground: number, h: number, t: number, fade: number): boolean {
  if (kind === "sandstorm") {
    ctx.globalAlpha = fade;
    sandSwirl(dotter(ctx), Math.round(x / P), Math.round(ground / P), Math.round(h / P), t);
    ctx.globalAlpha = 1;
    return true;
  }
  if (kind !== "storm") return false;
  const dot = dotter(ctx);
  ctx.globalAlpha = fade;
  // A small rain cloud hangs over the mob, waiting for fire (Plasma) or water (Electrocute).
  const ax = Math.round(x / P) + Math.round(Math.sin(t * 2) * 2);
  const top = Math.round(ground / P) - Math.round(h / P) - 18;
  const frame = Math.floor(t * FPS);
  cloud(dot, ax, top, 9, frame);
  for (let i = 0; i < 6; i++) {
    const fall = (frame * 2 + i * 5) % 12;
    dot(ax - 7 + i * 3, top + 8 + fall, RAIN, 1, 2);
  }
  // Now and then a spark flickers inside it.
  if (hash(frame >> 2, 1, 9) > 0.7 && frame % 4 < 2) dot(ax - 2 + Math.round(hash(frame, 2, 3) * 4), top + 4, BOLT[1], 1, 3);
  ctx.globalAlpha = 1;
  return true;
}

/** A lumpy cloud centred on ax, about 2*half pixels wide: lit on top, dark underneath. */
function cloud(dot: Dot, ax: number, top: number, half: number, frame: number): void {
  if (half < 1) return;
  const tall = Math.round(half * 0.6) + 3;
  const lumps = [[-0.55, 0.45, 0.45], [0, 0.15, 0.6], [0.55, 0.35, 0.5], [-0.1, 0.6, 0.6]];
  for (let y = 0; y < tall; y++) {
    for (let c = -half - 2; c <= half + 2; c++) {
      let inside = false;
      let edge = 9;
      for (const [lx, ly, lr] of lumps) {
        const dx = (c - lx * half) / (lr * half * 1.3);
        const dy = (y - ly * tall) / (lr * tall);
        const d = dx * dx + dy * dy;
        if (d < 1) inside = true;
        edge = Math.min(edge, d);
      }
      if (!inside) continue;
      const k = y / tall;
      const lit = k < 0.35 && edge < 0.75 - hash(c, y, frame >> 2) * 0.2;
      dot(ax + c, top + y, k > 0.75 ? CLOUD[0] : lit ? (k < 0.15 ? CLOUD[3] : CLOUD[2]) : CLOUD[1]);
    }
  }
}

/** Water + Air: a thundercloud gathers over the mob and a lightning bolt cracks down into it, leaving it crackling. */
function storm(dot: Dot, ax: number, ag: number, ah: number, age: number, ctx: CanvasRenderingContext2D): void {
  const frame = Math.floor(age * FPS);
  const dur = SPELL_FX_DUR.storm;
  const top = ag - ah - 30;
  // Cloud rolls in wide and fast, then thins out.
  const grow = Math.min(1, age / 0.18);
  const thin = Math.max(0, (age - (dur - 0.3)) / 0.3);
  if (thin < 1) {
    cloud(dot, ax, top, Math.round(20 * grow * (1 - thin * 0.6)), frame);
    for (let i = 0; i < 18 * grow * (1 - thin); i++) {
      const fall = (frame * 3 + i * 7) % (ag - top - 14);
      dot(ax - 18 + Math.round(hash(i, 4, 1) * 36), top + 12 + fall, RAIN, 1, 2);
    }
  }
  // Two strikes: the main bolt, then a quick re-strike down the same channel.
  const strike = (age >= 0.16 && age < 0.42) || (age >= 0.5 && age < 0.6);
  if (strike) {
    const seed = age < 0.5 ? 1 : 2;
    // The sky lights up on the first frames of each strike.
    if (frame % 6 < 2) {
      ctx.fillStyle = "rgba(220,235,255,0.22)";
      ctx.fillRect(-50, -50, 2000, 1000);
    }
    let x = ax + Math.round((hash(seed, 0, 5) - 0.5) * 6);
    const end = ag - Math.round(ah * 0.4);
    for (let y = top + 11; y < end; y += 3) {
      const nx = ax + Math.round((hash(seed, y, frame >> 1) - 0.5) * 10 * (1 - (y - top) / (end - top)));
      const step = Math.sign(nx - x);
      for (let k = 0; k < 3; k++) {
        if (k === 1) x += step;
        dot(x - 1, y + k, BOLT[2]);
        dot(x + 2, y + k, BOLT[1]);
        dot(x, y + k, BOLT[0], 2, 1);
      }
      // Side branches fork off and die out.
      if (hash(seed, y, 77) > 0.8) {
        const dir = hash(seed, y, 78) > 0.5 ? 1 : -1;
        for (let b = 1; b < 6; b++) dot(x + dir * b, y + b, b < 3 ? BOLT[1] : BOLT[2]);
      }
    }
    // Impact: a white burst where it lands.
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      const r = 3 + (frame % 3) * 2;
      dot(ax + Math.round(Math.cos(a) * r), end + Math.round(Math.sin(a) * r * 0.6), i % 2 ? BOLT[0] : BOLT[1]);
    }
  }
  // Stunned: little arcs crawl over the mob until the cloud clears.
  if (age > 0.42) {
    for (let i = 0; i < 3; i++) {
      if (hash(i, frame, 21) < 0.4) continue;
      const cx = ax + Math.round((hash(i, frame, 22) - 0.5) * 14);
      const cy = ag - 4 - Math.round(hash(i, frame, 23) * (ah - 6));
      for (let k = 0; k < 4; k++) dot(cx + k, cy + (k % 2 ? -1 : 0), k % 2 ? BOLT[1] : BOLT[2]);
    }
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

/** Earth + Air: a wall of sand blasts in from the hero's side, pelting the mob with grit and shoving it back. */
function sandstorm(dot: Dot, ax: number, ag: number, ah: number, age: number): void {
  const frame = Math.floor(age * FPS);
  const dur = SPELL_FX_DUR.sandstorm;
  const fade = Math.max(0, (age - (dur - 0.35)) / 0.35);
  // The dust front sweeps across the mob, then hangs as a dithered haze that thins out.
  const front = ax - 30 + Math.round(Math.min(1, age / 0.25) * 42);
  const span = ah + 6;
  for (let y = 0; y < span; y++) {
    const edge = front - Math.round(Math.abs(Math.sin(y * 0.4 + frame * 0.8)) * 4);
    for (let x = front - 34; x < edge; x++) {
      // Billowing top edge, so the haze isn't a box.
      if (y > span * (0.7 + 0.3 * Math.sin(x * 0.25 + frame * 0.6))) continue;
      const n = hash(x, y, frame);
      // Denser near the ground and the front edge.
      const dense = 0.05 + 0.35 * (1 - y / span) + 0.3 * (1 - (edge - x) / 34) - fade * 0.6;
      if (n > dense) continue;
      dot(x, ag - 1 - y, n < dense * 0.3 ? SAND[3] : n < dense * 0.7 ? SAND[2] : SAND[1]);
    }
  }
  // Streaks of grit race left to right across it.
  for (let i = 0; i < 26 * (1 - fade); i++) {
    const speed = 90 + hash(i, 1, 2) * 80;
    const x = ax - 40 + Math.round((age * speed + hash(i, 3, 4) * 80) % 80);
    const y = ag - 2 - Math.round(hash(i, 5, 6) * span);
    const len = 3 + Math.round(hash(i, 7, 8) * 4);
    dot(x, y, i % 3 ? SAND[0] : SAND[1], len, 1);
  }
  // Pebbles tumble along with it.
  for (let i = 0; i < 6 * (1 - fade); i++) {
    const t = age - hash(i, 9, 1) * 0.3;
    if (t < 0) continue;
    const x = ax - 26 + Math.round(t * (70 + hash(i, 2, 9) * 40));
    const y = ag - 3 - Math.round(hash(i, 4, 9) * ah * 0.8) + Math.round(Math.abs(Math.sin(t * 14 + i)) * -3);
    dot(x, y, SAND[3], 2, 2);
    dot(x, y, SAND[2]);
  }
}

/** The sand left swirling round the mob, blinding it: grains orbit its body. */
function sandSwirl(dot: Dot, ax: number, ag: number, ah: number, t: number): void {
  const frame = Math.floor(t * FPS);
  for (let i = 0; i < 56; i++) {
    const h = hash(i, 11, 3);
    const y = ag - 2 - Math.round(h * (ah + 4));
    const r = 9 + Math.round(h * 6);
    const a = hash(i, 12, 5) * 6.28 + frame * 0.35 * (1.2 - h * 0.5);
    const x = ax + Math.round(Math.cos(a) * r);
    const yy = y + Math.round(Math.sin(a) * 2);
    // Grains in front of the mob are brighter than those behind it.
    dot(x, yy, Math.sin(a) > 0 ? (i % 2 ? SAND[0] : SAND[1]) : SAND[2], i % 4 ? 1 : 2, 1);
  }
}
