import { describe, expect, test } from "bun:test";
import { rangeSlice } from "./bulkSelection";
import { matchesFine } from "./useFinePointer";

const ids = ["a", "b", "c", "d", "e"];

describe("rangeSlice", () => {
  test("forward range is inclusive", () => {
    expect(rangeSlice(ids, "b", "d")).toEqual(["b", "c", "d"]);
  });

  test("reversed anchor/target normalizes", () => {
    expect(rangeSlice(ids, "d", "b")).toEqual(["b", "c", "d"]);
  });

  test("missing anchor falls back to single target", () => {
    expect(rangeSlice(ids, null, "c")).toEqual(["c"]);
    expect(rangeSlice(ids, "zzz", "c")).toEqual(["c"]);
  });

  test("target outside base falls back to single target", () => {
    expect(rangeSlice(ids, "b", "zzz")).toEqual(["zzz"]);
  });
});

describe("matchesFine", () => {
  test("null-safe, passes through matches", () => {
    expect(matchesFine({ matches: true })).toBe(true);
    expect(matchesFine({ matches: false })).toBe(false);
    expect(matchesFine(null)).toBe(false);
    expect(matchesFine(undefined)).toBe(false);
  });
});
