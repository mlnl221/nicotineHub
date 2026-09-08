import { describe, test, expect } from "bun:test";
import { parseWishlistInterval, packUint32 } from "./soulseek.ts";
import { buildWishlistSearchId, parseWishlistSearchId, getAutoTerms } from "./session.ts";

describe("wishlist P0-P1", () => {
  test("parseWishlistInterval reads uint32", () => {
    expect(parseWishlistInterval(packUint32(720))).toBe(720);
    expect(parseWishlistInterval(packUint32(120))).toBe(120);
  });

  test("auto searchId timestamp-first, colons in term survive", () => {
    const id = buildWishlistSearchId("a:b:c", 1234567890);
    expect(id).toBe("wishlist:1234567890:a:b:c");
    expect(parseWishlistSearchId(id)).toEqual({ timestamp: 1234567890, term: "a:b:c" });
  });

  test("legacy searchId still parses", () => {
    expect(parseWishlistSearchId("wishlist:my term:987654321")).toEqual({
      timestamp: 987654321,
      term: "my term",
    });
    expect(parseWishlistSearchId("nope")).toBeNull();
  });

  test("auto-skip: only auto terms round-robin", () => {
    const terms = ["a", "b", "c"];
    const auto = new Map([["a", true], ["b", false], ["c", true]]);
    expect(getAutoTerms(terms, auto)).toEqual(["a", "c"]);
    expect(getAutoTerms(terms, new Map([["a", false], ["b", false], ["c", false]]))).toEqual([]);
    expect(getAutoTerms(terms)).toEqual(terms);
  });
});
