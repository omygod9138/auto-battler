import {
  BUILDINGS,
  CLANS,
  FATE_CARDS,
  RULES,
  SHOP_BUILDINGS,
  baseModifiers,
  type BuildingId,
  type ClanId,
  UNITS,
  type FateCard,
  type Modifiers,
} from "./data";
import {
  buildWarband,
  cloneBoard,
  generateBoard,
  income,
  place,
  placementError,
  type Board,
  type UnitStats,
} from "./board";
import { Battle, type Outcome } from "./combat";
import { Rng, hashSeed } from "./rng";

export type Phase = "build" | "fate" | "battle" | "won" | "lost";

export interface Opponent {
  name: string;
  /** null for neutral raiders. */
  clan: ClanId | null;
  units: UnitStats[];
  ghost: boolean;
}

export interface RoundResult {
  round: number;
  outcome: Outcome;
  damageTaken: number;
  opponent: string;
}

export interface RunState {
  seed: number;
  clan: ClanId;
  round: number;
  hp: number;
  wood: number;
  lore: number;
  board: Board;
  mods: Modifiers;
  fateTaken: string[];
  phase: Phase;
  shop: BuildingId[];
  rerolls: number;
  /** Bought but not yet placed. */
  pending: BuildingId | null;
  fateOffers: string[];
  opponent: Opponent | null;
  history: RoundResult[];
}

export function newRun(seed: number, clan: ClanId): RunState {
  const mods = baseModifiers();
  CLANS[clan].apply(mods);
  const s: RunState = {
    seed,
    clan,
    round: 0,
    hp: RULES.startHp,
    wood: RULES.startWood,
    lore: 0,
    board: generateBoard(hashSeed(seed, "map")),
    mods,
    fateTaken: [],
    phase: "build",
    shop: [],
    rerolls: 0,
    pending: null,
    fateOffers: [],
    opponent: null,
    history: [],
  };
  startRound(s);
  return s;
}

function rollShop(seed: number, round: number, rerolls: number): BuildingId[] {
  const rng = new Rng(hashSeed(seed, "shop", round, rerolls));
  const pool = SHOP_BUILDINGS.filter((b) => b.minRound <= round);
  const out: BuildingId[] = [];
  for (let n = 0; n < RULES.shopSize; n++) {
    const total = pool.reduce((s, b) => s + b.weight, 0);
    let r = rng.next() * total;
    const hit = pool.find((b) => (r -= b.weight) < 0) ?? pool[pool.length - 1];
    out.push(hit.id);
  }
  return out;
}

function startRound(s: RunState): void {
  s.round += 1;
  const inc = income(s.board, s.mods);
  s.wood += inc.wood;
  s.lore += inc.lore;
  s.rerolls = 0;
  s.shop = rollShop(s.seed, s.round, 0);
  s.pending = null;
  s.opponent = null;
  s.phase = "build";
}

export function buy(s: RunState, slot: number): void {
  const id = s.shop[slot];
  if (s.phase !== "build" || !id || s.pending) return;
  if (s.wood < BUILDINGS[id].cost) return;
  s.wood -= BUILDINGS[id].cost;
  s.pending = id;
  s.shop.splice(slot, 1);
}

export function cancelPending(s: RunState): void {
  if (!s.pending) return;
  s.wood += BUILDINGS[s.pending].cost;
  s.shop.push(s.pending);
  s.pending = null;
}

export function placePending(s: RunState, tile: number): string | null {
  if (!s.pending) return "nothing to place";
  const err = placementError(s.board, tile, s.pending);
  if (err) return err;
  place(s.board, tile, s.pending);
  s.pending = null;
  return null;
}

export function reroll(s: RunState): void {
  if (s.phase !== "build" || s.pending || s.wood < RULES.rerollCost) return;
  s.wood -= RULES.rerollCost;
  s.rerolls += 1;
  s.shop = rollShop(s.seed, s.round, s.rerolls);
}

export function endBuild(s: RunState): void {
  if (s.phase !== "build") return;
  cancelPending(s);
  const rng = new Rng(hashSeed(s.seed, "fate", s.round));
  const available = FATE_CARDS.filter((c) => !s.fateTaken.includes(c.id));
  s.fateOffers = rng.sample(available, RULES.fateOffers).map((c) => c.id);
  s.phase = "fate";
}

export const fateCard = (id: string): FateCard => FATE_CARDS.find((c) => c.id === id)!;

export function takeFate(s: RunState, id: string | null): void {
  if (s.phase !== "fate") return;
  applyFate(s, id);
  s.opponent = s.round <= RULES.neutralRounds ? neutralOpponent(s.round) : botOpponent(s.seed, s.round);
}

export function neutralOpponent(round: number): Opponent {
  const d = UNITS.draugr;
  const unit: UnitStats = { kind: "draugr", hp: d.hp, atk: d.atk, range: d.range, speed: d.speed, cooldown: d.cooldown, threat: d.threat };
  return { name: "Draugr raiders", clan: null, units: Array.from({ length: round * 2 - 1 }, () => ({ ...unit })), ghost: false };
}

function applyFate(s: RunState, id: string | null): void {
  if (id) {
    const card = fateCard(id);
    if (!s.fateOffers.includes(id) || s.lore < card.cost) return;
    s.lore -= card.cost;
    card.apply(s.mods);
    s.fateTaken.push(id);
  }
  s.fateOffers = [];
  s.phase = "battle";
}

/** Applies a finished battle. `enemyThreat` is the surviving enemy threat on a loss. */
export function resolveBattle(s: RunState, outcome: Outcome, enemyThreat: number): void {
  if (s.phase !== "battle") return;
  const damageTaken = outcome === "loss" ? lossDamage(s.round, enemyThreat) : 0;
  s.hp = Math.max(0, s.hp - damageTaken);
  s.history.push({ round: s.round, outcome, damageTaken, opponent: s.opponent?.name ?? "?" });
  if (s.hp <= 0) s.phase = "lost";
  else if (s.round >= RULES.finalRound) s.phase = "won";
  else startRound(s);
}

/** Damage the loser takes: grows with the round, plus capped surviving threat. */
export function lossDamage(round: number, survivingThreat: number): number {
  return 1 + Math.ceil(round / 2) + Math.min(RULES.maxThreatDamage, survivingThreat);
}

export function playerWarband(s: RunState) {
  return buildWarband(s.board, s.mods);
}

export function fight(s: RunState): Battle {
  return new Battle(playerWarband(s).units, s.opponent?.units ?? []);
}

// ---------------------------------------------------------------------------
// Bot: plays the same rules with a greedy policy. Stands in for other players
// until real asynchronous ghosts are available.

const BOT_NAMES = ["Sigrun", "Ragnar", "Astrid", "Bjorn", "Freydis", "Halvard", "Ingrid", "Ulf", "Thyra", "Eirik"];

export function warbandPower(units: UnitStats[]): number {
  return units.reduce((s, u) => s + Math.sqrt(u.hp * (u.atk / u.cooldown)) * (u.range > 2 ? 1.2 : 1), 0);
}

function scoreBoard(b: Board, m: Modifiers, round: number): number {
  const inc = income(b, m);
  const wb = buildWarband(b, m);
  const late = round / RULES.finalRound;
  return inc.wood * (1.2 - late) + inc.lore * 0.5 * (1 - late) + Math.min(inc.food, wb.supplyUsed + 4) * 0.6 + warbandPower(wb.units) * (0.4 + late);
}

export function botOpponent(seed: number, round: number): Opponent {
  const rng = new Rng(hashSeed(seed, "bot", round));
  const clan = rng.pick(Object.keys(CLANS) as ClanId[]);
  const s = newRun(hashSeed(seed, "botrun", round), clan);
  while (s.round <= round) {
    botBuild(s, rng);
    endBuild(s);
    const affordable = s.fateOffers.filter((id) => fateCard(id).cost <= s.lore);
    applyFate(s, affordable.length ? rng.pick(affordable) : null);
    if (s.round === round) break;
    // Bots don't lose HP; they only need to grow.
    resolveBattle(s, "win", 0);
  }
  return { name: rng.pick(BOT_NAMES), clan, units: playerWarband(s).units, ghost: false };
}

function botBuild(s: RunState, rng: Rng): void {
  for (let guard = 0; guard < 20; guard++) {
    let best: { slot: number; tile: number; score: number } | null = null;
    const baseScore = scoreBoard(s.board, s.mods, s.round);
    s.shop.forEach((id, slot) => {
      if (BUILDINGS[id].cost > s.wood) return;
      s.board.tiles.forEach((_, tile) => {
        if (placementError(s.board, tile, id)) return;
        const trial = cloneBoard(s.board);
        place(trial, tile, id);
        const score = (scoreBoard(trial, s.mods, s.round) - baseScore) / BUILDINGS[id].cost + rng.next() * 0.05;
        if (!best || score > best.score) best = { slot, tile, score };
      });
    });
    if (best) {
      const { slot, tile } = best;
      buy(s, slot);
      placePending(s, tile);
    } else if (s.wood >= RULES.rerollCost + 3) {
      reroll(s);
    } else {
      return;
    }
  }
}
