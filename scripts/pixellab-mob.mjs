// Turn a PixelLab image + animate_image jobs into the folder layout src/ui/sprites.ts loads.
// usage: node scripts/pixellab-mob.mjs <mob id> <base image job id> <anim name>=<job id> [...]
// Frame 0 of an animate_image result is the unchanged input, so it is dropped from each clip
// except idle, where it is a real pose of the loop.
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const [id, baseJob, ...anims] = process.argv.slice(2);
if (!id || !baseJob) throw new Error("usage: pixellab-mob.mjs <mob id> <base job> <name>=<job> ...");

const api = (job, i) => `https://api.pixellab.ai/mcp/images/${job}/download${i === undefined ? "" : `?index=${i}`}`;
async function fetchPng(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} for ${url}`);
  return Buffer.from(await res.arrayBuffer());
}
/** Frames of an animate_image job: index 0 (the input) then each generated one, until a 404. */
async function frames(job) {
  const out = [];
  for (let i = 0; ; i++) {
    const res = await fetch(api(job, i));
    if (!res.ok) break;
    out.push(Buffer.from(await res.arrayBuffer()));
  }
  return out;
}

const root = join("src/assets/sprites", id);
const raw = join("characters", id, "raw");
rmSync(root, { recursive: true, force: true });
mkdirSync(join(root, "Idle/rotations"), { recursive: true });
mkdirSync(raw, { recursive: true });

const base = await fetchPng(api(baseJob));
writeFileSync(join(root, "Idle/rotations/east.png"), base);
writeFileSync(join(raw, "base.png"), base);

const animations = {};
for (const pair of anims) {
  const [name, job] = pair.split("=");
  const all = await frames(job);
  all.forEach((buf, i) => writeFileSync(join(raw, `${name}_${String(i).padStart(3, "0")}.png`), buf));
  const keep = name === "idle" ? all : all.slice(1);
  const dir = join(root, "Idle/animations", name, "east");
  mkdirSync(dir, { recursive: true });
  animations[name] = { east: keep.map((buf, i) => {
    const file = `frame_${String(i).padStart(3, "0")}.png`;
    writeFileSync(join(dir, file), buf);
    return `Idle/animations/${name}/east/${file}`;
  }) };
}

const meta = { states: [{ folder: "Idle", frames: { rotations: { east: "Idle/rotations/east.png" }, animations } }] };
writeFileSync(join(root, "metadata.json"), JSON.stringify(meta, null, 2) + "\n");
console.log(id, Object.fromEntries(Object.entries(animations).map(([k, v]) => [k, v.east.length])));
