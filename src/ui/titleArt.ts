// Animated title screen art: the cover scene (fjord backdrop, the three heroes facing a slime)
// with the "FJORD / BATTLE" logo, drawn at low resolution and scaled up with nearest-neighbour.
import { backdrop } from "./backdrop";
import { sprite } from "./sprites";

// Small 5x7 font for the upper word; O has a rune-like dot.
const SMALL: Record<string, string[]> = {
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  J: ["00111", "00010", "00010", "00010", "10010", "10010", "01100"],
  O: ["01110", "10001", "10001", "10101", "10001", "10001", "01110"],
  R: ["11110", "10001", "10001", "11110", "10100", "10010", "10001"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
};
// Chunky 7x9 Norse-ish caps with flared feet for the main word.
const BIG: Record<string, string[]> = {
  B: ["1111100", "0110110", "0110011", "0110110", "0111100", "0110110", "0110011", "0110011", "1111110"],
  A: ["0001000", "0011100", "0011100", "0110110", "0110110", "0111110", "1100011", "1100011", "1110111"],
  T: ["1111111", "1111111", "1011101", "0011100", "0011100", "0011100", "0011100", "0011100", "0111110"],
  L: ["1111000", "0110000", "0110000", "0110000", "0110000", "0110000", "0110001", "0110011", "1111111"],
  E: ["1111111", "0110001", "0110000", "0111100", "0111100", "0110000", "0110000", "0110001", "1111111"],
};

/** Letter mask for `s`, k art px per font px, `gap` font px between letters. */
function mask(s: string, font: Record<string, string[]>, k: number, gap: number): boolean[][] {
  const rows = font[s[0]].length;
  const w = [...s].reduce((t, c) => t + (font[c][0].length + gap) * k, -gap * k);
  const m: boolean[][] = Array.from({ length: rows * k }, () => Array(w).fill(false));
  let x = 0;
  for (const ch of s) {
    font[ch].forEach((row, ry) =>
      [...row].forEach((b, rx) => {
        if (b !== "1") return;
        for (let a = 0; a < k; a++) for (let c = 0; c < k; c++) m[ry * k + a][x + rx * k + c] = true;
      }),
    );
    x += (font[ch][0].length + gap) * k;
  }
  return m;
}

const logos = new Map<number, HTMLCanvasElement>();

/** Silver-blue beveled letters, dark outline, icy rim and glow (Northgard-style), k art px per font px. */
function logo(k: number): HTMLCanvasElement {
  const cached = logos.get(k);
  if (cached) return cached;
  const top = mask("FJORD", SMALL, Math.max(1, Math.round(k / 2)), 3);
  const main = mask("BATTLE", BIG, k, 1);
  const P = 5; // room for outline + glow
  const W = Math.max(top[0].length, main[0].length) + P * 2;
  const gapY = Math.max(2, k);
  const H = top.length + gapY + main.length + P * 2;
  const on: boolean[][] = Array.from({ length: H }, () => Array(W).fill(false));
  const face: number[][] = Array.from({ length: H }, () => Array(W).fill(-1)); // row fraction within its word
  const stamp = (m: boolean[][], oy: number) => {
    const ox = Math.round((W - m[0].length) / 2);
    m.forEach((r, y) =>
      r.forEach((b, x) => {
        if (!b) return;
        on[oy + y][ox + x] = true;
        face[oy + y][ox + x] = y / m.length;
      }),
    );
  };
  stamp(top, P);
  stamp(main, P + top.length + gapY);
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  const at = (x: number, y: number) => on[y]?.[x] ?? false;
  // Distance (Chebyshev) to the nearest letter pixel, up to P.
  const dist = (x: number, y: number) => {
    for (let d = 1; d <= P; d++) for (let dy = -d; dy <= d; dy++) for (let dx = -d; dx <= d; dx++) if (at(x + dx, y + dy)) return d;
    return 99;
  };
  const silver = ["#f4f8ff", "#d6e2f2", "#a9bcd8", "#8199c0", "#6680aa", "#4f6892"];
  const px = (x: number, y: number, col: string, alpha = 1) => {
    g.globalAlpha = alpha;
    g.fillStyle = col;
    g.fillRect(x, y, 1, 1);
  };
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (at(x, y)) {
        const f = face[y][x];
        // Bright band near the top, a second sheen just below the middle, darker feet.
        let i = Math.min(5, Math.floor(f * 6));
        if (f > 0.45 && f < 0.55) i = Math.max(0, i - 2);
        let col = silver[i];
        if (!at(x, y - 1)) col = "#ffffff";
        else if (!at(x - 1, y)) col = silver[Math.max(0, i - 1)];
        if (!at(x, y + 1)) col = "#3c5078";
        else if (!at(x + 1, y)) col = silver[Math.min(5, i + 1)];
        px(x, y, col);
        continue;
      }
      const d = dist(x, y);
      if (d === 1) px(x, y, "#0b1222");
      else if (d === 2) px(x, y, "#1f3354");
      else if (d === 3) px(x, y, "#9fdcff", 0.65);
      else if (d <= 5 && ((x + y) & 1) === 0) px(x, y, "#6fc3ff", d === 4 ? 0.45 : 0.2);
    }
  }
  g.globalAlpha = 1;
  logos.set(k, c);
  return c;
}

/** Each hero holds the cover's pose: a frame from its attack clip. */
const POSES: { id: string; frame: number; at: number }[] = [
  { id: "ranger", frame: 6, at: 0.08 },
  { id: "mage", frame: 5, at: 0.175 },
  { id: "warrior", frame: 4, at: 0.27 },
];
/** Art rows of screen height to aim for; the scale is picked so the scene is about this tall. */
const ART_H = 180;
const GROUND = 0.82;

const logoK = (ah: number) => Math.max(3, Math.floor(ah / 42));

/** Animate the title scene into `canvas`, filling its CSS box. `onLayout` gets where the logo ends
 * and where the ground starts, as fractions of the height, so the menu can sit between them.
 * Returns a stop function. */
export function playTitle(canvas: HTMLCanvasElement, onLayout: (logoEnd: number, ground: number) => void): () => void {
  const ctx = canvas.getContext("2d")!;
  const art = document.createElement("canvas");
  const g = art.getContext("2d")!;
  let raf = 0;
  let S = 1;

  const fit = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(canvas.clientWidth * dpr);
    canvas.height = Math.round(canvas.clientHeight * dpr);
    S = Math.max(2, Math.round(canvas.height / ART_H));
    art.width = Math.ceil(canvas.width / S);
    art.height = Math.ceil(canvas.height / S);
    onLayout((6 + logo(logoK(art.height)).height) / art.height, GROUND);
  };

  const put = (img: HTMLImageElement, cx: number, foot: number, scale: number, ground: number, flip = false) => {
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const x = Math.round(cx - w / 2);
    const y = Math.round(ground + 1 - foot * scale);
    g.save();
    if (flip) {
      g.translate(x + w, y);
      g.scale(-1, 1);
      g.drawImage(img, 0, 0, w, h);
    } else g.drawImage(img, x, y, w, h);
    g.restore();
  };
  const shadow = (cx: number, w: number, ground: number) => {
    g.fillStyle = "rgba(0,0,0,0.35)";
    g.fillRect(Math.round(cx - w / 2), ground - 1, w, 2);
  };

  const frame = (now: number) => {
    const t = now / 1000;
    const aw = art.width;
    const ah = art.height;
    const ground = Math.round(ah * GROUND);
    ctx.imageSmoothingEnabled = false;
    // The backdrop draws 3 screen px per art px; scale it so one art px is S canvas px.
    ctx.save();
    ctx.scale(S / 3, S / 3);
    backdrop(aw * 3, ah * 3, ground * 3, 99999, false).draw(ctx, t);
    ctx.restore();

    g.clearRect(0, 0, aw, ah);
    g.imageSmoothingEnabled = false;
    for (const p of POSES) {
      const set = sprite(p.id);
      const clip = set?.anims.attack ?? set?.still;
      if (!set || !clip) continue;
      const cx = Math.round(aw * p.at);
      shadow(cx, p.id === "warrior" ? 22 : 18, ground);
      put(clip.frames[Math.min(p.frame, clip.frames.length - 1)], cx, clip.foot, set.scale, ground);
    }
    const slime = sprite("slime");
    const idle = slime?.anims.idle ?? slime?.still;
    if (idle) {
      const cx = Math.round(aw * 0.84);
      shadow(cx, 44, ground);
      put(idle.frames[Math.floor(t * 8) % idle.frames.length], cx, idle.foot, 1.25, ground, true);
    }
    const lg = logo(logoK(ah));
    g.drawImage(lg, Math.round((aw - lg.width) / 2), 6);
    ctx.drawImage(art, 0, 0, aw * S, ah * S);
    raf = requestAnimationFrame(frame);
  };

  fit();
  const ro = new ResizeObserver(fit);
  ro.observe(canvas);
  raf = requestAnimationFrame(frame);
  return () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
  };
}
