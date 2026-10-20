import { describe, expect, it } from "vitest";
import { generateBoard, idx, income, place, placementError, buildWarband } from "../src/core/board";
import { baseModifiers } from "../src/core/data";
import { Battle } from "../src/core/combat";
import { botOpponent, buy, endBuild, newRun, placePending, resolveBattle, takeFate } from "../src/core/game";

function emptyBoard() {
  const b = generateBoard(1, 5);
  b.tiles.forEach((t) => {
    if (t.building !== "townhall") t.terrain = "plain";
  });
  return b;
}

describe("board", () => {
  it("puts the town hall in the centre", () => {
    const b = generateBoard(42);
    expect(b.tiles[idx(b, 3, 3)].building).toBe("townhall");
  });

  it("only allows building next to the settlement", () => {
    const b = emptyBoard();
    expect(placementError(b, idx(b, 0, 0), "farm")).toMatch(/settlement/);
    expect(placementError(b, idx(b, 2, 1), "farm")).toBeNull();
  });

  it("rewards adjacency: woodcutter next to forests", () => {
    const b = emptyBoard();
    b.tiles[idx(b, 1, 1)].terrain = "forest";
    b.tiles[idx(b, 3, 1)].terrain = "forest";
    const m = baseModifiers();
    const before = income(b, m).wood;
    place(b, idx(b, 2, 1), "woodcutter");
    expect(income(b, m).wood - before).toBe(1 + 2 * 2);
  });

  it("caps the warband by food and applies forge auras", () => {
    const b = emptyBoard();
    const m = baseModifiers();
    place(b, idx(b, 2, 1), "barracks");
    place(b, idx(b, 1, 1), "forge");
    const wb = buildWarband(b, m);
    // Town hall gives 3 food: both warriors fit.
    expect(wb.units).toHaveLength(2);
    expect(wb.units[0].atk).toBe(6 + 3);
    place(b, idx(b, 3, 2), "barracks");
    place(b, idx(b, 2, 3), "barracks");
    expect(buildWarband(b, m).unfed).toBe(3);
  });
});

describe("combat", () => {
  const warrior = { kind: "warrior" as const, hp: 30, atk: 6, range: 1, speed: 1.5, cooldown: 1, threat: 1 };

  it("is deterministic and the bigger army wins", () => {
    const a = new Battle([warrior, warrior, warrior], [warrior]);
    expect(a.runToEnd()).toBe("win");
    const b = new Battle([warrior, warrior, warrior], [warrior]);
    b.runToEnd();
    expect(b.time).toBe(a.time);
  });

  it("an empty side loses immediately", () => {
    expect(new Battle([], [warrior]).outcome).toBe("loss");
    expect(new Battle([], []).outcome).toBe("draw");
  });
});

describe("run", () => {
  it("plays a round end to end", () => {
    const s = newRun(7, "wolf");
    expect(s.round).toBe(1);
    const slot = s.shop.findIndex((id) => id === "barracks" || id === "farm" || id === "woodcutter");
    if (slot >= 0) {
      buy(s, slot);
      const tile = idx(s.board, 3, 2);
      if (placePending(s, tile)) placePending(s, idx(s.board, 2, 3));
    }
    endBuild(s);
    expect(s.phase).toBe("fate");
    takeFate(s, null);
    expect(s.phase).toBe("battle");
    expect(s.opponent?.name).toBe("Draugr raiders");
    resolveBattle(s, "loss", 3);
    expect(s.hp).toBe(40 - (1 + 1 + 3));
    expect(s.round).toBe(2);
  });

  it("bots grow stronger over rounds", () => {
    const early = botOpponent(3, 1).units.length;
    const late = botOpponent(3, 8).units.length;
    expect(late).toBeGreaterThan(early);
  });
});
