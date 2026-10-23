// Pixel-art characters exported from PixelLab. Drop an export into
// src/assets/sprites/<character id>/ (metadata.json plus its PNG folders) and
// that character is drawn from the art instead of the procedural rig.

import { SKILLS, type SkillId } from "../core/skills";

export type SpriteAnim = "idle" | "walk" | "attack" | "hurt" | "death";

/** Frames drawn centred horizontally with row `foot` on the ground. PixelLab pads each animation's canvas differently, so every clip carries its own anchor. */
export interface Clip {
  frames: HTMLImageElement[];
  /** Row just below the first frame's lowest opaque pixel, where the feet touch the ground. */
  foot: number;
  /** Death clips: the row the body rests on in the last frame. PixelLab deaths end mid-fall with only a
   * dangling bow or sword at the feet' row, so the clip sinks toward this row as it plays. */
  rest?: number;
}

export interface SpriteSet {
  /** Still, right-facing pose; used whenever an animation is missing. */
  still: Clip;
  anims: Partial<Record<SpriteAnim, Clip>>;
  /** Clips named after a skill, played when that skill lands a hit. */
  skills: Partial<Record<SkillId, Clip>>;
  /** Height of the still's opaque art above the feet. */
  visible: number;
  /** Extra enlargement so art drawn smaller than the others still stands as tall. */
  scale: number;
}

interface PixelLabExport {
  states?: {
    frames?: {
      rotations?: Record<string, string>;
      animations?: Record<string, unknown>;
    };
  }[];
}

const metas = import.meta.glob<PixelLabExport>("../assets/sprites/*/metadata.json", { eager: true, import: "default" });
// Only the right-facing art is used; the other directions stay out of the bundle.
const pngs = import.meta.glob<string>(["../assets/sprites/*/*/rotations/east.png", "../assets/sprites/*/*/animations/*/east/*.png"], {
  eager: true,
  query: "?url",
  import: "default",
});

/** Animation names are free text in PixelLab, so match them by keyword. */
const ROLES: [SpriteAnim, RegExp][] = [
  ["death", /death|dying|die|fall/i],
  ["hurt", /hurt|hit|damage|recoil|flinch/i],
  ["attack", /attack|slash|chop|swing|strike|stab|shoot|cast/i],
  ["walk", /walk|run|march|move/i],
  ["idle", /idle|breath|stand/i],
];

/** A clip whose name starts with a skill's name or id ("heavy-strike", "Shield Bash ...") belongs to that skill. */
const flat = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
export function skillFor(name: string): SkillId | undefined {
  const n = flat(name);
  return (Object.keys(SKILLS) as SkillId[]).find((id) => n.startsWith(flat(id)) || n.startsWith(flat(SKILLS[id].name)));
}

const sets = new Map<string, SpriteSet>();

/** Art whose figure is shorter than this many pixels is scaled up to it (the mage's height; the warrior is 59). */
const MIN_VISIBLE = 57;

export function sprite(id: string): SpriteSet | undefined {
  return sets.get(id);
}

/** Right-facing frames of one animation entry, whatever shape the export gives it. */
function eastFrames(entry: unknown): string[] {
  if (Array.isArray(entry)) return entry.filter((f): f is string => typeof f === "string");
  if (entry && typeof entry === "object") {
    const byDir = entry as Record<string, unknown>;
    return eastFrames(byDir.east ?? byDir.frames ?? Object.values(byDir)[0]);
  }
  return [];
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${url}`));
    img.src = url;
  });
}

function pixels(img: HTMLImageElement): Uint8ClampedArray {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext("2d")!;
  g.drawImage(img, 0, 0);
  return g.getImageData(0, 0, c.width, c.height).data;
}

function opaqueRows(img: HTMLImageElement): { top: number; bottom: number } {
  const data = pixels(img);
  let top = img.height;
  let bottom = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (data[(y * img.width + x) * 4 + 3] > 0) {
        top = Math.min(top, y);
        bottom = y;
        break;
      }
    }
  }
  return bottom < 0 ? { top: 0, bottom: img.height - 1 } : { top, bottom };
}

/** Row just below the median of each column's lowest opaque pixel: where a lying body meets the ground,
 * ignoring a few low-hanging pixels like a weapon tip. */
function restRow(img: HTMLImageElement): number {
  const data = pixels(img);
  const bottoms: number[] = [];
  for (let x = 0; x < img.width; x++) {
    for (let y = img.height - 1; y >= 0; y--) {
      if (data[(y * img.width + x) * 4 + 3] > 0) {
        bottoms.push(y);
        break;
      }
    }
  }
  bottoms.sort((a, b) => a - b);
  return (bottoms[Math.floor(bottoms.length / 2)] ?? img.height - 1) + 1;
}

async function loadClip(urls: string[]): Promise<Clip> {
  const frames = await Promise.all(urls.map(loadImage));
  return { frames, foot: opaqueRows(frames[0]).bottom + 1 };
}

async function loadSet(dir: string, meta: PixelLabExport): Promise<SpriteSet | null> {
  const url = (path: string) => pngs[`${dir}/${path}`];
  const states = meta.states ?? [];
  const anims: SpriteSet["anims"] = {};
  const skills: SpriteSet["skills"] = {};
  // An export can hold several characters; gather animations from all of them.
  for (const state of states) {
    for (const [name, entry] of Object.entries(state.frames?.animations ?? {})) {
      const urls = eastFrames(entry).map(url).filter((u): u is string => !!u);
      if (!urls.length) continue;
      // Skill names win over roles: "heavy strike" would otherwise read as a plain attack.
      const skill = skillFor(name);
      if (skill) {
        skills[skill] ??= await loadClip(urls);
        continue;
      }
      const role = ROLES.find(([, re]) => re.test(name))?.[0];
      if (role && !anims[role]) anims[role] = await loadClip(urls);
    }
  }
  if (anims.death) anims.death.rest = restRow(anims.death.frames[anims.death.frames.length - 1]);
  // No attack clip: the first skill clip (e.g. the mage's Fireball cast) stands in, so plain attacks
  // and skills without art of their own still animate.
  anims.attack ??= Object.values(skills)[0];
  const stillUrl = states.map((st) => url(st.frames?.rotations?.east ?? "")).find((u) => !!u);
  const still = stillUrl ? await loadClip([stillUrl]) : anims.idle;
  if (!still) return null;
  const { top, bottom } = opaqueRows(still.frames[0]);
  const visible = bottom + 1 - top;
  return { still, anims, skills, visible, scale: Math.max(1, MIN_VISIBLE / visible) };
}

let loading: Promise<void> | null = null;

/** Load every exported character. Call once before the first render. */
export function loadSprites(): Promise<void> {
  loading ??= Promise.all(
    Object.entries(metas).map(async ([path, meta]) => {
      const dir = path.slice(0, path.lastIndexOf("/"));
      const id = dir.slice(dir.lastIndexOf("/") + 1);
      try {
        const set = await loadSet(dir, meta);
        if (set) sets.set(id, set);
      } catch (err) {
        // A broken export falls back to the procedural character.
        console.warn(`Sprite "${id}" not loaded:`, err);
      }
    }),
  ).then(() => undefined);
  return loading;
}
