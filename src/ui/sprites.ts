// Pixel-art characters exported from PixelLab. Drop an export into
// src/assets/sprites/<character id>/ (metadata.json plus its PNG folders) and
// that character is drawn from the art instead of the procedural rig.

export type SpriteAnim = "idle" | "walk" | "attack" | "hurt" | "death";

export interface SpriteSet {
  /** Still, right-facing pose; used whenever an animation is missing. */
  still: HTMLImageElement;
  anims: Partial<Record<SpriteAnim, HTMLImageElement[]>>;
  /** Frame size in art pixels. */
  w: number;
  h: number;
  /** Row just below the lowest opaque pixel of the still, i.e. where the feet touch the ground. */
  foot: number;
  /** Height of the opaque art above the feet. */
  visible: number;
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
const pngs = import.meta.glob<string>("../assets/sprites/**/*.png", { eager: true, query: "?url", import: "default" });

/** Animation names are free text in PixelLab, so match them by keyword. */
const ROLES: [SpriteAnim, RegExp][] = [
  ["death", /death|dying|die|fall/i],
  ["hurt", /hurt|hit|damage|recoil|flinch/i],
  ["attack", /attack|slash|chop|swing|strike|stab|shoot|cast/i],
  ["walk", /walk|run|march|move/i],
  ["idle", /idle|breath|stand/i],
];

const sets = new Map<string, SpriteSet>();

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

function opaqueRows(img: HTMLImageElement): { top: number; bottom: number } {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext("2d")!;
  g.drawImage(img, 0, 0);
  const { data } = g.getImageData(0, 0, c.width, c.height);
  let top = c.height;
  let bottom = -1;
  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      if (data[(y * c.width + x) * 4 + 3] > 0) {
        top = Math.min(top, y);
        bottom = y;
        break;
      }
    }
  }
  return bottom < 0 ? { top: 0, bottom: c.height - 1 } : { top, bottom };
}

async function loadSet(dir: string, meta: PixelLabExport): Promise<SpriteSet | null> {
  const url = (path: string) => pngs[`${dir}/${path}`];
  const frames = meta.states?.[0]?.frames;
  const anims: SpriteSet["anims"] = {};
  for (const [name, entry] of Object.entries(frames?.animations ?? {})) {
    const role = ROLES.find(([, re]) => re.test(name))?.[0];
    if (!role || anims[role]) continue;
    const urls = eastFrames(entry).map(url).filter((u): u is string => !!u);
    if (urls.length) anims[role] = await Promise.all(urls.map(loadImage));
  }
  const stillUrl = url(frames?.rotations?.east ?? "") ?? undefined;
  const still = stillUrl ? await loadImage(stillUrl) : anims.idle?.[0];
  if (!still) return null;
  const { top, bottom } = opaqueRows(still);
  return { still, anims, w: still.width, h: still.height, foot: bottom + 1, visible: bottom + 1 - top };
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
