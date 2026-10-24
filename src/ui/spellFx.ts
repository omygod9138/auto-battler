// Pixel-art spell effects, drawn in whole art pixels (PIXEL screen px each) to match the backdrop.
// Each effect is a pure function of its age, animated at a low frame rate like sprite art.
import { PIXEL as P } from "./backdrop";

export type SpellFxKind = "wildfire" | "storm" | "sandstorm" | "mud" | "plasma" | "clay" | "glass" | "lava" | "steam" | "eruption" | "obsidian" | "electrocute" | "fireball" | "gust" | "tidalWave" | "stoneSpike";

/** An effect anchored to the mob: x follows it, so a knocked-back mob keeps its effect. */
export interface SpellFx {
  kind: SpellFxKind;
  /** Scene time it started. */
  born: number;
}

/** Effects by reaction name. */
export const REACTION_FX: Partial<Record<string, SpellFxKind>> = { Wildfire: "wildfire", Storm: "storm", Sandstorm: "sandstorm", Mud: "mud", Plasma: "plasma", Clay: "clay", Glass: "glass", Lava: "lava", Steam: "steam", Eruption: "eruption", Obsidian: "obsidian", Electrocute: "electrocute" };

export const SPELL_FX_DUR: Record<SpellFxKind, number> = { wildfire: 1.2, storm: 1.2, sandstorm: 1.1, mud: 1.0, plasma: 1.1, clay: 3, glass: 1.2, lava: 1.0, steam: 1.0, eruption: 1.6, obsidian: 2.4, electrocute: 1.7, fireball: 0.8, gust: 0.75, tidalWave: 1.15, stoneSpike: 1.0 };

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
const MUD = ["#2a1c12", "#4a3322", "#6e4c2c", "#94703f", "#d8c09a", "#7f8c8a"];
const PLASMA = ["#ffffff", "#ffd6ff", "#ff7ae0", "#c23cff", "#5a1a9a"];
const CLAY = ["#4a2214", "#7e3e22", "#b0603a", "#d98c5a", "#f2be92"];
const STEAM = ["#f2f4f8", "#c9ced8", "#9aa3b4"];
const GLASS = ["#ffffff", "#d8f6ff", "#8fdcf0", "#4aa8c8", "#2a6a8a"];
const LAVA = ["#2a0e08", "#5a1a0c", "#c2380f", "#ff7a1a", "#ffc23a", "#fff1a0"];
const WATER = ["#e6f6ff", "#8fd0ff", "#4a90d0"];
const OBSIDIAN = ["#0c0a14", "#1e1a2e", "#3a3354", "#6a5d94", "#c4b4ff", "rgba(30,26,46,0.7)"];
const WAVE = ["#ffffff", "#c4ecff", "#6cbcf2", "#3a86d0", "#22579e", "#163a72"];
const STONE = ["#d8ccb4", "#a8977a", "#7c6b56", "#56493b", "#2e2620"];
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
    if (f.kind === "mud") mudSplash(dot, ax, ag, ah, age);
    if (f.kind === "plasma") plasma(dot, ax, ag, ah, age);
    if (f.kind === "clay") clay(dot, ax, ag, ah, age);
    if (f.kind === "glass") glass(dot, ax, ag, ah, age);
    if (f.kind === "lava") lavaBurst(dot, ax, ag, age);
    if (f.kind === "steam") steamBurst(dot, ax, ag, ah, age);
    if (f.kind === "eruption") eruption(dot, ax, ag, ah, age);
    if (f.kind === "obsidian") obsidian(dot, ax, ag, ah, age);
    if (f.kind === "electrocute") electrocute(dot, ax, ag, ah, age, ctx);
    if (f.kind === "fireball") fireballBlast(dot, ax, ag, ah, age);
    if (f.kind === "gust") gustHit(dot, ax, ag, ah, age);
    if (f.kind === "tidalWave") tidalHit(dot, ax, ag, ah, age);
    if (f.kind === "stoneSpike") stoneHit(dot, ax, ag, ah, age);
  }
}

/** A ground zone between screen x0 and x1. Returns false if it has no pixel art yet. */
export function drawZoneFx(ctx: CanvasRenderingContext2D, kind: string, x0: number, x1: number, ground: number, t: number, fade: number): boolean {
  if (kind !== "mud" && kind !== "lava") return false;
  ctx.globalAlpha = fade;
  (kind === "mud" ? mudPuddle : lavaPool)(dotter(ctx), Math.round((x0 + x1) / 2 / P), Math.round((x1 - x0) / 2 / P), Math.round(ground / P), t);
  ctx.globalAlpha = 1;
  return true;
}

/** A lingering state left on the mob (not a ground zone), drawn until it runs out. Returns false if it has no pixel art yet. */
export function drawDerivedFx(ctx: CanvasRenderingContext2D, kind: string, x: number, ground: number, h: number, t: number, fade: number): boolean {
  if (kind === "steam") {
    ctx.globalAlpha = fade;
    steamVeil(dotter(ctx), Math.round(x / P), Math.round(ground / P), Math.round(h / P), t);
    ctx.globalAlpha = 1;
    return true;
  }
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

/** Water + Earth: water crashes down and the ground under the mob bursts up as mud. */
function mudSplash(dot: Dot, ax: number, ag: number, ah: number, age: number): void {
  // Water pours down onto the mob first.
  if (age < 0.22) {
    for (let i = 0; i < 12; i++) {
      const y = ag - ah - 14 + Math.round((age / 0.22) * (ah + 12)) - Math.round(hash(i, 1, 1) * 10);
      dot(ax - 10 + Math.round(hash(i, 2, 2) * 20), Math.min(y, ag - 1), WATER[i % 3], 1, 2);
    }
  }
  // Then globs of mud fly up and out, and splat back down.
  const t = age - 0.15;
  if (t < 0) return;
  for (let i = 0; i < 22; i++) {
    const side = i % 2 ? 1 : -1;
    const vx = side * (8 + hash(i, 3, 3) * 34);
    const vy = 50 + hash(i, 4, 4) * 55;
    const x = ax + side * 2 + Math.round(vx * t);
    const y = ag - 1 - Math.round(vy * t - 130 * t * t);
    if (y >= ag) {
      // Landed: a flat splat that fades.
      if (t < 0.75) dot(x - 1, ag - 1, MUD[2], 3, 1);
      continue;
    }
    const big = i % 3 === 0;
    dot(x, y, MUD[2], big ? 3 : 2, big ? 3 : 2);
    dot(x + (big ? 2 : 1), y + (big ? 2 : 1), MUD[1]);
    dot(x, y, MUD[4]);
  }
  // A brown ring of earth heaves up around the feet.
  if (t < 0.35) {
    const r = 3 + Math.round(t * 50);
    for (let c = -r; c <= r; c++) if (Math.abs(c) > r - 3) dot(ax + c, ag - 1 - Math.round(hash(c, 5, 5) * 2), MUD[2]);
  }
}

/** A glossy mud puddle with bubbles that swell and pop. */
function mudPuddle(dot: Dot, cx: number, hw: number, ag: number, t: number): void {
  const frame = Math.floor(t * FPS);
  for (let dy = -2; dy <= 4; dy++) {
    const k = (dy - 1) / 3.6;
    const w = Math.round((hw + 3) * Math.sqrt(Math.max(0, 1 - k * k)));
    for (let c = -w; c <= w; c++) {
      // Ragged, slowly wobbling rim.
      if (Math.abs(c) > w - 2 && hash(c, dy, frame >> 3) > 0.5) continue;
      const rim = Math.abs(c) > w - 3 || dy === -2;
      // A wet sheen of sky reflected in the middle rows.
      const sheen = (dy === -1 || dy === 0) && Math.abs(c) < w * 0.7 && hash(c, 7, (frame >> 2) + (c >> 2)) > 0.72;
      dot(cx + c, ag + dy, sheen ? (dy === -1 ? MUD[4] : MUD[5]) : rim ? MUD[1] : dy >= 3 ? MUD[0] : MUD[2]);
    }
  }
  // Bubbles rise, swell and pop on their own clocks.
  for (let i = 0; i < 5; i++) {
    const p = (t * 0.7 + hash(i, 8, 8)) % 1;
    const bx = cx + Math.round((hash(i, 9, Math.floor(t * 0.7 + hash(i, 8, 8))) - 0.5) * hw * 1.4);
    if (p < 0.6) dot(bx, ag - 1, MUD[3]);
    else if (p < 0.85) {
      dot(bx - 1, ag - 3, MUD[3], 3, 2);
      dot(bx - 1, ag - 3, MUD[4]);
    } else {
      dot(bx - 3, ag - 4, MUD[3]);
      dot(bx + 3, ag - 5, MUD[3]);
      dot(bx, ag - 6, MUD[4]);
    }
  }
}

/** A filled pixel disc, its colour picked by distance from the centre (0..1). */
function disc(dot: Dot, cx: number, cy: number, r: number, color: (d: number, x: number, y: number) => string | null): void {
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      const d = Math.sqrt(x * x + y * y) / (r + 0.5);
      if (d > 1) continue;
      const c = color(d, x, y);
      if (c) dot(cx + x, cy + y, c);
    }
  }
}

/** Storm + Fire: flames feed the storm cloud into a ball of plasma that slams into the mob and bursts. */
function plasma(dot: Dot, ax: number, ag: number, ah: number, age: number): void {
  const frame = Math.floor(age * FPS);
  const top = ag - ah - 12;
  const mid = ag - Math.round(ah * 0.5);
  // Fire spirals up into the dying cloud.
  if (age < 0.35) {
    cloud(dot, ax, top - 6, Math.round(10 * (1 - age / 0.35)) + 2, frame);
    for (let i = 0; i < 12; i++) {
      const k = Math.min(1, age / 0.3 + hash(i, 1, 1) * 0.3);
      const a = hash(i, 2, 2) * 6.28 + age * 18;
      const r = Math.round((1 - k) * 18);
      dot(ax + Math.round(Math.cos(a) * r), top + Math.round(Math.sin(a) * r * 0.5) + Math.round((1 - k) * 14), FIRE[i % 3]);
    }
  }
  // The orb swells, crackling, then drops onto the mob.
  if (age >= 0.12 && age < 0.5) {
    const r = Math.min(7, Math.round((age - 0.12) * 40));
    const drop = age < 0.4 ? 0 : (age - 0.4) / 0.1;
    const cy = Math.round(top + (mid - top) * drop * drop);
    disc(dot, ax, cy, r, (d) => (d < 0.4 ? PLASMA[0] : d < 0.7 ? PLASMA[1] : hash(frame, 3, 3) > 0.5 ? PLASMA[2] : PLASMA[3]));
    for (let i = 0; i < 4; i++) {
      const a = hash(i, frame, 4) * 6.28;
      for (let k = r + 1; k < r + 4; k++) dot(ax + Math.round(Math.cos(a) * k) + (k % 2), cy + Math.round(Math.sin(a) * k), PLASMA[2]);
    }
  }
  // Burst: a white-hot core that cools to violet inside an expanding ring, throwing sparks.
  const t = age - 0.5;
  if (t < 0) return;
  const k = t / 0.6;
  const core = Math.round(10 * (1 - k));
  if (core > 0) disc(dot, ax, mid, core, (d, x, y) => (hash(x, y, frame) < k * 0.6 ? null : d < 0.3 * (1 - k) ? PLASMA[0] : d < 0.6 ? PLASMA[1] : PLASMA[2]));
  const ring = 6 + Math.round(easeOut(Math.min(1, k)) * 24);
  for (let i = 0; i < 64; i++) {
    const a = (i / 64) * 6.28;
    if (hash(i, frame, 6) < k * 0.6) continue;
    const rx = ax + Math.round(Math.cos(a) * ring);
    const ry = mid + Math.round(Math.sin(a) * ring * 0.8);
    dot(rx, ry, i % 3 ? PLASMA[2] : PLASMA[1]);
    dot(rx - Math.round(Math.cos(a)), ry - Math.round(Math.sin(a)), PLASMA[3]);
  }
  for (let i = 0; i < 14; i++) {
    const a = hash(i, 7, 7) * 6.28;
    const r = 4 + t * (50 + hash(i, 8, 8) * 40);
    dot(ax + Math.round(Math.cos(a) * r), mid + Math.round(Math.sin(a) * r * 0.7 + t * t * 40), k < 0.6 ? PLASMA[1] : PLASMA[4]);
  }
}

const easeOut = (k: number) => 1 - (1 - k) ** 3;

/** Mud + Fire: the fire bakes the mud puddle into clay, which sets hard round the mob's legs (rooted), then crumbles. */
function clay(dot: Dot, ax: number, ag: number, ah: number, age: number): void {
  const frame = Math.floor(age * FPS);
  const dur = SPELL_FX_DUR.clay;
  const hw = 16;
  // Baked ground: a cracked terracotta plate where the puddle was.
  const plateFade = age > dur - 0.4 ? (age - (dur - 0.4)) / 0.4 : 0;
  for (let dy = -1; dy <= 3; dy++) {
    const k = (dy - 1) / 3;
    const w = Math.round(hw * Math.sqrt(Math.max(0, 1 - k * k)));
    for (let c = -w; c <= w; c++) {
      if (hash(c, dy, 31) < plateFade) continue;
      const crack = hash(c >> 1, dy, 32) > 0.85 || (c + dy * 3) % 9 === 0;
      const hot = age < 0.35 && hash(c, dy, frame) > 0.5;
      dot(ax + c, ag + dy, hot ? FIRE[2] : crack ? CLAY[0] : dy === -1 ? CLAY[3] : CLAY[2]);
    }
  }
  // Flames lick along the puddle as it bakes.
  if (age < 0.4) {
    for (let i = 0; i < 10; i++) {
      const x = ax - hw + Math.round(hash(i, 1, 1) * hw * 2);
      const h = 2 + Math.round(hash(i, frame, 2) * 4 * (1 - age / 0.4));
      for (let y = 0; y < h; y++) dot(x, ag - 2 - y, FIRE[Math.min(4, y + (hash(i, y, frame) > 0.5 ? 1 : 0))]);
    }
  }
  // Steam hisses off as the water cooks out.
  if (age > 0.1 && age < 0.9) {
    for (let i = 0; i < 8; i++) {
      const t = age - 0.1 - hash(i, 3, 3) * 0.3;
      if (t < 0) continue;
      const x = ax - hw + Math.round(hash(i, 4, 4) * hw * 2) + Math.round(Math.sin(t * 6 + i) * 2);
      const y = ag - 3 - Math.round(t * 50);
      const r = 1 + Math.round(t * 3);
      if (t < 0.6) disc(dot, x, y, r, (d, px, py) => (hash(px, py, frame) > 0.3 + t ? (d < 0.5 ? STEAM[0] : STEAM[1]) : null));
    }
  }
  // The clay shell climbs the legs, holds, then cracks apart and falls.
  const rise = Math.min(1, Math.max(0, (age - 0.25) / 0.3));
  const shellH = Math.round(ah * 0.42 * rise);
  const crumble = Math.max(0, (age - (dur - 0.45)) / 0.45);
  for (let y = 0; y < shellH; y++) {
    const w = Math.round(8 - (y / Math.max(1, ah * 0.42)) * 3);
    for (let c = -w; c <= w; c++) {
      // Lumpy edge.
      if (Math.abs(c) === w && hash(c, y, 33) > 0.5) continue;
      let gy = ag - 1 - y;
      let gx = ax + c;
      if (crumble > 0) {
        // Chunks break off top-first and drop.
        const start = (1 - y / shellH) * 0.5 + hash(c >> 1, y >> 1, 34) * 0.3;
        const f = crumble - start;
        if (f > 0) {
          gy += Math.round(f * f * 120);
          gx += Math.round((hash(c >> 1, y >> 1, 35) - 0.5) * f * 20);
          if (gy >= ag) continue;
        }
      }
      // Two jagged cracks open once it has set.
      const crack = rise === 1 && age > 0.7 && (c === Math.round(Math.sin(y * 0.9) * 1.5) - 2 || (y > 3 && c === 3 + Math.round(Math.cos(y * 1.3))));
      const lit = c < -w + 2;
      const dark = c > w - 2;
      const n = hash(c, y, 38);
      dot(gx, gy, crack ? CLAY[0] : lit ? CLAY[4] : dark ? CLAY[1] : n > 0.8 ? CLAY[3] : n < 0.12 ? CLAY[1] : CLAY[2]);
    }
  }
  // Now and then a crumb flakes off the shell while it holds.
  if (rise === 1 && crumble === 0 && frame % 7 < 3) {
    const t = (frame % 7) / 3;
    dot(ax + (frame % 2 ? 7 : -8), ag - 4 - Math.round(hash(frame >> 3, 1, 37) * shellH * 0.6) + Math.round(t * 6), CLAY[1]);
  }
}

/** A glass shard: a short line in one of four directions, bright on one end. */
function shard(dot: Dot, x: number, y: number, dir: number, len: number): void {
  const [dx, dy] = [[1, 0], [1, -1], [0, -1], [-1, -1]][dir & 3];
  for (let k = 0; k < len; k++) dot(x + dx * k, y + dy * k, k === 0 ? GLASS[0] : k === len - 1 ? GLASS[3] : GLASS[2]);
}

/** Sandstorm + Fire: the swirling sand heats white-hot, fuses into a shell of glass round the mob, and shatters. */
function glass(dot: Dot, ax: number, ag: number, ah: number, age: number): void {
  const frame = Math.floor(age * FPS);
  const heat = [SAND[1], FIRE[2], FIRE[1], FIRE[0]];
  // Once fused, a faceted glass shell outlines the mob until it shatters.
  if (age >= 0.3 && age < 0.55) {
    const rx = 13;
    const ry = Math.round(ah * 0.6);
    const cy = ag - ry;
    for (let i = 0; i < 72; i++) {
      const a = (i / 72) * 6.28;
      const x = ax + Math.round(Math.cos(a) * rx);
      const y = cy + Math.round(Math.sin(a) * ry);
      if (y >= ag) continue;
      dot(x, y, i % 9 === 0 ? GLASS[0] : Math.cos(a) < 0 ? GLASS[1] : GLASS[3]);
      // Facet lines run inward from every few edge pixels.
      if (i % 9 === 4) for (let k = 1; k < 4; k++) dot(x - Math.round(Math.cos(a) * k), y - Math.round(Math.sin(a) * k * 0.6), GLASS[2]);
    }
  }
  for (let i = 0; i < 48; i++) {
    const h = hash(i, 11, 3);
    const baseY = ag - 2 - Math.round(h * (ah + 2));
    const r = 9 + Math.round(h * 5);
    const a0 = hash(i, 12, 5) * 6.28;
    if (age < 0.3) {
      // Grains spin faster and glow as they heat.
      const a = a0 + age * (6 + age * 30);
      const x = ax + Math.round(Math.cos(a) * r);
      const y = baseY + Math.round(Math.sin(a) * 2);
      dot(x, y, heat[Math.min(3, Math.floor((age / 0.3) * 4))], 2, 1);
      continue;
    }
    // Then they freeze in place as shards of a glass shell.
    const a = a0 + 0.3 * 15;
    const x0 = ax + Math.round(Math.cos(a) * r);
    const y0 = baseY + Math.round(Math.sin(a) * 2);
    const dir = Math.floor(hash(i, 13, 7) * 4);
    if (age < 0.55) {
      shard(dot, x0, y0, dir, 4);
      // A glint sweeps up the shell.
      const sweep = ag - Math.round(((age - 0.3) / 0.25) * (ah + 4));
      if (Math.abs(y0 - sweep) < 2) dot(x0, y0 - 1, GLASS[0], 2, 1);
      continue;
    }
    // Shatter: shards fly outward and fall, tumbling.
    const t = age - 0.55;
    const out = Math.sign(x0 - ax) || 1;
    const x = x0 + Math.round(out * t * (30 + h * 40));
    const y = y0 - Math.round(t * (25 + hash(i, 14, 9) * 25)) + Math.round(t * t * 140);
    if (y > ag) continue;
    shard(dot, x, y, dir + Math.floor(t * 10 + i), i % 2 ? 4 : 3);
  }
  // A white flash ring at the moment it shatters.
  if (age >= 0.55 && age < 0.75) {
    const r = 6 + Math.round((age - 0.55) * 90);
    for (let i = 0; i < 32; i++) {
      const a = (i / 32) * 6.28;
      if (hash(i, frame, 15) > 0.7) continue;
      dot(ax + Math.round(Math.cos(a) * r), ag - Math.round(ah * 0.5) + Math.round(Math.sin(a) * r * 0.8), i % 2 ? GLASS[0] : GLASS[1], 2, 1);
    }
  }
}

/** Fire + Earth: the ground under the mob splits along glowing cracks and magma spurts out. */
function lavaBurst(dot: Dot, ax: number, ag: number, age: number): void {
  const frame = Math.floor(age * FPS);
  // Cracks race outward along the ground.
  const reach = Math.round(Math.min(1, age / 0.2) * 22);
  const cool = Math.max(0, (age - 0.6) / 0.4);
  for (const side of [-1, 1]) {
    let y = ag;
    for (let k = 0; k < reach; k++) {
      if (hash(k, side, 41) > 0.7) y = ag + Math.round(hash(k, side, 42) * 2);
      if (hash(k, side, 43) < cool) continue;
      dot(ax + side * k, y, k < reach - 2 ? (frame % 2 ? LAVA[4] : LAVA[3]) : LAVA[5]);
      if (k % 6 === 3) dot(ax + side * k, y + 1, LAVA[2]);
    }
  }
  // Magma globs spurt up with glowing tails and splash back down.
  const t = age - 0.1;
  if (t < 0) return;
  for (let i = 0; i < 18; i++) {
    const side = i % 2 ? 1 : -1;
    const vx = side * (4 + hash(i, 3, 44) * 26);
    const vy = 60 + hash(i, 4, 45) * 60;
    const x = ax + Math.round(vx * t);
    const y = ag - 1 - Math.round(vy * t - 150 * t * t);
    if (y >= ag) {
      if (t < 0.8) dot(x - 1, ag - 1, LAVA[2], 3, 1);
      continue;
    }
    const big = i % 3 === 0;
    dot(x, y, LAVA[3], big ? 3 : 2, big ? 3 : 2);
    dot(x, y, LAVA[5]);
    // Tail: where it was a frame ago.
    const pt = Math.max(0, t - 0.05);
    dot(ax + Math.round(vx * pt), ag - 1 - Math.round(vy * pt - 150 * pt * pt), LAVA[2]);
  }
  // Dark smoke puffs rise off the cracks.
  for (let i = 0; i < 5; i++) {
    const st = t - hash(i, 5, 46) * 0.3;
    if (st < 0 || st > 0.7) continue;
    const x = ax - 14 + Math.round(hash(i, 6, 47) * 28);
    disc(dot, x, ag - 4 - Math.round(st * 40), 1 + Math.round(st * 4), (d, px, py) => (hash(px, py, frame) > 0.35 + st * 0.6 ? SMOKE[d < 0.5 ? 1 : 0] : null));
  }
}

/** A pool of molten rock: bright lava with dark crust plates drifting on it, and bubbles that pop into sparks. */
function lavaPool(dot: Dot, cx: number, hw: number, ag: number, t: number): void {
  const frame = Math.floor(t * FPS);
  for (let dy = -2; dy <= 4; dy++) {
    const k = (dy - 1) / 3.6;
    const w = Math.round((hw + 3) * Math.sqrt(Math.max(0, 1 - k * k)));
    for (let c = -w; c <= w; c++) {
      if (Math.abs(c) > w - 2 && hash(c, dy, frame >> 3) > 0.5) continue;
      const rim = Math.abs(c) > w - 3 || dy === -2;
      // Crust plates drift slowly sideways over the melt.
      const crust = hash((c + Math.floor(t * 3)) >> 2, dy >> 1, 48) > 0.72;
      const glow = Math.sin(c * 0.5 + dy + t * 5) > 0.6;
      dot(cx + c, ag + dy, rim ? LAVA[1] : crust ? (dy < 1 ? LAVA[1] : LAVA[0]) : glow ? LAVA[4] : dy >= 3 ? LAVA[2] : LAVA[3]);
    }
  }
  // Bubbles swell and burst into sparks.
  for (let i = 0; i < 5; i++) {
    const p = (t * 0.9 + hash(i, 8, 49)) % 1;
    const bx = cx + Math.round((hash(i, 9, Math.floor(t * 0.9 + hash(i, 8, 49))) - 0.5) * hw * 1.4);
    if (p < 0.6) dot(bx, ag - 1, LAVA[4]);
    else if (p < 0.85) {
      dot(bx - 1, ag - 3, LAVA[3], 3, 2);
      dot(bx, ag - 3, LAVA[5]);
    } else {
      const f = (p - 0.85) / 0.15;
      dot(bx - 2 - Math.round(f * 2), ag - 4 - Math.round(f * 4), LAVA[4]);
      dot(bx + 2 + Math.round(f * 2), ag - 5 - Math.round(f * 5), LAVA[5]);
      dot(bx, ag - 6 - Math.round(f * 6), LAVA[4]);
    }
  }
}

/** A soft dithered puff that thins out as k goes 0..1. */
function puff(dot: Dot, x: number, y: number, r: number, k: number, frame: number, seed: number): void {
  disc(dot, x, y, r, (d, px, py) => (hash(px + seed, py, frame >> 1) < k * k * 0.9 + d * d * 0.35 ? null : d < 0.45 ? STEAM[0] : d < 0.8 ? STEAM[1] : STEAM[2]));
}

/** Fire + Water: the water flashes to steam with a hiss, a scalding plume bursting out and up from the mob. */
function steamBurst(dot: Dot, ax: number, ag: number, ah: number, age: number): void {
  const frame = Math.floor(age * FPS);
  const cy = ag - Math.round(ah * 0.55);
  // Jets shoot out sideways first.
  if (age < 0.35) {
    const k = age / 0.35;
    for (const side of [-1, 1]) {
      for (let i = 0; i < 3; i++) {
        const len = Math.round(k * (16 + i * 4));
        const y = cy - 4 + i * 4;
        for (let c = 4; c < len; c += 2) if (hash(c, i * side, frame) > k * 0.6) dot(ax + side * c, y + Math.round(Math.sin(c * 0.4) * 1), c > len - 4 ? STEAM[0] : STEAM[1], 2, 1);
      }
    }
  }
  // Puffs billow out and up, growing as they thin.
  for (let i = 0; i < 18; i++) {
    const t = age - hash(i, 1, 51) * 0.25;
    if (t < 0) continue;
    const k = t / 0.8;
    if (k >= 1) continue;
    const a = hash(i, 2, 52) * 6.28;
    const out = 4 + easeOut(Math.min(1, k * 1.5)) * (10 + hash(i, 3, 53) * 10);
    const x = ax + Math.round(Math.cos(a) * out);
    const y = cy + Math.round(Math.sin(a) * out * 0.6) - Math.round(t * 30);
    puff(dot, x, y, 3 + Math.round(k * 5), k, frame, i * 7);
  }
  // Hot droplets spit out.
  for (let i = 0; i < 8; i++) {
    const t = age - 0.05;
    if (t < 0 || t > 0.5) break;
    const side = i % 2 ? 1 : -1;
    const x = ax + Math.round(side * (6 + t * (30 + hash(i, 4, 54) * 30)));
    const y = cy - Math.round(t * (40 + hash(i, 5, 55) * 30) - 120 * t * t);
    dot(x, y, i % 3 ? WATER[1] : WATER[0]);
  }
}

/** The steam left hanging round the mob's head, half-blinding it: thin wisps that drift up and fade. */
function steamVeil(dot: Dot, ax: number, ag: number, ah: number, t: number): void {
  const frame = Math.floor(t * FPS);
  const head = ag - ah + 4;
  for (let i = 0; i < 7; i++) {
    const p = (t * 0.6 + hash(i, 6, 56)) % 1;
    const x = ax + Math.round((hash(i, 7, Math.floor(t * 0.6 + hash(i, 6, 56))) - 0.5) * 20) + Math.round(Math.sin(t * 2 + i) * 2);
    const y = head + 6 - Math.round(p * 18);
    puff(dot, x, y, 3 + Math.round(p * 2), 0.2 + p * 0.8, frame, i * 13);
  }
}

/** Lava + Air: wind whips the pool into a volcano. A cone heaves up under the mob, a magma column blasts through it,
 * an ash cloud mushrooms overhead and burning rocks rain back down. */
function eruption(dot: Dot, ax: number, ag: number, ah: number, age: number): void {
  const frame = Math.floor(age * FPS);
  // Low enough that the ash cloud stays on screen.
  const top = Math.max(22, ag - ah - 12);
  // The ground swells into a glowing cone, then slumps back.
  const swell = age < 0.15 ? age / 0.15 : Math.max(0, 1 - (age - 1.0) / 0.5);
  const coneH = Math.round(swell * 10);
  for (let y = 0; y < coneH; y++) {
    const w = Math.round((coneH - y) * 1.3) + 3;
    for (let c = -w; c <= w; c++) {
      if (Math.abs(c) === w && hash(c, y, 60) > 0.5) continue;
      // Dark rock, lit from the right, with lava running down the vent's sides.
      const vent = Math.abs(c) < 2 + (y > coneH - 3 ? 1 : 0);
      const rill = Math.abs(Math.abs(c) - (coneH - y) * 0.6 - 1) < 0.6 && hash(c > 0 ? 1 : 0, 0, 61) > 0.2;
      const rock = c > w * 0.3 ? SMOKE[1] : SMOKE[0];
      dot(ax + c, ag - y, vent ? LAVA[frame % 2 ? 5 : 4] : rill ? LAVA[3] : hash(c, y, 61) > 0.85 ? LAVA[1] : rock);
    }
  }
  // The magma column: thick and bright at first, thinning to a spout.
  if (age > 0.08 && age < 0.9) {
    const k = (age - 0.08) / 0.82;
    const rise = Math.round(easeOut(Math.min(1, k * 4)) * (ag - top));
    const hw = Math.max(1, Math.round(6 * (1 - k * 0.85)));
    for (let y = 0; y < rise; y++) {
      const wob = Math.round(Math.sin(y * 0.35 + frame) * 1);
      for (let c = -hw; c <= hw; c++) {
        if (Math.abs(c) === hw && hash(c, y, frame) > 0.6) continue;
        const core = Math.abs(c) < hw * 0.5;
        dot(ax + c + wob, ag - coneH - y, core ? (y > rise - 3 ? LAVA[5] : LAVA[4]) : LAVA[3]);
      }
    }
  }
  // Ash cloud mushrooms out at the top, then drifts with the wind.
  if (age > 0.2) {
    const k = Math.min(1, (age - 0.2) / 0.5);
    const fade = Math.max(0, (age - 1.0) / 0.6);
    const drift = Math.round(Math.max(0, age - 0.6) * 14);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI;
      const out = easeOut(k) * (8 + hash(i, 1, 62) * 8);
      const x = ax + drift + Math.round(Math.cos(a) * out * 1.6);
      const y = top - Math.round(Math.sin(a) * out * 0.7) + 2;
      const r = 3 + Math.round(k * 4);
      disc(dot, x, y, r, (d, px, py) => (hash(px + i * 5, py, frame >> 1) < fade * 0.9 + d * d * 0.3 ? null : d < 0.4 && py < 0 ? SMOKE[1] : d > 0.7 && py > 0 ? LAVA[1] : SMOKE[0]));
    }
    // Glow from the vent lights the cloud's belly.
    if (age < 0.9) for (let c = -6; c <= 6; c += 2) if (hash(c, frame, 63) > 0.4) dot(ax + drift + c, top + 4, LAVA[3]);
  }
  // Burning rocks fly out in arcs and crash back down.
  const t = age - 0.12;
  if (t > 0) {
    for (let i = 0; i < 12; i++) {
      const side = i % 2 ? 1 : -1;
      const vx = side * (10 + hash(i, 2, 64) * 34);
      const vy = 90 + hash(i, 3, 65) * 70;
      const lt = t - hash(i, 4, 66) * 0.25;
      if (lt < 0) continue;
      const x = ax + Math.round(vx * lt);
      const y = ag - 6 - Math.round(vy * lt - 140 * lt * lt);
      if (y >= ag) {
        // A splash of embers where it lands.
        if (y < ag + 18) {
          dot(x - 2, ag - 1, LAVA[3], 5, 1);
          dot(x, ag - 2, LAVA[5]);
        }
        continue;
      }
      const big = i % 3 === 0;
      const pt = Math.max(0, lt - 0.06);
      dot(ax + Math.round(vx * pt), ag - 6 - Math.round(vy * pt - 140 * pt * pt), SMOKE[1], 2, 2);
      dot(x, y, LAVA[1], big ? 4 : 3, big ? 4 : 3);
      dot(x + 1, y + 1, LAVA[frame % 2 ? 4 : 3], big ? 2 : 1, big ? 2 : 1);
    }
  }
  // A shock ring of dust and sparks along the ground.
  if (age < 0.5) {
    const k = age / 0.5;
    const r = 6 + Math.round(easeOut(k) * 30);
    for (const side of [-1, 1]) for (let i = 0; i < 4; i++) if (hash(i, side, frame) > k * 0.8) dot(ax + side * (r - i * 2), ag - 1 - (i % 2), i ? SAND[2] : LAVA[4], 2, 1);
  }
}

/** Lava + Water: water floods the pool, it hisses to steam and sets into black volcanic glass that
 * spikes up round the mob and locks it in (stunned), then shatters into shards. */
function obsidian(dot: Dot, ax: number, ag: number, ah: number, age: number): void {
  const frame = Math.floor(age * FPS);
  const dur = SPELL_FX_DUR.obsidian;
  const hw = 16;
  const shatter = Math.max(0, (age - (dur - 0.45)) / 0.45);
  // The pool cools from glowing lava to glossy black, the last cracks fading out.
  const cool = Math.min(1, age / 0.6);
  for (let dy = -1; dy <= 3; dy++) {
    const k = (dy - 1) / 3;
    const w = Math.round(hw * Math.sqrt(Math.max(0, 1 - k * k)));
    for (let c = -w; c <= w; c++) {
      if (hash(c, dy, 71) < shatter) continue;
      const crack = hash(c >> 1, dy, 72) > 0.82;
      const hot = hash(c, dy, 73) > cool;
      const shine = dy === -1 && (c + frame) % 11 === 0;
      dot(ax + c, ag + dy, hot ? (hash(c, dy, frame) > 0.5 ? LAVA[3] : LAVA[4]) : crack && cool < 1 ? LAVA[2] : shine ? OBSIDIAN[4] : dy === -1 ? OBSIDIAN[2] : OBSIDIAN[1]);
    }
  }
  // A sheet of water crashes down onto it.
  if (age < 0.3) {
    for (let i = 0; i < 16; i++) {
      const x = ax - hw + Math.round(hash(i, 1, 74) * hw * 2);
      const y = ag - 30 + Math.round((age / 0.3) * 30) - Math.round(hash(i, 2, 74) * 8);
      if (y < ag - 1) dot(x, y, i % 3 ? WATER[1] : WATER[0], 1, 2);
    }
  }
  // Steam hisses off as it sets.
  for (let i = 0; i < 10; i++) {
    const t = age - 0.15 - hash(i, 3, 75) * 0.3;
    if (t < 0 || t > 0.8) continue;
    const x = ax - hw + Math.round(hash(i, 4, 75) * hw * 2);
    puff(dot, x, ag - 3 - Math.round(t * 40), 2 + Math.round(t * 5), t / 0.8, frame, i * 11);
  }
  // Glass spikes shoot up round the mob: tall at the sides, lower in front so its face shows through.
  const rise = easeOut(Math.min(1, Math.max(0, (age - 0.2) / 0.25)));
  if (rise <= 0) return;
  const spikes = [[-10, 0.75, 3], [-7, 0.95, 3], [-3, 0.5, 3], [1, 0.4, 3], [5, 0.85, 3], [9, 0.65, 3], [-12, 0.4, 2], [12, 0.35, 2]];
  spikes.forEach(([off, tall, half], i) => {
    const h = Math.round(ah * tall * rise);
    const lean = off * 0.08;
    for (let y = 0; y < h; y++) {
      const tip = Math.max(0, (y - h * 0.55) / (h * 0.45));
      const w = Math.max(0, Math.round(half * (1 - tip)));
      for (let c = -w; c <= w; c++) {
        let gx = ax + off + c + Math.round(lean * y * 0.3);
        let gy = ag - 1 - y;
        if (shatter > 0) {
          // Chunks fly out and fall.
          const f = shatter - hash(i, y >> 2, 76) * 0.3;
          if (f > 0) {
            gx += Math.round((off >= 0 ? 1 : -1) * f * (20 + hash(i, y >> 2, 77) * 30));
            gy += Math.round(-f * 30 + f * f * 160);
            if (gy >= ag) continue;
          }
        }
        // Lit left face, dark right face, see-through middle; a glint slides up each spike.
        const glint = Math.abs(y - ((frame * 2 + i * 7) % (h + 12))) < 1;
        const color = glint ? OBSIDIAN[4] : c === -w ? OBSIDIAN[3] : c === w ? OBSIDIAN[0] : c < 0 ? OBSIDIAN[2] : OBSIDIAN[5];
        dot(gx, gy, color);
      }
    }
  });
  // The prison's first moment: a flash of sparks where the spikes snap shut.
  if (age > 0.4 && age < 0.55) for (let i = 0; i < 6; i++) dot(ax - 10 + Math.round(hash(i, frame, 78) * 20), ag - Math.round(ah * (0.3 + hash(i, 5, 78) * 0.5)), OBSIDIAN[4]);
}

/** A jagged arc of current from (x0,y0) to (x1,y1), re-rolled each frame. */
function arc(dot: Dot, x0: number, y0: number, x1: number, y1: number, frame: number, seed: number): void {
  const n = Math.max(2, Math.round(Math.hypot(x1 - x0, y1 - y0) / 3));
  let px = x0;
  let py = y0;
  for (let k = 1; k <= n; k++) {
    const f = k / n;
    const jitter = k < n ? (hash(seed, k, frame) - 0.5) * 6 : 0;
    const nx = Math.round(x0 + (x1 - x0) * f + jitter * (y1 - y0 === 0 ? 0 : 1));
    const ny = Math.round(y0 + (y1 - y0) * f + jitter * (x1 - x0 === 0 ? 0 : 0.6));
    const steps = Math.max(Math.abs(nx - px), Math.abs(ny - py), 1);
    for (let j = 0; j < steps; j++) {
      const x = Math.round(px + ((nx - px) * j) / steps);
      const y = Math.round(py + ((ny - py) * j) / steps);
      dot(x, y, BOLT[0]);
      dot(x + 1, y, BOLT[2]);
    }
    px = nx;
    py = ny;
  }
}

/** Storm + Water: the water soaks the mob and the storm cloud dumps everything into it at once.
 * Bolts rain down, current cages the soaked mob and crackles through the puddle while it's stunned. */
function electrocute(dot: Dot, ax: number, ag: number, ah: number, age: number, ctx: CanvasRenderingContext2D): void {
  const frame = Math.floor(age * FPS);
  const dur = SPELL_FX_DUR.electrocute;
  const top = ag - ah - 18;
  const fade = Math.max(0, (age - (dur - 0.35)) / 0.35);
  // The storm cloud sinks low and drains away.
  if (age < 0.9) cloud(dot, ax, top - 4 + Math.round(age * 6), Math.round(12 * (1 - age / 0.9)) + 2, frame);
  // A splash of water drenches the mob.
  if (age < 0.35) {
    for (let i = 0; i < 14; i++) {
      const a = hash(i, 1, 81) * Math.PI;
      const t = age;
      const x = ax + Math.round(Math.cos(a) * (6 + t * 60));
      const y = ag - Math.round(ah * 0.6) - Math.round(Math.sin(a) * t * 50 - 140 * t * t);
      if (y < ag) dot(x, y, i % 3 ? WATER[1] : WATER[0], 1, 2);
    }
  }
  // A wet puddle spreads under it, current skittering across.
  const hw = Math.round(14 * Math.min(1, age / 0.25));
  for (let c = -hw; c <= hw; c++) {
    if (hash(c, 2, 82) < fade) continue;
    dot(ax + c, ag, Math.abs(c) > hw - 2 ? WATER[2] : (c + frame) % 5 === 0 ? WATER[0] : WATER[1]);
  }
  if (fade < 1) for (let i = 0; i < 2; i++) {
    const x0 = ax - hw + Math.round(hash(i, frame, 83) * hw);
    if (hash(i, frame, 84) > 0.4) arc(dot, x0, ag - 1, x0 + 6 + Math.round(hash(i, frame, 85) * 8), ag - 1, frame, i + 10);
  }
  // Three bolts slam down one after another.
  for (let b = 0; b < 3; b++) {
    const at = 0.12 + b * 0.12;
    if (age < at || age > at + 0.1) continue;
    if (frame % 2 === 0) {
      ctx.fillStyle = "rgba(220,235,255,0.25)";
      ctx.fillRect(-50, -50, 2000, 1000);
    }
    const bx = ax + (b - 1) * 4;
    arc(dot, bx + Math.round((hash(b, 0, 86) - 0.5) * 8), top + 6, bx, ag - Math.round(ah * 0.5), frame, b + 20);
  }
  // The cage: arcs leap between points round the body, flickering on and off.
  if (age > 0.15 && fade < 1) {
    const pts: [number, number][] = [];
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2 + age * 2;
      pts.push([ax + Math.round(Math.cos(a) * 9), ag - Math.round(ah * 0.5) + Math.round(Math.sin(a) * ah * 0.45)]);
    }
    for (let i = 0; i < pts.length; i++) {
      if (hash(i, frame, 87) < 0.35 + fade * 0.5) continue;
      const [x0, y0] = pts[i];
      const [x1, y1] = pts[(i + 1 + (frame % 2)) % pts.length];
      arc(dot, x0, y0, x1, y1, frame, i + 30);
    }
    // Sparks pop off where the current touches.
    for (let i = 0; i < 6; i++) {
      if (hash(i, frame, 88) < 0.5) continue;
      const [x, y] = pts[i % pts.length];
      dot(x + Math.round((hash(i, frame, 89) - 0.5) * 6), y + Math.round((hash(i, frame, 90) - 0.5) * 6), BOLT[1]);
    }
  }
}

/** A projectile in flight, centred on screen (x, y) and heading dir (1 = right). Returns false if it has no pixel art yet. */
export function drawProjectile(ctx: CanvasRenderingContext2D, fx: string, x: number, y: number, dir: number, t: number): boolean {
  if (fx !== "fireball" && fx !== "wind" && fx !== "water" && fx !== "stone") return false;
  const dot = dotter(ctx);
  const cx = Math.round(x / P);
  const cy = Math.round(y / P);
  const frame = Math.floor(t * FPS * 2);
  // A ridge of rock spikes runs along the floor: y is the ground under it.
  if (fx === "stone") {
    groundRun(dot, cx, cy, dir, frame);
    return true;
  }
  // A wave rolls along the floor: y is the ground under it.
  if (fx === "water") {
    wave(dot, cx, cy, 13, dir, frame);
    return true;
  }
  if (fx === "wind") {
    windBlade(dot, cx, cy, dir, frame);
    return true;
  }
  // Flame tail streams out behind, flickering and narrowing.
  for (let k = 1; k < 12; k++) {
    const w = Math.max(0, Math.round(3 - k * 0.3 + (hash(k, frame, 91) - 0.5) * 2));
    for (let r = -w; r <= w; r++) {
      if (hash(k, r, frame) < k / 14) continue;
      dot(cx - dir * (k + 2), cy + r + Math.round(Math.sin(k + frame) * 0.6), FIRE[Math.min(4, 1 + Math.floor(k / 3) + (Math.abs(r) === w ? 1 : 0))]);
    }
  }
  // Hot core: white middle, yellow, orange rim.
  disc(dot, cx, cy, 3, (d) => (d < 0.35 ? FIRE[0] : d < 0.7 ? FIRE[1] : FIRE[2]));
  dot(cx + dir * 4, cy, FIRE[2]);
  return true;
}

/** Fireball lands: a round blast of flame, a puff of smoke rolling up and embers raining out. */
function fireballBlast(dot: Dot, ax: number, ag: number, ah: number, age: number): void {
  const frame = Math.floor(age * FPS);
  const cy = ag - Math.round(ah * 0.5);
  // Blast: a fireball swells and burns out from the middle.
  if (age < 0.35) {
    const k = age / 0.35;
    const r = 4 + Math.round(easeOut(Math.min(1, k * 2)) * 9);
    const hole = k * 1.1;
    disc(dot, ax, cy, r, (d, x, y) => {
      if (d < hole - 0.2 + hash(x, y, frame) * 0.3) return null;
      const heat = d - k * 0.5 + hash(x, y, frame) * 0.25;
      return FIRE[Math.max(0, Math.min(4, Math.floor(heat * 4 + k * 2)))];
    });
  }
  // Smoke rolls up out of it.
  for (let i = 0; i < 6; i++) {
    const t = age - 0.12 - hash(i, 1, 92) * 0.15;
    if (t < 0 || t > 0.6) continue;
    const x = ax + Math.round((hash(i, 2, 92) - 0.5) * 14);
    disc(dot, x, cy - 4 - Math.round(t * 36), 2 + Math.round(t * 5), (d, px, py) => (hash(px + i, py, frame >> 1) < (t / 0.6) * 0.9 + d * 0.2 ? null : SMOKE[d < 0.5 ? 1 : 0]));
  }
  // Embers fly out and fall.
  for (let i = 0; i < 14; i++) {
    const t = age - 0.03;
    if (t < 0) break;
    const a = hash(i, 3, 93) * Math.PI * 2;
    const v = 30 + hash(i, 4, 93) * 50;
    const x = ax + Math.round(Math.cos(a) * v * t);
    const y = cy + Math.round(Math.sin(a) * v * t * 0.8 + 70 * t * t);
    if (y >= ag || hash(i, 5, 93) < t / 0.8) continue;
    dot(x, y, i % 3 ? FIRE[1] : FIRE[0]);
  }
}

/** Little flames licking up the mob while it burns. */
export function drawBurnFx(ctx: CanvasRenderingContext2D, x: number, ground: number, h: number, t: number): void {
  const dot = dotter(ctx);
  const ax = Math.round(x / P);
  const ag = Math.round(ground / P);
  const ah = Math.round(h / P);
  const frame = Math.floor(t * FPS);
  for (let i = 0; i < 4; i++) {
    // Each tongue of flame has its own spot, life and sway.
    const life = (t * 1.6 + hash(i, 0, 94)) % 1;
    const cycle = Math.floor(t * 1.6 + hash(i, 0, 94));
    const fx = ax + Math.round((hash(i, cycle, 95) - 0.5) * 12);
    const fy = ag - 3 - Math.round(hash(i, cycle, 96) * ah * 0.7);
    const tall = Math.round(5 * Math.sin(life * Math.PI));
    for (let y = 0; y < tall; y++) {
      const sway = Math.round(Math.sin(frame * 0.8 + i + y) * 0.6);
      dot(fx + sway, fy - y, FIRE[Math.min(4, (tall - 1 - y) === 0 ? 0 : y === 0 ? 3 : 1 + (y % 2))]);
      if (y === 0) dot(fx + sway + 1, fy, FIRE[2]);
    }
  }
}

/** Gust in flight: a pale crescent blade, bright on its leading edge, with speed lines streaming behind. */
function windBlade(dot: Dot, cx: number, cy: number, dir: number, frame: number): void {
  // Speed lines flicker in length behind the blade.
  for (let i = -3; i <= 3; i++) {
    const len = 5 + Math.round(hash(i, frame, 97) * 7) - Math.abs(i);
    const x0 = cx - dir * (2 + Math.abs(i));
    dot(dir > 0 ? x0 - len : x0 + 1, cy + i * 2, WIND[1], len, 1);
  }
  crescent(dot, cx, cy, dir, 8, 4, frame);
}

/** A crescent bowing toward dir, r art pixels tall each way and up to thick wide in the middle. */
function crescent(dot: Dot, cx: number, cy: number, dir: number, r: number, thick: number, frame: number): void {
  for (let y = -r; y <= r; y++) {
    const e = Math.abs(y) / r;
    const bow = Math.round(Math.sqrt(1 - e * e) * r * 0.55);
    const w = Math.max(1, Math.round(thick * (1 - e * e)));
    for (let k = 0; k < w; k++) dot(cx + dir * (bow - k), cy + y, k === 0 ? WIND[0] : k === w - 1 && w > 2 ? "#6fc4d8" : WIND[1]);
  }
  // A glint runs along the edge.
  const g = ((frame % 8) / 7) * 2 - 1;
  dot(cx + dir * (Math.round(Math.sqrt(1 - g * g) * r * 0.55) + 1), cy + Math.round(g * r * 0.8), "#ffffff");
}

/** Gust lands: a crescent slash cuts through the mob, then wind rips past it, curling and kicking up dust as it shoves the mob back. */
function gustHit(dot: Dot, ax: number, ag: number, ah: number, age: number): void {
  const frame = Math.floor(age * FPS);
  const dur = SPELL_FX_DUR.gust;
  const cy = ag - Math.round(ah * 0.5);
  const r = Math.max(8, Math.round(ah * 0.45));
  // Slash: the blade grows to body height as it cuts through, then shrinks and fades out the far side.
  if (age < 0.3) {
    const k = age / 0.3;
    const size = Math.round(r * (k < 0.4 ? 0.6 + k : 1.4 - k));
    crescent(dot, ax - 6 + Math.round(k * 22), cy, 1, size, Math.max(1, Math.round(5 * (1 - k))), frame);
  }
  // Shock ripples roll on behind it.
  for (let j = 0; j < 2; j++) {
    const t = age - 0.12 - j * 0.1;
    if (t < 0 || t > 0.3) continue;
    const rr = Math.round(r * (0.7 + t * 1.5));
    for (let y = -rr; y <= rr; y += 2) {
      const e = Math.abs(y) / rr;
      if (hash(j, y, frame) < t / 0.3) continue;
      dot(ax + 4 + Math.round(t * 60) + Math.round(Math.sqrt(1 - e * e) * rr * 0.5), cy + y, WIND[1]);
    }
  }
  // Wind rips past from left to right, line after line.
  for (let i = 0; i < 9; i++) {
    const t = age - hash(i, 0, 98) * 0.3;
    if (t < 0 || t > 0.4) continue;
    const gy = ag - 2 - Math.round(hash(i, 1, 98) * ah * 1.1);
    const head = ax - 18 + Math.round(t * 120);
    const len = 4 + Math.round(hash(i, 2, 98) * 6) + Math.round((1 - t / 0.4) * 4);
    dot(head - len, gy, WIND[i % 2], len, 1);
    // Some lines hook into a curl as they leave.
    if (i % 3 === 0 && t > 0.15) curl(dot, head, gy, t, i);
  }
  // Dust kicked up off the floor, blown back and settling.
  for (let i = 0; i < 10; i++) {
    const t = age - 0.08 - hash(i, 3, 99) * 0.12;
    if (t < 0) continue;
    const x = ax - 4 + Math.round((24 + hash(i, 4, 99) * 50) * t);
    const y = ag - 1 - Math.round((10 + hash(i, 5, 99) * 14) * t - 30 * t * t);
    if (y >= ag || hash(i, frame, 99) < t / (dur - 0.08)) continue;
    dot(x, y, SAND[1 + (i % 3)]);
  }
}

/** A small wind curl at (x, y): a spiral that winds in as t grows. */
function curl(dot: Dot, x: number, y: number, t: number, seed: number): void {
  const n = Math.round(Math.min(1, (t - 0.15) / 0.2) * 14);
  for (let s = 0; s < n; s++) {
    const a = s * 0.5 - Math.PI / 2;
    const r = 4.5 - s * 0.25;
    dot(x + Math.round(Math.cos(a) * r), y - 4 + Math.round(Math.sin(a) * r), WIND[(s + seed) % 2]);
  }
}

/** A breaking wave on the floor at ground gy, crest at x cx, h art pixels tall, rolling toward dir. */
function wave(dot: Dot, cx: number, gy: number, h: number, dir: number, frame: number): void {
  if (h < 2) return;
  const back = Math.round(h * 1.1);
  // Body: a concave slope rising to a sharp crest, foam on top, a light band under the crest.
  for (let c = -back; c <= 0; c++) {
    const tall = Math.round(h * (1 + c / back) ** 1.4);
    for (let y = 0; y < tall; y++) {
      const fromTop = tall - 1 - y;
      let shade = fromTop === 0 ? 0 : fromTop === 1 ? 1 : y < 2 ? 5 : c > -3 ? 2 : fromTop < h * 0.3 ? 3 : 4;
      if (fromTop > 1 && hash(c, y, frame) < 0.06) shade = 1;
      dot(cx + dir * c, gy - 1 - y, WAVE[shade]);
    }
  }
  // Lip: curls forward and down over a hollow barrel, thinning as it goes.
  const lip = Math.max(2, Math.round(h * 0.5));
  for (let i = 1; i <= lip; i++) {
    const k = i / lip;
    const y0 = gy - h + Math.round(h * 0.55 * k * k);
    const th = Math.max(1, Math.round(h * 0.3 * (1 - k)) + 1);
    for (let r = 0; r < th; r++) dot(cx + dir * i, y0 + r, WAVE[r === 0 ? 0 : r === 1 ? 1 : r === th - 1 ? 3 : 2]);
    // The lip's tip drips a curtain of spray down into the barrel.
    if (i === lip) for (let d = 1; d < h * 0.4; d++) if (hash(d, frame, 107) > 0.55) dot(cx + dir * i, y0 + th + d, WAVE[1]);
  }
  // Whitewater churns at the foot of the face.
  const foot = Math.max(1, Math.round(h * 0.15));
  for (let c = 1; c <= lip + 1; c++) {
    for (let y = 0; y < foot + 1 - Math.floor(c / 3); y++) if (hash(c, y, frame + 3) > 0.25) dot(cx + dir * c, gy - 1 - y, y === 0 ? WAVE[2] : WAVE[(c + y + frame) % 2]);
  }
  // Spray flies off the crest.
  for (let i = 0; i < 6; i++) {
    if (hash(i, frame, 101) < 0.4) continue;
    dot(cx + dir * Math.round(hash(i, frame, 102) * 7 - 3), gy - h - 1 - Math.round(hash(i, frame, 103) * 4), i % 2 ? WAVE[0] : WAVE[1]);
  }
}

/** Tidal Wave lands: the wave rears up over the mob, crashes down on it and splashes out into foam and a draining sheet of water. */
function tidalHit(dot: Dot, ax: number, ag: number, ah: number, age: number): void {
  const frame = Math.floor(age * FPS);
  const dur = SPELL_FX_DUR.tidalWave;
  const top = ah + 8;
  // Rear up, then crash: the crest rolls on through the mob as it falls.
  if (age < 0.55) {
    const k = age / 0.55;
    const h = k < 0.45 ? Math.round(13 + (top - 13) * easeOut(k / 0.45)) : k < 0.7 ? top : Math.round(top * (1 - (k - 0.7) / 0.3) ** 1.5);
    wave(dot, ax - 14 + Math.round(k * 22), ag, h, 1, frame);
  }
  // Splash: droplets fly up and rain back down.
  for (let i = 0; i < 18; i++) {
    const t = age - 0.42 - hash(i, 0, 104) * 0.06;
    if (t < 0) continue;
    const a = -Math.PI * (0.15 + hash(i, 1, 104) * 0.7);
    const v = 40 + hash(i, 2, 104) * 50;
    const x = ax + 4 + Math.round(Math.cos(a) * v * t);
    const y = ag - Math.round(ah * 0.7) + Math.round(Math.sin(a) * v * t + 120 * t * t);
    if (y >= ag) continue;
    dot(x, y, i % 3 ? WAVE[1] : WAVE[0], 1, i % 4 ? 1 : 2);
  }
  // A sheet of water runs out along the floor, foam edges racing away, and drains.
  if (age > 0.42) {
    const t = age - 0.42;
    const left = dur - 0.42;
    const reach = Math.round(10 + easeOut(Math.min(1, t / 0.35)) * 24);
    const drain = Math.max(0, (t / left - 0.3) / 0.7);
    for (let c = -reach; c <= reach; c++) {
      const edge = Math.abs(c) >= reach - 1;
      if (hash(c, frame, 105) < drain * 1.1 - (edge ? 0.3 : 0)) continue;
      const depth = edge ? 1 : Math.max(1, Math.round((1 - Math.abs(c) / reach) * 3 * (1 - drain)));
      for (let y = 0; y < depth; y++) {
        const top = y === depth - 1;
        dot(ax + 4 + c, ag - 1 - y, edge ? WAVE[0] : top ? ((c + frame) % 5 === 0 ? WAVE[0] : WAVE[2]) : WAVE[3]);
      }
    }
    // Foam caps bob on the surge.
    for (let i = 0; i < 4; i++) {
      if (hash(i, frame >> 1, 106) < drain) continue;
      const x = ax + 4 + Math.round((hash(i, 0, 106) - 0.5) * reach * 1.6);
      dot(x, ag - 3, WAVE[0], 2, 1);
    }
  }
}

/** A jagged rock spike from the floor at gy: w art pixels wide at the base, h tall, lit from the left. */
function spike(dot: Dot, x: number, gy: number, w: number, h: number, lean = 0): void {
  if (h < 1) return;
  for (let y = 0; y < h; y++) {
    const k = y / h;
    // Chipped edges: the width steps in unevenly as it rises.
    const half = Math.max(0, Math.round(w * (1 - k) ** 1.2 * 0.5 - (hash(x, y >> 1, 116) < 0.3 ? 1 : 0)));
    const sx = x + Math.round(lean * k * h * 0.3);
    // A facet ridge runs up just right of centre: lit face left, shadow right.
    const ridge = Math.round(half * 0.2);
    for (let c = -half; c <= half; c++) {
      const edge = c === -half || c === half;
      const shade = edge ? 4 : c === -half + 1 ? 1 : c < ridge ? 2 : c === ridge ? 1 : 3;
      dot(sx + c, gy - 1 - y, STONE[shade]);
    }
  }
  dot(x + Math.round(lean * h * 0.3), gy - h, STONE[0]);
}

/** Stone Spike on its way: rock spikes punch up in a line along the floor and sink again behind. */
function groundRun(dot: Dot, cx: number, gy: number, dir: number, frame: number): void {
  for (let k = 0; k < 6; k++) {
    const h = Math.max(0, 7 - k * 1.4 - (frame + k) % 2);
    spike(dot, cx - dir * k * 4, gy, 3 + (k === 0 ? 2 : 0), Math.round(h));
  }
  // Grit flicks up off the front.
  for (let i = 0; i < 4; i++) {
    if (hash(i, frame, 108) < 0.4) continue;
    dot(cx + dir * Math.round(hash(i, frame, 109) * 4), gy - 2 - Math.round(hash(i, frame, 110) * 6), STONE[i % 2 ? 2 : 3]);
  }
}

/** Stone Spike lands: the floor cracks, a cluster of spikes bursts up through the mob, holds, then crumbles away. */
function stoneHit(dot: Dot, ax: number, ag: number, ah: number, age: number): void {
  const frame = Math.floor(age * FPS);
  const dur = SPELL_FX_DUR.stoneSpike;
  // Crack: a dark split runs out along the floor.
  if (age < 0.7) {
    const reach = Math.round(Math.min(1, age / 0.1) * 12);
    for (let c = -reach; c <= reach; c++) if (hash(c, 0, 111) > 0.25) dot(ax + c, ag - (Math.abs(c) % 5 === 2 ? 1 : 0), STONE[4]);
  }
  // Spikes: thrust up fast, hold, then crumble from the top down.
  const rise = easeOut(Math.min(1, Math.max(0, age - 0.04) / 0.12));
  const crumble = Math.max(0, (age - 0.6) / (dur - 0.6));
  const cluster: [number, number, number, number][] = [
    [-14, 7, 0.3, -1.5],
    [12, 7, 0.35, 1.5],
    [-8, 10, 0.55, -1],
    [6, 10, 0.6, 1],
    [-1, 14, 0.9, 0],
  ];
  for (const [dx, w, tall, lean] of cluster) {
    const h = Math.round(ah * tall * rise * (1 - crumble));
    spike(dot, ax + dx, ag, w, h, lean);
  }
  // Rubble flies off as they burst up, then the crumbling spikes shed chunks.
  for (let i = 0; i < 14; i++) {
    const burst = i < 8;
    const t = burst ? age - 0.04 : age - 0.6 - hash(i, 0, 112) * 0.1;
    if (t < 0) continue;
    const a = -Math.PI * (0.2 + hash(i, 1, 112) * 0.6);
    const v = burst ? 50 + hash(i, 2, 112) * 40 : 10 + hash(i, 2, 112) * 15;
    const x = ax + Math.round((hash(i, 3, 112) - 0.5) * 16) + Math.round(Math.cos(a) * v * t);
    const y0 = burst ? ag - 2 : ag - Math.round(ah * 0.6 * hash(i, 4, 112));
    const y = y0 + Math.round(Math.sin(a) * v * t + 140 * t * t);
    if (y >= ag) continue;
    dot(x, y, STONE[1 + (i % 3)], i % 3 ? 1 : 2, i % 3 ? 1 : 2);
  }
  // Dust puffs out low as they break.
  if (crumble > 0) for (let i = 0; i < 10; i++) {
    if (hash(i, frame, 113) < crumble * 0.8) continue;
    dot(ax + Math.round((hash(i, 0, 113) - 0.5) * 30 * (0.5 + crumble)), ag - 1 - Math.round(hash(i, 1, 113) * 4 * crumble), SAND[1]);
  }
}

/** Rock crusted round the mob's feet while it is rooted. */
export function drawRootFx(ctx: CanvasRenderingContext2D, x: number, ground: number, t: number): void {
  const dot = dotter(ctx);
  const ax = Math.round(x / P);
  const ag = Math.round(ground / P);
  const frame = Math.floor(t * FPS);
  // A low mound of stones.
  for (let c = -8; c <= 8; c++) {
    const tall = Math.round(3 * (1 - (c / 9) ** 2) + hash(c, 0, 114) * 1.5);
    for (let y = 0; y < tall; y++) dot(ax + c, ag - 1 - y, STONE[y === tall - 1 ? 1 : (c + y) % 3 === 0 ? 3 : 2]);
  }
  // Little shards jut up round the legs.
  spike(dot, ax - 5, ag - 2, 3, 4, -1);
  spike(dot, ax + 4, ag - 2, 3, 5, 1);
  spike(dot, ax - 1, ag - 2, 3, 3);
  // Grit trickles off now and then.
  if (hash(frame, 0, 115) > 0.6) dot(ax + Math.round((hash(frame, 1, 115) - 0.5) * 14), ag - 1, STONE[3]);
}
