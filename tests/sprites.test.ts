import { describe, expect, it } from "vitest";
import { skillFor } from "../src/ui/sprites";

describe("sprite clip names", () => {
  it("match skills by name or id, including PixelLab's prompt-derived names", () => {
    expect(skillFor("heavy-strike")).toBe("heavyStrike");
    expect(skillFor("Shield Bash")).toBe("shieldBash");
    expect(skillFor("charge_knight_sprints_forward_with_sword")).toBe("charge");
    expect(skillFor("overhead_sword_slash_knight_raises")).toBeUndefined();
    expect(skillFor("Walk")).toBeUndefined();
  });
});
