import { describe, expect, test } from "bun:test";
import { sortSearchRows, type SearchSortMode } from "./sort";
import type { SearchRow } from "./protocol";

function row(over: Partial<SearchRow> & { user: string; filename: string }): SearchRow {
  return {
    folder: "", path: over.filename, size: 1, fileType: "mp3",
    slotFree: false, speed: 0, inQueue: 0, quality: 0, length: 0,
    private: false, attributes: {}, ...over,
  };
}

const rows = [
  row({ user: "slow-free", filename: "b.mp3", slotFree: true, speed: 100, inQueue: 0 }),
  row({ user: "fast-busy", filename: "a.mp3", slotFree: false, speed: 9999, inQueue: 5 }),
  row({ user: "fast-free", filename: "c.mp3", slotFree: true, speed: 5000, inQueue: 0 }),
  row({ user: "mid-queue", filename: "d.mp3", slotFree: false, speed: 5000, inQueue: 1 }),
];

describe("sortSearchRows", () => {
  test("best: free slots first, then fastest, then shortest queue", () => {
    expect(sortSearchRows(rows, "best").map((r) => r.user)).toEqual(
      ["fast-free", "slow-free", "fast-busy", "mid-queue"],
    );
  });

  test("speed: raw velocity wins over slots", () => {
    expect(sortSearchRows(rows, "speed").map((r) => r.user)[0]).toBe("fast-busy");
  });

  test("queue: free first, then shortest queue", () => {
    expect(sortSearchRows(rows, "queue").map((r) => r.user)).toEqual(
      ["fast-free", "slow-free", "mid-queue", "fast-busy"],
    );
  });

  test("arrival: preserves network order", () => {
    const mode: SearchSortMode = "arrival";
    expect(sortSearchRows(rows, mode).map((r) => r.user)).toEqual(
      rows.map((r) => r.user),
    );
  });
});
