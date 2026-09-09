import { describe, expect, test } from "bun:test";
import { defaults } from "./defaults";
import { emptyFilters } from "../protocol";
import { migratePublicOnlyDefault } from "./provider";

describe("public files only default", () => {
  test("settings default is public-only", () => {
    expect(defaults.searches.defilter.publicFiles).toBe(true);
  });

  test("empty filters are public-only (Clear keeps hiding private)", () => {
    expect(emptyFilters().publicOnly).toBe(true);
  });

  test("migration flips stored false once, then respects opt-out", () => {
    const stored = { searches: { defilter: { publicFiles: false } } };
    const migrated = migratePublicOnlyDefault(stored, false);
    expect(migrated.searches?.defilter?.publicFiles).toBe(true);
    // User opts back out after migration — marker set, stays false.
    const optedOut = { searches: { defilter: { publicFiles: false } } };
    expect(migratePublicOnlyDefault(optedOut, true).searches?.defilter?.publicFiles).toBe(false);
  });
});
