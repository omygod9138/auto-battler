// Which way each sprite faces can't be read reliably from its pixels (wings, weapons and hunched
// heads all fool a heuristic), so a person looks at it and the answer is recorded with a hash of
// the art. tests/sprite-facing.test.ts fails for any sprite that is new, changed since it was
// checked, or recorded as facing the wrong way.
//
// usage:
//   node scripts/sprite-facing.mjs                  writes sprite-facing.html: every sprite as the game shows it
//   node scripts/sprite-facing.mjs <id> right|front records that <id>'s art, as it is now, faces that way
// Heroes and mobs are both drawn facing right; the game flips mobs to face left at the hero.
// "front" is for art that faces the viewer, which reads the same either way.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const SPRITES = "src/assets/sprites";
export const RECORD = join(SPRITES, "facing.json");
export const HEROES = ["warrior", "mage", "ranger"];

/** Sprite folders the game loads (each has a metadata.json). */
export function spriteIds() {
  return readdirSync(SPRITES).filter((id) => existsSync(join(SPRITES, id, "metadata.json"))).sort();
}

/** Hash of every PNG in a sprite folder, so re-generated or edited art needs checking again. */
export function artHash(id) {
  const hash = createHash("sha256");
  const walk = (dir) => {
    for (const name of readdirSync(dir).sort()) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else if (name.endsWith(".png")) hash.update(path.slice(SPRITES.length).replaceAll("\\", "/")).update(readFileSync(path));
    }
  };
  walk(join(SPRITES, id));
  return hash.digest("hex").slice(0, 16);
}

export function readRecord() {
  return existsSync(RECORD) ? JSON.parse(readFileSync(RECORD, "utf8")) : {};
}

function sheet() {
  const record = readRecord();
  const png = (path) => (existsSync(path) ? `data:image/png;base64,${readFileSync(path).toString("base64")}` : "");
  const cards = spriteIds().map((id) => {
    const hero = HEROES.includes(id);
    const base = join(SPRITES, id, "Idle/rotations/east.png");
    const attack = join(SPRITES, id, "Idle/animations/attack/east/frame_003.png");
    const ok = record[id]?.hash === artHash(id) ? record[id].facing : "not checked";
    const img = (path) => (png(path) ? `<img src="${png(path)}" class="${hero ? "" : "flip"}">` : "");
    return `<figure>${img(base)}${img(attack)}<figcaption><b>${id}</b><br>should face ${hero ? "right →" : "← left, at the hero"}<br><i>${ok}</i></figcaption></figure>`;
  });
  writeFileSync("sprite-facing.html", `<!doctype html><meta charset="utf-8"><title>Sprite facing</title>
<style>body{background:#2b2d3a;color:#eee;font:14px sans-serif}div{display:flex;flex-wrap:wrap;gap:12px}
figure{margin:0;padding:6px;border:1px solid #556;text-align:center}img{width:128px;height:128px;image-rendering:pixelated}
.flip{transform:scaleX(-1)}</style>
<p>Every sprite as the game shows it: the hero stands on the left, mobs on the right.</p><div>${cards.join("")}</div>`);
  console.log("wrote sprite-facing.html");
}

function record(id, facing) {
  if (!spriteIds().includes(id)) throw new Error(`no sprite folder ${id}`);
  if (facing !== "right" && facing !== "front") throw new Error("facing must be right or front");
  const all = readRecord();
  all[id] = { facing, hash: artHash(id) };
  const sorted = Object.fromEntries(Object.keys(all).sort().map((k) => [k, all[k]]));
  writeFileSync(RECORD, JSON.stringify(sorted, null, 2) + "\n");
  console.log(`${id}: ${facing}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [id, facing] = process.argv.slice(2);
  if (id) record(id, facing);
  else sheet();
}
