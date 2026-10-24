// Warrior melee effects: PixelLab vfx_workbench sprite sheets (src/assets/vfx/<name>/), played once each.
// Sheets are TexturePacker JSON + PNG; blank trailing frames in an export are dropped at load.

export type MeleeFxKind = "slash" | "hit" | "shockwave" | "heavySlash" | "groundCrack" | "shieldBash" | "stunStars" | "chargeStreak" | "kickImpact";

/** An effect anchored to the mob: x follows it, so a knocked-back mob keeps its effect. */
export interface MeleeFx {
  kind: MeleeFxKind;
  /** Scene time it started. */
  born: number;
  /** Drawn larger, for crits. */
  big?: boolean;
  /** Screen px from the mob's x; negative is toward the hero. */
  dx?: number;
}

interface SheetJson {
  frames: { frame: { x: number; y: number; w: number; h: number }; pivot?: { x: number; y: number }; duration: number }[];
}

interface Sheet {
  img: HTMLImageElement;
  frames: { x: number; y: number; w: number; h: number; dur: number }[];
  pivot: { x: number; y: number };
  ready: boolean;
}

const jsons = import.meta.glob<SheetJson>("../assets/vfx/*/*.json", { eager: true, import: "default" });
const pngs = import.meta.glob<string>("../assets/vfx/*/*.png", { eager: true, import: "default", query: "?url" });

/** Which export each effect plays, where it sits on the mob (0 = feet, 1 = head) and its base scale. */
const LOOK: Record<MeleeFxKind, { file: string; at: number; scale: number }> = {
  slash: { file: "warrior_slash/warrior-slash", at: 0.55, scale: 1 },
  hit: { file: "warrior_hit/warrior-hit", at: 0.5, scale: 1 },
  shockwave: { file: "warrior_shockwave/warrior-shockwave", at: 0, scale: 1 },
  heavySlash: { file: "heavy_slash/heavy-slash", at: 0.55, scale: 1 },
  groundCrack: { file: "ground_crack/ground-crack", at: 0, scale: 1 },
  shieldBash: { file: "shield_bash/shield-bash", at: 0.55, scale: 1 },
  stunStars: { file: "stun_stars/stun-stars", at: 1, scale: 1 },
  chargeStreak: { file: "charge_streak/charge-streak", at: 0.45, scale: 1.5 },
  kickImpact: { file: "kick_impact/kick-impact", at: 0.4, scale: 1.5 },
};

const sheets = new Map<MeleeFxKind, Sheet>();

function load(kind: MeleeFxKind): Sheet | undefined {
  const cached = sheets.get(kind);
  if (cached) return cached;
  const { file } = LOOK[kind];
  const json = jsons[`../assets/vfx/${file}.json`];
  const url = pngs[`../assets/vfx/${file}.png`];
  if (!json || !url || typeof Image === "undefined") return undefined;
  const img = new Image();
  const sheet: Sheet = {
    img,
    frames: json.frames.map((f) => ({ ...f.frame, dur: f.duration / 1000 })),
    pivot: json.frames[0]?.pivot ?? { x: 0.5, y: 0.5 },
    ready: false,
  };
  img.onload = () => {
    sheet.frames = trimBlank(img, sheet.frames);
    sheet.ready = true;
  };
  img.src = url;
  sheets.set(kind, sheet);
  return sheet;
}

/** Drop trailing frames with no visible pixels, so an effect ends when its art does. */
function trimBlank(img: HTMLImageElement, frames: Sheet["frames"]): Sheet["frames"] {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext("2d", { willReadFrequently: true });
  if (!g) return frames;
  g.drawImage(img, 0, 0);
  let n = frames.length;
  while (n > 1) {
    const f = frames[n - 1];
    const data = g.getImageData(f.x, f.y, f.w, f.h).data;
    let any = false;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 8) { any = true; break; }
    if (any) break;
    n--;
  }
  return frames.slice(0, n);
}

/** Seconds an effect plays (its sheet's frame durations, once loaded). */
export function meleeFxDur(kind: MeleeFxKind): number {
  const s = load(kind);
  return s ? s.frames.reduce((a, f) => a + f.dur, 0) : 0.5;
}

/** Start loading every sheet up front so the first hit isn't blank. */
export function preloadMeleeFx(): void {
  for (const k of Object.keys(LOOK) as MeleeFxKind[]) load(k);
}

/** Draw every live effect. x is the mob's screen x, ground the screen y of the floor, h the mob's height. */
export function drawMeleeFx(ctx: CanvasRenderingContext2D, list: MeleeFx[], now: number, x: number, ground: number, h: number): void {
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  for (const f of list) {
    const s = load(f.kind);
    if (!s?.ready) continue;
    let age = now - f.born;
    if (age < 0) continue;
    const frame = s.frames.find((fr) => (age -= fr.dur) < 0);
    if (!frame) continue;
    const look = LOOK[f.kind];
    const k = look.scale * (f.big ? 1.5 : 1);
    const w = frame.w * k;
    const hh = frame.h * k;
    const cx = Math.round(x + (f.dx ?? 0) - w * s.pivot.x);
    const cy = Math.round(ground - h * look.at - hh * s.pivot.y);
    ctx.drawImage(s.img, frame.x, frame.y, frame.w, frame.h, cx, cy, w, hh);
  }
  ctx.imageSmoothingEnabled = smooth;
}

/** Looping stun stars centred on (x, y), e.g. just above a stunned fighter's head. Returns false until loaded. */
export function drawStunStars(ctx: CanvasRenderingContext2D, now: number, x: number, y: number): boolean {
  const s = load("stunStars");
  if (!s?.ready || !s.frames.length) return false;
  const total = s.frames.reduce((a, f) => a + f.dur, 0);
  let age = now % total;
  const frame = s.frames.find((fr) => (age -= fr.dur) < 0) ?? s.frames[0];
  const smooth = ctx.imageSmoothingEnabled;
  ctx.imageSmoothingEnabled = false;
  // Drawn at 2× so the small stars read against the snowy backdrop.
  const w = frame.w * 2;
  const h = frame.h * 2;
  ctx.drawImage(s.img, frame.x, frame.y, frame.w, frame.h, Math.round(x - w * s.pivot.x), Math.round(y - h * s.pivot.y), w, h);
  ctx.imageSmoothingEnabled = smooth;
  return true;
}
