import { UNITS } from "../core/data";
import { ARENA, TICK, type Battle } from "../core/combat";

const SCALE = 30;
const PAD = 20;

/** Animates a Battle on a canvas, stepping the deterministic sim in real time. */
export function playBattle(canvas: HTMLCanvasElement, battle: Battle, speed: () => number, onEnd: () => void): () => void {
  canvas.width = ARENA.width * SCALE + PAD * 2;
  canvas.height = ARENA.height * SCALE + PAD * 2;
  const ctx = canvas.getContext("2d")!;
  let acc = 0;
  let last = performance.now();
  let raf = 0;
  let stopped = false;

  const frame = (now: number) => {
    if (stopped) return;
    acc += Math.min(0.25, (now - last) / 1000) * speed();
    last = now;
    while (acc >= TICK && !battle.outcome) {
      battle.step();
      acc -= TICK;
    }
    draw(ctx, battle);
    if (battle.outcome) {
      onEnd();
      return;
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
  };
}

const sx = (x: number) => PAD + x * SCALE;
const sy = (y: number) => PAD + y * SCALE;

function draw(ctx: CanvasRenderingContext2D, battle: Battle): void {
  const { width, height } = ctx.canvas;
  ctx.fillStyle = "#3b4a3a";
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.beginPath();
  ctx.moveTo(width / 2, 0);
  ctx.lineTo(width / 2, height);
  ctx.stroke();

  const byId = new Map(battle.fighters.map((f) => [f.id, f]));

  // Attack flashes.
  for (const f of battle.fighters) {
    if (f.hp <= 0 || f.lastTarget === null || battle.time - f.lastHitAt > 0.18) continue;
    const t = byId.get(f.lastTarget)!;
    ctx.strokeStyle = f.range > 2 ? "#f5e6a8" : f.side === "player" ? "#9fd3ff" : "#ff9f9f";
    ctx.lineWidth = f.range > 2 ? 1.5 : 3;
    ctx.beginPath();
    ctx.moveTo(sx(f.x), sy(f.y));
    ctx.lineTo(sx(t.x), sy(t.y));
    ctx.stroke();
  }

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const f of battle.fighters) {
    const r = f.kind === "troll" ? 16 : 11;
    const x = sx(f.x);
    const y = sy(f.y);
    if (f.hp <= 0) {
      ctx.globalAlpha = 0.25;
      ctx.font = "12px sans-serif";
      ctx.fillText("✖", x, y);
      ctx.globalAlpha = 1;
      continue;
    }
    ctx.fillStyle = f.side === "player" ? "#2d6cdf" : "#c0392b";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.font = `${r + 2}px sans-serif`;
    ctx.fillText(UNITS[f.kind].icon, x, y + 1);
    const w = r * 2;
    ctx.fillStyle = "#111";
    ctx.fillRect(x - r, y - r - 6, w, 4);
    ctx.fillStyle = f.side === "player" ? "#5fe07a" : "#ffb347";
    ctx.fillRect(x - r, y - r - 6, w * (f.hp / f.maxHp), 4);
  }

  ctx.fillStyle = "#fff";
  ctx.font = "14px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`${battle.time.toFixed(1)}s`, 8, 12);
}
