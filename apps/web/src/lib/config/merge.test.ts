import { describe, expect, test } from "bun:test";
import { deepMerge } from "./merge";

describe("deepMerge", () => {
  test("returns base when patch is undefined", () => {
    expect(deepMerge({ a: 1 }, undefined)).toEqual({ a: 1 });
  });

  test("overrides scalar values from the patch", () => {
    expect(deepMerge({ a: 1, b: 2 }, { a: 9 })).toEqual({ a: 9, b: 2 });
  });

  test("deep-merges nested objects", () => {
    const base = { server: { host: "h", port: 2242, extra: true } };
    const patch = { server: { host: "other" } };
    expect(deepMerge(base, patch)).toEqual({ server: { host: "other", port: 2242, extra: true } });
  });

  test("keeps the base key when the patch is missing it", () => {
    expect(deepMerge({ a: { x: 1 } }, {})).toEqual({ a: { x: 1 } });
  });

  test("does not merge over arrays", () => {
    expect(deepMerge({ list: [1, 2] }, { list: [3] })).toEqual({ list: [3] });
  });
});
