import type { UnitStats } from "../core/board";
import type { ClanId } from "../core/data";
import type { Opponent } from "../core/game";

// Asynchronous PvP stand-in: every warband you field is saved as a "ghost"
// that later runs (in this browser) can be matched against. A server-backed
// store would make these other players' ghosts instead.

const KEY = "fjord-ghosts-v1";
const PER_ROUND = 8;

interface GhostRecord {
  seed: number;
  round: number;
  clan: ClanId;
  units: UnitStats[];
}

function load(): GhostRecord[] {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "[]") as GhostRecord[];
  } catch {
    return [];
  }
}

export function saveGhost(rec: GhostRecord): void {
  try {
    const all = load().filter((g) => !(g.seed === rec.seed && g.round === rec.round));
    all.push(rec);
    const sameRound = all.filter((g) => g.round === rec.round);
    const trimmed = sameRound.length > PER_ROUND ? all.filter((g) => g !== sameRound[0]) : all;
    localStorage.setItem(KEY, JSON.stringify(trimmed));
  } catch {
    // Storage unavailable: ghosts are a bonus, not required.
  }
}

/** A ghost from another run at the same round, if any. */
export function findGhost(round: number, excludeSeed: number, roll: number): Opponent | null {
  const pool = load().filter((g) => g.round === round && g.seed !== excludeSeed && g.units.length > 0);
  if (pool.length === 0) return null;
  const g = pool[Math.floor(roll * pool.length)];
  return { name: `Ghost of run #${g.seed % 10000}`, clan: g.clan, units: g.units, ghost: true };
}
