import { ARENA, TICK, type Battle, type BattleEvent, type FxKind, type Side } from "../core/battle";
import { SKILLS } from "../core/skills";

const W = 880;
const H = 320;
const GROUND = 240;
const PAD = 40;
const SCALE = (W - PAD * 2) / ARENA.length;

const px = (x: number) => PAD + x * SCALE;

interface Floater {
  born: number;
  side: Side;
  text: string;
  color: string;
  size: number;
  dx: number;
}

interface Shot {
  born: number;
  from: Side;
  fx: FxKind;
}

export interface BattleLook {
  heroIcon: string;
  mobIcon: string;
  mobBoss: boolean;
}

/** Animates a Battle on a side-view canvas, stepping the deterministic sim in real time. */
export function playBattle(
  canvas: HTMLCanvasElement,
  hud: HTMLElement,
  battle: Battle,
  look: BattleLook,
  speed: () => number,
  onEnd: () => void,
): () => void {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(dpr, dpr);

  const floaters: Floater[] = [];
  const shots: Shot[] = [];
  const lastLunge: Record<Side, number> = { hero: -1, mob: -1 };
  let seen = 0;
  let acc = 0;
  let last = performance.now();
  let raf = 0;
  let stopped = false;
  let endedAt: number | null = null;

  const ingest = (e: BattleEvent) => {
    const dx = (Math.random() - 0.5) * 30;
    switch (e.type) {
      case "damage": {
        const attacker: Side = e.target === "mob" ? "hero" : "mob";
        if (e.fx === "slash" || e.fx === "claw" || e.fx === "bash") lastLunge[attacker] = e.t;
        else shots.push({ born: e.t, from: attacker, fx: e.fx });
        const color = e.target === "mob" ? (e.crit ? "#ffd84a" : "#ffffff") : "#ff6b5e";
        floaters.push({ born: e.t, side: e.target, text: `${Math.round(e.amount)}${e.crit ? "!" : ""}`, color, size: e.crit ? 22 : 16, dx });
        if (e.label) floaters.push({ born: e.t, side: attacker, text: e.label, color: "#9fd3ff", size: 14, dx: 0 });
        break;
      }
      case "dot":
        floaters.push({ born: e.t, side: e.target, text: `${Math.round(e.amount)}`, color: e.kind === "poison" ? "#8be36b" : e.kind === "burn" ? "#ff9b3d" : "#d9c27a", size: 13, dx });
        break;
      case "heal":
        if (e.amount >= 2) floaters.push({ born: e.t, side: e.target, text: `+${Math.round(e.amount)}`, color: "#5fe07a", size: 14, dx });
        break;
      case "dodge":
        floaters.push({ born: e.t, side: e.target, text: "miss", color: "#b9c2cc", size: 14, dx });
        break;
      case "status":
        floaters.push({ born: e.t, side: e.target, text: e.label, color: "#c9a7ff", size: 16, dx: 0 });
        break;
    }
  };

  const frame = (now: number) => {
    if (stopped) return;
    acc += Math.min(0.25, (now - last) / 1000) * speed();
    last = now;
    while (acc >= TICK && !battle.outcome) {
      battle.step();
      acc -= TICK;
    }
    while (seen < battle.events.length) ingest(battle.events[seen++]);
    draw(ctx, battle, look, floaters, shots, lastLunge);
    renderHud(hud, battle);
    if (battle.outcome) {
      endedAt ??= now;
      // Let the last numbers float a moment before showing the result.
      if (now - endedAt > 600) {
        onEnd();
        return;
      }
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
  };
}

function renderHud(hud: HTMLElement, battle: Battle): void {
  const cds = battle.cooldowns();
  const html = cds
    .map(({ id, left, total }) => {
      const ready = left <= 0;
      const pct = ready ? 100 : Math.round((1 - left / total) * 100);
      return `<span class="cd ${ready ? "ready" : ""}" style="--p:${pct}%" title="${SKILLS[id].name}">${SKILLS[id].icon}</span>`;
    })
    .join("");
  if (hud.dataset.html !== html) {
    hud.innerHTML = html;
    hud.dataset.html = html;
  }
}

function draw(
  ctx: CanvasRenderingContext2D,
  battle: Battle,
  look: BattleLook,
  floaters: Floater[],
  shots: Shot[],
  lunge: Record<Side, number>,
): void {
  const t = battle.time;
  // Sky, far mountains, ground.
  const sky = ctx.createLinearGradient(0, 0, 0, GROUND);
  sky.addColorStop(0, "#1e2a3f");
  sky.addColorStop(1, "#4a5d78");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = "#33435a";
  ctx.beginPath();
  ctx.moveTo(0, GROUND);
  for (let x = 0; x <= W; x += 80) ctx.lineTo(x + 40, GROUND - 60 - ((x * 37) % 50));
  ctx.lineTo(W, GROUND);
  ctx.fill();
  ctx.fillStyle = "#3d5233";
  ctx.fillRect(0, GROUND, W, H - GROUND);
  ctx.fillStyle = "#4c6640";
  ctx.fillRect(0, GROUND, W, 6);

  if (battle.snareX !== null) {
    ctx.font = "20px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("🪤", px(battle.snareX), GROUND + 22);
  }

  const pos: Record<Side, number> = {
    hero: px(battle.hero.x) + (t - lunge.hero < 0.12 ? 10 : 0),
    mob: px(battle.mob.x) - (t - lunge.mob < 0.12 ? 10 : 0),
  };

  drawFighter(ctx, look.heroIcon, pos.hero, 48, battle.hero.hp / battle.hero.s.maxHp, "#5fe07a", battle.hero.shield / battle.hero.s.maxHp, battle.hero.stun > 0, false, battle.hero.hp <= 0);
  const mobSize = look.mobBoss ? 76 : 52;
  drawFighter(ctx, look.mobIcon, pos.mob, mobSize, battle.mob.hp / battle.mob.s.maxHp, "#ff7a6b", 0, battle.mob.stun > 0, battle.mob.root > 0, battle.mob.hp <= 0);

  // Projectiles travel attacker -> target in 0.18s.
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i];
    const k = (t - s.born) / 0.18;
    if (k > 1) {
      shots.splice(i, 1);
      continue;
    }
    const from = s.from === "hero" ? pos.hero : pos.mob;
    const to = s.from === "hero" ? pos.mob : pos.hero;
    const x = from + (to - from) * k;
    const y = s.fx === "meteor" ? 20 + (GROUND - 50) * k : GROUND - 34 - Math.sin(k * Math.PI) * 18;
    const glyph: Record<FxKind, string> = {
      arrow: "➶", bolt: "✦", fireball: "🔥", frost: "❄️", meteor: "☄️", lightning: "⚡", spit: "➵", slash: "", claw: "", bash: "",
    };
    ctx.font = s.fx === "meteor" ? "40px sans-serif" : "22px sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = s.from === "hero" ? "#f5e6a8" : "#ffb0a6";
    ctx.fillText(glyph[s.fx], s.fx === "meteor" ? to : x, y);
  }

  // Floating numbers.
  ctx.textAlign = "center";
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i];
    const age = t - f.born;
    if (age > 1 || age < 0) {
      if (age > 1) floaters.splice(i, 1);
      continue;
    }
    ctx.globalAlpha = 1 - age;
    ctx.font = `700 ${f.size}px system-ui, sans-serif`;
    ctx.fillStyle = "#000";
    const x = pos[f.side] + f.dx;
    const y = GROUND - 100 - age * 50;
    ctx.fillText(f.text, x + 1, y + 1);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, x, y);
  }
  ctx.globalAlpha = 1;

  ctx.fillStyle = "rgba(255,255,255,0.75)";
  ctx.font = "13px system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(`${t.toFixed(1)}s`, 10, 18);
}

function drawFighter(
  ctx: CanvasRenderingContext2D,
  icon: string,
  x: number,
  size: number,
  hpFrac: number,
  hpColor: string,
  shieldFrac: number,
  stunned: boolean,
  rooted: boolean,
  dead: boolean,
): void {
  ctx.save();
  if (dead) ctx.globalAlpha = 0.3;
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  ctx.ellipse(x, GROUND + 4, size * 0.45, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `${size}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(icon, x, GROUND);
  ctx.restore();

  const w = 64;
  const top = GROUND - size - 14;
  ctx.fillStyle = "#111";
  ctx.fillRect(x - w / 2, top, w, 7);
  ctx.fillStyle = hpColor;
  ctx.fillRect(x - w / 2, top, w * Math.max(0, hpFrac), 7);
  if (shieldFrac > 0) {
    ctx.fillStyle = "#6fb6ff";
    ctx.fillRect(x - w / 2, top - 4, w * Math.min(1, shieldFrac * 2), 3);
  }
  ctx.font = "16px sans-serif";
  ctx.textAlign = "center";
  if (stunned) ctx.fillText("💫", x, top - 8);
  else if (rooted) ctx.fillText("🌿", x, top - 8);
}
