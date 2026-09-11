import { describe, expect, test } from "bun:test";
import { scopeRowVisible, wishlistDefaultOpen } from "./mobile-help";

describe("scopeRowVisible", () => {
  test("global hides scope row until expanded", () => {
    expect(scopeRowVisible("global", false)).toBe(false);
    expect(scopeRowVisible("global", true)).toBe(true);
  });

  test("non-global modes always visible (sole setMode path — no strand)", () => {
    for (const mode of ["user", "room", "wishlist", "buddies"]) {
      expect(scopeRowVisible(mode, false)).toBe(true);
      expect(scopeRowVisible(mode, true)).toBe(true);
    }
  });
});

describe("wishlistDefaultOpen", () => {
  test("mobile starts collapsed", () => {
    expect(wishlistDefaultOpen(390)).toBe(false);
  });

  test("desktop starts open, boundary 768 inclusive", () => {
    expect(wishlistDefaultOpen(1280)).toBe(true);
    expect(wishlistDefaultOpen(768)).toBe(true);
    expect(wishlistDefaultOpen(767)).toBe(false);
  });
});
