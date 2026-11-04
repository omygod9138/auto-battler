import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS helper shared with the review script
import { artHash, readRecord, spriteIds } from "../scripts/sprite-facing.mjs";

const HOW = "look at it with `node scripts/sprite-facing.mjs`, fix it if needed, then `node scripts/sprite-facing.mjs <id> right|front`";

describe("sprite facing", () => {
  const record = readRecord() as Record<string, { facing: string; hash: string }>;

  it.each(spriteIds() as string[])("%s is drawn facing right (or at the viewer) and was checked", (id) => {
    const entry = record[id];
    expect(entry, `${id} has never been checked: ${HOW}`).toBeDefined();
    expect(["right", "front"], `${id} is recorded as facing ${entry.facing}`).toContain(entry.facing);
    expect(entry.hash, `${id}'s art changed since it was checked: ${HOW}`).toBe(artHash(id));
  });

  it("has no records for sprites that no longer exist", () => {
    expect(Object.keys(record).filter((id) => !spriteIds().includes(id))).toEqual([]);
  });
});
