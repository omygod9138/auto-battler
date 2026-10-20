import {
  BUILDINGS,
  RULES,
  TERRAIN_INFO,
  UNITS,
  type BuildingId,
  type Modifiers,
  type Neighborhood,
  type Terrain,
  type UnitKind,
  type Yield,
} from "./data";
import { Rng } from "./rng";

export interface Tile {
  terrain: Terrain;
  building: BuildingId | null;
  /** Order the building was placed in; earlier military buildings get supply first. */
  builtAt: number;
}

export interface Board {
  size: number;
  tiles: Tile[];
}

export const idx = (b: Board, x: number, y: number) => y * b.size + x;
export const pos = (b: Board, i: number) => ({ x: i % b.size, y: Math.floor(i / b.size) });

export function neighbors(b: Board, i: number): number[] {
  const { x, y } = pos(b, i);
  const out: number[] = [];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < b.size && ny < b.size) out.push(idx(b, nx, ny));
  }
  return out;
}

export function neighborhood(b: Board, i: number): Neighborhood {
  const ns = neighbors(b, i).map((n) => b.tiles[n]);
  return {
    terrain: ns.map((t) => t.terrain),
    buildings: ns.flatMap((t) => (t.building ? [t.building] : [])),
  };
}

export function generateBoard(seed: number, size = RULES.boardSize): Board {
  const rng = new Rng(seed);
  const tiles: Tile[] = [];
  for (let i = 0; i < size * size; i++) {
    const r = rng.next();
    const terrain: Terrain =
      r < 0.4 ? "plain" : r < 0.6 ? "forest" : r < 0.78 ? "fertile" : r < 0.9 ? "stone" : "mountain";
    tiles.push({ terrain, building: null, builtAt: -1 });
  }
  const board: Board = { size, tiles };
  const center = idx(board, Math.floor(size / 2), Math.floor(size / 2));
  board.tiles[center] = { terrain: "plain", building: "townhall", builtAt: 0 };
  // Guarantee at least one mountain so mythic sites stay possible.
  if (!tiles.some((t) => t.terrain === "mountain")) {
    tiles[rng.pick(tiles.map((_, i) => i).filter((i) => i !== center))].terrain = "mountain";
  }
  return board;
}

export function cloneBoard(b: Board): Board {
  return { size: b.size, tiles: b.tiles.map((t) => ({ ...t })) };
}

/** Why a building can't go on a tile, or null if it can. Territory grows outward from the town hall. */
export function placementError(b: Board, i: number, id: BuildingId): string | null {
  const tile = b.tiles[i];
  if (tile.building) return "tile is occupied";
  if (!TERRAIN_INFO[tile.terrain].buildable) return "mountains can't be built on";
  if (!neighbors(b, i).some((n) => b.tiles[n].building)) return "must touch your settlement";
  const def = BUILDINGS[id];
  if (def.canPlace && !def.canPlace(neighborhood(b, i))) return def.placeHint ?? "invalid spot";
  return null;
}

export function place(b: Board, i: number, id: BuildingId): void {
  const err = placementError(b, i, id);
  if (err) throw new Error(`Cannot place ${id}: ${err}`);
  const order = Math.max(...b.tiles.map((t) => t.builtAt)) + 1;
  b.tiles[i] = { ...b.tiles[i], building: id, builtAt: order };
}

export function tileYield(b: Board, i: number, m: Modifiers): Yield {
  const id = b.tiles[i].building;
  const def = id ? BUILDINGS[id] : null;
  return def?.yield ? def.yield(neighborhood(b, i), m) : { wood: 0, food: 0, lore: 0 };
}

export function income(b: Board, m: Modifiers): Yield {
  const total: Yield = { wood: m.woodIncome, food: m.foodIncome, lore: m.loreIncome };
  b.tiles.forEach((_, i) => {
    const y = tileYield(b, i, m);
    total.wood += y.wood;
    total.food += y.food;
    total.lore += y.lore;
  });
  return total;
}

export interface UnitStats {
  kind: UnitKind;
  hp: number;
  atk: number;
  range: number;
  speed: number;
  cooldown: number;
  threat: number;
}

export interface Warband {
  units: UnitStats[];
  supplyUsed: number;
  supplyCap: number;
  /** Units that were trained but couldn't be fielded for lack of food. */
  unfed: number;
}

/** Turns the settlement into a warband. Food is the supply cap; oldest barracks are fed first. */
export function buildWarband(b: Board, m: Modifiers): Warband {
  const supplyCap = income(b, m).food;
  const military = b.tiles
    .map((t, i) => ({ t, i }))
    .filter(({ t }) => t.building && BUILDINGS[t.building].units)
    .sort((a, c) => a.t.builtAt - c.t.builtAt);

  const units: UnitStats[] = [];
  let supplyUsed = 0;
  let unfed = 0;
  for (const { t, i } of military) {
    const spec = BUILDINGS[t.building!].units!;
    const base = UNITS[spec.kind];
    let atk = base.atk + m.unitAtk[spec.kind];
    let hpPct = m.unitHpPct[spec.kind];
    for (const n of neighbors(b, i)) {
      const aura = b.tiles[n].building ? BUILDINGS[b.tiles[n].building!].aura : undefined;
      atk += aura?.atk ?? 0;
      hpPct += aura?.hpPct ?? 0;
    }
    for (let c = 0; c < spec.count; c++) {
      if (supplyUsed + base.supply > supplyCap) {
        unfed++;
        continue;
      }
      supplyUsed += base.supply;
      units.push({
        kind: spec.kind,
        hp: Math.round(base.hp * (1 + hpPct / 100)),
        atk,
        range: base.range + m.unitRange[spec.kind],
        speed: base.speed,
        cooldown: base.cooldown,
        threat: base.threat,
      });
    }
  }
  return { units, supplyUsed, supplyCap, unfed };
}
