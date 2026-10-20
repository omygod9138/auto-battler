import type { UnitStats } from "./board";

export const ARENA = { width: 24, height: 12 };
export const TICK = 1 / 20;
export const TIME_LIMIT = 45;

export type Side = "player" | "enemy";

export interface Fighter extends UnitStats {
  id: number;
  side: Side;
  maxHp: number;
  x: number;
  y: number;
  cd: number;
  /** Battle time of the last hit this fighter landed, and on whom (for rendering). */
  lastHitAt: number;
  lastTarget: number | null;
}

export type Outcome = "win" | "loss" | "draw";

function deploy(units: UnitStats[], side: Side, startId: number): Fighter[] {
  // Melee in the front column(s), ranged behind, spread vertically.
  const sorted = [...units].sort((a, b) => a.range - b.range);
  const perCol = 6;
  return sorted.map((u, n) => {
    const col = Math.floor(n / perCol);
    const row = n % perCol;
    const rowsInCol = Math.min(perCol, sorted.length - col * perCol);
    const y = ((row + 0.5) / rowsInCol) * ARENA.height;
    const front = side === "player" ? ARENA.width / 2 - 3 : ARENA.width / 2 + 3;
    const x = side === "player" ? front - col * 1.5 : front + col * 1.5;
    return { ...u, id: startId + n, side, maxHp: u.hp, x, y, cd: 0, lastHitAt: -1, lastTarget: null };
  });
}

export class Battle {
  fighters: Fighter[];
  time = 0;
  outcome: Outcome | null = null;

  constructor(player: UnitStats[], enemy: UnitStats[]) {
    this.fighters = [...deploy(player, "player", 0), ...deploy(enemy, "enemy", player.length)];
    this.checkEnd();
  }

  alive(side?: Side): Fighter[] {
    return this.fighters.filter((f) => f.hp > 0 && (!side || f.side === side));
  }

  step(): void {
    if (this.outcome) return;
    this.time += TICK;
    const living = this.alive();
    for (const f of living) {
      if (f.hp <= 0) continue;
      const foes = living.filter((o) => o.side !== f.side && o.hp > 0);
      if (foes.length === 0) break;
      let target = foes[0];
      let best = Infinity;
      for (const o of foes) {
        const d = Math.hypot(o.x - f.x, o.y - f.y);
        if (d < best) {
          best = d;
          target = o;
        }
      }
      f.cd = Math.max(0, f.cd - TICK);
      if (best <= f.range) {
        if (f.cd === 0) {
          target.hp = Math.max(0, target.hp - f.atk);
          f.cd = f.cooldown;
          f.lastHitAt = this.time;
          f.lastTarget = target.id;
        }
      } else {
        const step = Math.min(f.speed * TICK, best - f.range * 0.9);
        f.x += ((target.x - f.x) / best) * step;
        f.y += ((target.y - f.y) / best) * step;
      }
    }
    this.separate();
    this.checkEnd();
  }

  /** Pushes overlapping allies apart so blobs don't collapse into one point. */
  private separate(): void {
    const living = this.alive();
    const minDist = 0.7;
    for (let a = 0; a < living.length; a++) {
      for (let b = a + 1; b < living.length; b++) {
        const p = living[a];
        const q = living[b];
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const d = Math.hypot(dx, dy);
        if (d > 0 && d < minDist) {
          const push = (minDist - d) / 2;
          p.x -= (dx / d) * push;
          p.y -= (dy / d) * push;
          q.x += (dx / d) * push;
          q.y += (dy / d) * push;
        }
      }
    }
    for (const f of living) {
      f.x = Math.min(ARENA.width, Math.max(0, f.x));
      f.y = Math.min(ARENA.height, Math.max(0, f.y));
    }
  }

  private checkEnd(): void {
    const p = this.alive("player").length;
    const e = this.alive("enemy").length;
    if (p === 0 && e === 0) this.outcome = "draw";
    else if (e === 0) this.outcome = "win";
    else if (p === 0) this.outcome = "loss";
    else if (this.time >= TIME_LIMIT) this.outcome = "draw";
  }

  runToEnd(): Outcome {
    while (!this.outcome) this.step();
    return this.outcome;
  }

  /** Threat of the winner's surviving units; this is the damage dealt to the loser. */
  survivingThreat(side: Side): number {
    return this.alive(side).reduce((s, f) => s + f.threat, 0);
  }
}
