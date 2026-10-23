import type { SkillId } from "./skills";
import type { ClassId } from "./stats";

export interface ScoreEntry {
  name: string;
  cls: ClassId;
  wins: number;
  /** Mob that ended the run. */
  killedBy: string;
  skills: [SkillId, number][];
  /** ms since epoch. */
  at: number;
}

/**
 * Where scores live. Async so an online backend (e.g. Supabase) can drop in
 * later behind the same interface without touching the UI.
 */
export interface Leaderboard {
  /** Top entries, best first; optionally one class only. */
  top(cls?: ClassId, limit?: number): Promise<ScoreEntry[]>;
  /** Saves a run; resolves to its 1-based rank in the same view top() gives, or null if it didn't place. */
  submit(entry: ScoreEntry, cls?: ClassId, limit?: number): Promise<number | null>;
}

export const TOP_N = 10;
/** Kept per device: enough for a top 10 in every class. */
const KEEP_PER_CLASS = TOP_N;

/** More wins first; on a tie the earlier run keeps its spot. */
export function byScore(a: ScoreEntry, b: ScoreEntry): number {
  return b.wins - a.wins || a.at - b.at;
}

export function cleanName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, 16) || "Hero";
}

type Store = Pick<Storage, "getItem" | "setItem">;

export class LocalLeaderboard implements Leaderboard {
  constructor(
    private store: Store,
    private key = "fjord-leaderboard-v1",
  ) {}

  private read(): ScoreEntry[] {
    try {
      const list = JSON.parse(this.store.getItem(this.key) ?? "[]");
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  private write(list: ScoreEntry[]): void {
    try {
      this.store.setItem(this.key, JSON.stringify(list));
    } catch {
      // Scores are a nicety; ignore storage failures.
    }
  }

  async top(cls?: ClassId, limit = TOP_N): Promise<ScoreEntry[]> {
    return this.read()
      .filter((e) => !cls || e.cls === cls)
      .sort(byScore)
      .slice(0, limit);
  }

  async submit(entry: ScoreEntry, cls?: ClassId, limit = TOP_N): Promise<number | null> {
    const e = { ...entry, name: cleanName(entry.name) };
    const all = [...this.read(), e].sort(byScore);
    // Trim each class to its own top N so one class can't crowd out the others.
    const kept: ScoreEntry[] = [];
    const count: Partial<Record<ClassId, number>> = {};
    for (const x of all) {
      if ((count[x.cls] ?? 0) >= KEEP_PER_CLASS) continue;
      count[x.cls] = (count[x.cls] ?? 0) + 1;
      kept.push(x);
    }
    this.write(kept);
    const rank = kept.filter((x) => !cls || x.cls === cls).indexOf(e);
    return rank >= 0 && rank < limit ? rank + 1 : null;
  }
}
