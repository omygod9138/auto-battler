// Pixel-art fjord backdrop: drawn at a low resolution with a small palette, then scaled up
// with nearest-neighbour so it sits beside the sprite art. Layers drift at different speeds.
import { Rng } from "../core/rng";

/** Screen pixels per art pixel. */
export const PIXEL = 3;
/** Art pixels drawn past each edge, so screen shake never shows a gap. */
const M = 6;

interface Palette {
  sky: string[];
  stars: string[];
  moon: [string, string];
  aurora: [string, string];
  cloud: [string, string];
  far: { base: string; shade: string; snow: string; snowShade: string };
  mid: { base: string; rim: string; pine: string; pineLit: string };
  water: string[];
  glint: string;
  grass: string[];
  dirt: string[];
  stone: [string, string];
  wall: [string, string, string];
}

const NIGHT: Palette = {
  sky: ["#0f1526", "#141d33", "#1a2742", "#213253", "#2a4066", "#36527a"],
  stars: ["#e9f1ff", "#9fb4d8"],
  moon: ["#f3ead0", "#cbbf9c"],
  aurora: ["#5fe0a8", "#2f9c86"],
  cloud: ["#3a4f73", "#2e4062"],
  far: { base: "#3a4d72", shade: "#2c3c5c", snow: "#d4e0f2", snowShade: "#93a6c6" },
  mid: { base: "#1d2a42", rim: "#2b3d5c", pine: "#142034", pineLit: "#1f3048" },
  water: ["#16294a", "#1c3459", "#22406a"],
  glint: "#8fb8e0",
  grass: ["#2f4a2f", "#3f6138", "#557d45", "#7aa257"],
  dirt: ["#2e241d", "#3d3026", "#4e3d30"],
  stone: ["#5a5f6c", "#3f434e"],
  wall: ["#4f4c56", "#3b3942", "#67646e"],
};

const BOSS: Palette = {
  sky: ["#140a10", "#1d0e16", "#2a131d", "#3a1a24", "#4f222c", "#6a2e32"],
  stars: ["#ffd9c9", "#c98a86"],
  moon: ["#ff9a6b", "#c4573e"],
  aurora: ["#ff6b5a", "#a83a42"],
  cloud: ["#4a2430", "#3a1c28"],
  far: { base: "#4a2a36", shade: "#38202c", snow: "#e2c2c2", snowShade: "#a8848a" },
  mid: { base: "#24131c", rim: "#3a1f2a", pine: "#190c13", pineLit: "#2a1520" },
  water: ["#200f18", "#2c1420", "#3a1a28"],
  glint: "#ff9a7a",
  grass: ["#33302a", "#4a4232", "#5f553c", "#7d6f4a"],
  dirt: ["#2a1c18", "#3a2620", "#4a3228"],
  stone: ["#5c5258", "#40383e"],
  wall: ["#4f4248", "#3b3036", "#675a60"],
};

/** 4×4 ordered-dither thresholds, 0..1. */
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v + 0.5) / 16);
const dither = (x: number, y: number) => BAYER[(y & 3) * 4 + (x & 3)];

const canvas = (w: number, h: number) => {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};

/** A periodic ridge of sharp peaks: tops[x] is the highest filled row. */
function ridge(w: number, base: number, amp: number, rng: Rng, octaves: number[]): number[] {
  const waves = octaves.map((k, i) => ({ k, a: 1 / (i + 1), ph: rng.next() * Math.PI }));
  const sum = waves.reduce((s, v) => s + v.a, 0);
  return Array.from({ length: w }, (_, x) => {
    let h = 0;
    for (const v of waves) h += v.a * (1 - Math.abs(Math.sin((Math.PI * v.k * x) / w + v.ph))) ** 1.6;
    return Math.round(base - (h / sum) * amp);
  });
}

export class Backdrop {
  /** Art-space size, including the margin. */
  readonly w: number;
  readonly h: number;
  /** Art row the fighters stand on. */
  readonly ground: number;
  private frame: HTMLCanvasElement;
  private sky: HTMLCanvasElement;
  private far: HTMLCanvasElement;
  private mid: HTMLCanvasElement;
  private shore: HTMLCanvasElement;
  private waterTop: number;
  private tufts: { x: number; h: number }[] = [];
  private clouds: { x: number; y: number; w: number; v: number }[] = [];

  constructor(
    viewW: number,
    viewH: number,
    groundY: number,
    private wallX: number,
    private pal: Palette,
  ) {
    this.w = Math.ceil(viewW / PIXEL) + M * 2;
    this.h = Math.ceil(viewH / PIXEL) + M * 2;
    this.ground = Math.round(groundY / PIXEL) + M;
    this.waterTop = this.ground - 14;
    this.frame = canvas(this.w, this.h);
    const rng = new Rng(7);
    this.sky = this.paintSky(rng);
    this.far = this.paintFar(rng);
    this.mid = this.paintMid(rng);
    this.shore = this.paintShore(rng);
    for (let x = 2; x < this.w; x += 5 + rng.int(6)) this.tufts.push({ x, h: 2 + rng.int(3) });
    for (let i = 0; i < 5; i++) this.clouds.push({ x: rng.next() * this.w, y: 8 + rng.int(24), w: 14 + rng.int(22), v: 0.6 + rng.next() * 0.8 });
  }

  private paintSky(rng: Rng): HTMLCanvasElement {
    const c = canvas(this.w, this.waterTop);
    const g = c.getContext("2d")!;
    const n = this.pal.sky.length;
    for (let y = 0; y < c.height; y++) {
      const k = (y / c.height) * (n - 1);
      for (let x = 0; x < c.width; x++) {
        g.fillStyle = this.pal.sky[Math.min(n - 1, Math.floor(k) + (k % 1 > dither(x, y) ? 1 : 0))];
        g.fillRect(x, y, 1, 1);
      }
    }
    for (let i = 0; i < 70; i++) {
      const x = rng.int(c.width);
      const y = rng.int(Math.floor(c.height * 0.6));
      g.fillStyle = this.pal.stars[rng.next() < 0.25 ? 0 : 1];
      g.fillRect(x, y, 1, 1);
      if (rng.next() < 0.08) {
        // A brighter star gets a small cross.
        g.fillRect(x - 1, y, 3, 1);
        g.fillRect(x, y - 1, 1, 3);
      }
    }
    // Crescent moon, top-left.
    const [mx, my, r] = [M + 34, M + 14, 7];
    for (let y = -r; y <= r; y++) {
      for (let x = -r; x <= r; x++) {
        if (x * x + y * y > r * r + 2) continue;
        const cut = (x + 4) ** 2 + (y - 2) ** 2 < (r - 1) ** 2;
        if (cut) continue;
        g.fillStyle = this.pal.moon[x + y > 2 ? 1 : 0];
        g.fillRect(mx + x, my + y, 1, 1);
      }
    }
    return c;
  }

  /** Snow-capped peaks across the fjord, twice the view wide so they can wrap. */
  private paintFar(rng: Rng): HTMLCanvasElement {
    const w = this.w * 2;
    const c = canvas(w, this.waterTop);
    const g = c.getContext("2d")!;
    const f = this.pal.far;
    const tops = ridge(w, this.waterTop - 2, 62, rng, [3, 7, 13, 29]);
    const snowLine = this.waterTop - 34;
    for (let x = 0; x < w; x++) {
      // Light comes from the moon on the left: slopes facing left are lit.
      const lit = tops[(x + 3) % w] >= tops[(x + w - 3) % w];
      const cap = Math.max(0, snowLine - tops[x]) * 0.6 + 2 + ((x * 7) % 3);
      for (let y = tops[x]; y < c.height; y++) {
        const snowy = tops[x] < snowLine && y - tops[x] < cap;
        if (snowy) g.fillStyle = lit ? f.snow : f.snowShade;
        else g.fillStyle = lit ? f.base : f.shade;
        g.fillRect(x, y, 1, 1);
      }
    }
    return c;
  }

  /** Dark pine-covered fjord walls, closer and faster. */
  private paintMid(rng: Rng): HTMLCanvasElement {
    const w = this.w * 2;
    const c = canvas(w, this.waterTop + 2);
    const g = c.getContext("2d")!;
    const p = this.pal.mid;
    const tops = ridge(w, this.waterTop + 2, 30, rng, [2, 5, 11]);
    for (let x = 0; x < w; x++) {
      g.fillStyle = p.base;
      g.fillRect(x, tops[x], 1, c.height - tops[x]);
      g.fillStyle = p.rim;
      g.fillRect(x, tops[x], 1, 1);
    }
    // Pines standing on the ridge, thicker on the high ground.
    for (let x = 0; x < w; x += 2 + rng.int(4)) {
      if (tops[x] > this.waterTop - 3 && rng.next() < 0.7) continue;
      const h = 5 + rng.int(6);
      const base = tops[x] + 2;
      for (let i = 0; i < h; i++) {
        const half = Math.floor((i * 3) / h) + (i % 2);
        g.fillStyle = p.pine;
        g.fillRect(x - half, base - h + i, half * 2 + 1, 1);
        g.fillStyle = p.pineLit;
        g.fillRect(x - half, base - h + i, 1, 1);
      }
    }
    return c;
  }

  /** The grassy shore the fight happens on, plus the rock wall at the far end. */
  private paintShore(rng: Rng): HTMLCanvasElement {
    const c = canvas(this.w, this.h - this.ground + 1);
    const g = c.getContext("2d")!;
    const [g0, g1, g2, g3] = this.pal.grass;
    for (let x = 0; x < c.width; x++) {
      const turf = 4 + ((x * 5) % 3);
      for (let y = 0; y < c.height; y++) {
        let col: string;
        if (y === 0) col = g3;
        else if (y < 3) col = dither(x, y) < 0.6 ? g2 : g3;
        else if (y < turf) col = dither(x, y) < 0.5 ? g1 : g2;
        else if (y === turf) col = dither(x, y) < 0.5 ? g0 : this.pal.dirt[2];
        else {
          const k = (y - turf) / (c.height - turf);
          col = this.pal.dirt[k + dither(x, y) * 0.6 > 0.6 ? 0 : k + dither(x, y) * 0.6 > 0.3 ? 1 : 2];
        }
        g.fillStyle = col;
        g.fillRect(x, y, 1, 1);
      }
    }
    for (let i = 0; i < 26; i++) {
      const x = rng.int(c.width);
      const y = 9 + rng.int(c.height - 10);
      const s = 1 + rng.int(3);
      g.fillStyle = this.pal.stone[1];
      g.fillRect(x, y, s + 1, s);
      g.fillStyle = this.pal.stone[0];
      g.fillRect(x, y, s, s - 1 || 1);
    }

    return c;
  }

  /** Stacked stone blocks the mob can be slammed into. */
  private paintWall(g: CanvasRenderingContext2D): void {
    const x0 = Math.round(this.wallX / PIXEL) + M;
    const top = this.ground - 50;
    const [face, mortar, lit] = this.pal.wall;
    g.fillStyle = mortar;
    // Ragged top edge.
    for (let x = x0; x < this.w; x++) g.fillRect(x, top - 2 + ((x * 7) % 3), 1, this.ground - top + 4);
    for (let y = top, row = 0; y < this.ground + 1; y += 6, row++) {
      for (let x = x0 + (row % 2 ? -3 : 0); x < this.w; x += 9) {
        const bx = Math.max(x0 + 1, x + 1);
        const bw = x + 8 - bx;
        if (bw <= 0) continue;
        g.fillStyle = face;
        g.fillRect(bx, y + 1, bw, 5);
        g.fillStyle = lit;
        g.fillRect(bx, y + 1, bw, 1);
        g.fillRect(bx, y + 1, 1, 5);
      }
    }
  }

  draw(ctx: CanvasRenderingContext2D, t: number): void {
    const g = this.frame.getContext("2d")!;
    const p = this.pal;
    g.drawImage(this.sky, 0, 0);

    // Aurora: a wavy two-tone ribbon, dithered so it reads as light, not paint.
    for (let x = 0; x < this.w; x++) {
      const y0 = M + 14 + Math.round(Math.sin(x * 0.035 + t * 0.5) * 6 + Math.sin(x * 0.011 - t * 0.2) * 4);
      for (let i = 0; i < 7; i++) {
        // Solid core, dithered fringe that thins out below.
        const fade = i === 2 ? 1 : i < 2 ? 0.3 * i : 0.55 - (i - 3) * 0.13;
        if (dither(x, y0 + i) >= fade * 0.85) continue;
        g.fillStyle = i < 3 ? p.aurora[0] : p.aurora[1];
        g.fillRect(x, y0 + i, 1, 1);
      }
    }

    for (const c of this.clouds) {
      const x = Math.round(((c.x - t * c.v) % (this.w + c.w)) + this.w + c.w) % (this.w + c.w) - c.w;
      g.fillStyle = p.cloud[1];
      g.fillRect(x, c.y + 2, c.w, 2);
      g.fillStyle = p.cloud[0];
      g.fillRect(x + 3, c.y, c.w - 8, 2);
      g.fillRect(x + 6, c.y - 1, Math.floor(c.w / 3), 1);
    }

    const scroll = (speed: number) => -Math.floor(t * speed) % (this.w * 2);
    const farX = scroll(0.6);
    g.drawImage(this.far, farX, 0);
    g.drawImage(this.far, farX + this.w * 2, 0);

    // Water: banded, with the peaks mirrored and rippling in it.
    for (let y = this.waterTop; y < this.ground; y++) {
      const k = (y - this.waterTop) / (this.ground - this.waterTop);
      g.fillStyle = p.water[Math.min(2, Math.floor(k * 3 + dither(0, y) * 0.5))];
      g.fillRect(0, y, this.w, 1);
    }
    g.globalAlpha = 0.35;
    for (let i = 0; this.waterTop + i < this.ground; i++) {
      const wob = Math.round(Math.sin(t * 1.6 + i * 0.9) * (1 + i * 0.15));
      const src = this.waterTop - 1 - i * 2;
      if (src < 0) break;
      g.drawImage(this.far, -farX, src, this.w, 1, wob, this.waterTop + i, this.w, 1);
    }
    g.globalAlpha = 1;
    g.fillStyle = p.glint;
    for (let i = 0; i < 18; i++) {
      const y = this.waterTop + 1 + ((i * 5) % (this.ground - this.waterTop - 1));
      const x = Math.round((i * 53 + t * (4 + (i % 3) * 2)) % this.w);
      if ((Math.floor(t * 2 + i) & 3) === 0) continue;
      g.fillRect(x, y, 2 + (i % 3), 1);
    }

    const midX = scroll(1.4);
    g.drawImage(this.mid, midX, 0);
    g.drawImage(this.mid, midX + this.w * 2, 0);

    g.drawImage(this.shore, 0, this.ground);
    this.paintWall(g);

    // Grass tufts poke above the turf and sway between two frames.
    for (const tf of this.tufts) {
      const lean = Math.sin(t * 2 + tf.x * 0.3) > 0.3 ? 1 : 0;
      g.fillStyle = p.grass[2];
      for (let i = 1; i <= tf.h; i++) g.fillRect(tf.x + (i > tf.h / 2 ? lean : 0), this.ground - i, 1, 1);
      g.fillStyle = p.grass[3];
      g.fillRect(tf.x + 1 + lean, this.ground - 1, 1, 1);
    }

    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.frame, -M * PIXEL, -M * PIXEL, this.w * PIXEL, this.h * PIXEL);
    ctx.restore();
  }
}

const cache = new Map<string, Backdrop>();

export function backdrop(viewW: number, viewH: number, groundY: number, wallX: number, boss: boolean): Backdrop {
  const key = `${viewW}x${viewH}:${groundY}:${wallX}:${boss}`;
  let b = cache.get(key);
  if (!b) {
    b = new Backdrop(viewW, viewH, groundY, wallX, boss ? BOSS : NIGHT);
    cache.set(key, b);
  }
  return b;
}
