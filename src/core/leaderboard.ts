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
  /** "global" = shared online board, "device" = this browser only. */
  readonly scope: "global" | "device";
  /** Top entries, best first; optionally one class only. */
  top(cls?: ClassId, limit?: number): Promise<ScoreEntry[]>;
  /**
   * Saves a run. Resolves to the entry as stored (server time, cleaned name)
   * and its 1-based rank in the view top(cls, limit) gives, or null if it didn't place.
   */
  submit(entry: ScoreEntry, cls?: ClassId, limit?: number): Promise<Submitted>;
}

export interface Submitted {
  saved: ScoreEntry;
  rank: number | null;
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
  readonly scope = "device";
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

  async submit(entry: ScoreEntry, cls?: ClassId, limit = TOP_N): Promise<Submitted> {
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
    return { saved: e, rank: rank >= 0 && rank < limit ? rank + 1 : null };
  }
}

interface ScoreRow {
  id: number;
  name: string;
  cls: ClassId;
  wins: number;
  killed_by: string;
  skills: [SkillId, number][];
  created_at: string;
}

const fromRow = (r: ScoreRow): ScoreEntry & { id: number } => ({
  id: r.id,
  name: r.name,
  cls: r.cls,
  wins: r.wins,
  killedBy: r.killed_by,
  skills: r.skills,
  at: Date.parse(r.created_at),
});

/**
 * Project origin from whatever was pasted as the Supabase URL: copies from the
 * dashboard may carry a path like /rest/v1/ or lack the scheme.
 */
export function apiBase(url: string): string {
  try {
    return new URL(/^https?:\/\//.test(url.trim()) ? url.trim() : `https://${url.trim()}`).origin;
  } catch {
    return url.replace(/\/+$/, "");
  }
}

/** Shared board in a Supabase `scores` table (supabase/migrations), via its REST API. */
export class SupabaseLeaderboard implements Leaderboard {
  readonly scope = "global";

  constructor(
    private url: string,
    private key: string,
    private fetcher: typeof fetch = (...a) => fetch(...a),
  ) {}

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.fetcher(`${apiBase(this.url)}/rest/v1/${path}`, {
      ...init,
      headers: { apikey: this.key, Authorization: `Bearer ${this.key}`, "Content-Type": "application/json", ...init.headers },
    });
    if (!res.ok) throw new Error(`Leaderboard ${res.status}: ${await res.text()}`);
    return res.json() as Promise<T>;
  }

  private async rows(cls?: ClassId, limit = TOP_N): Promise<(ScoreEntry & { id: number })[]> {
    const q = new URLSearchParams({ select: "*", order: "wins.desc,created_at.asc", limit: String(limit) });
    if (cls) q.set("cls", `eq.${cls}`);
    return (await this.call<ScoreRow[]>(`scores?${q}`)).map(fromRow);
  }

  async top(cls?: ClassId, limit = TOP_N): Promise<ScoreEntry[]> {
    return this.rows(cls, limit);
  }

  async submit(entry: ScoreEntry, cls?: ClassId, limit = TOP_N): Promise<Submitted> {
    const body = { name: cleanName(entry.name), cls: entry.cls, wins: entry.wins, killed_by: entry.killedBy.slice(0, 40), skills: entry.skills };
    const [row] = await this.call<ScoreRow[]>("scores", {
      method: "POST",
      headers: { Prefer: "return=representation" },
      body: JSON.stringify(body),
    });
    const saved = fromRow(row);
    const rank = (await this.rows(cls, limit)).findIndex((e) => e.id === saved.id);
    return { saved, rank: rank >= 0 ? rank + 1 : null };
  }
}

/** Uses the online board, dropping to the local one when the network or server fails. */
export class FallbackLeaderboard implements Leaderboard {
  scope: "global" | "device";

  constructor(
    private primary: Leaderboard,
    private backup: Leaderboard,
  ) {
    this.scope = primary.scope;
  }

  private async run<T>(f: (lb: Leaderboard) => Promise<T>): Promise<T> {
    try {
      const r = await f(this.primary);
      this.scope = this.primary.scope;
      return r;
    } catch (err) {
      console.warn(err);
      this.scope = this.backup.scope;
      return f(this.backup);
    }
  }

  top(cls?: ClassId, limit?: number): Promise<ScoreEntry[]> {
    return this.run((lb) => lb.top(cls, limit));
  }

  submit(entry: ScoreEntry, cls?: ClassId, limit?: number): Promise<Submitted> {
    return this.run((lb) => lb.submit(entry, cls, limit));
  }
}
