import { describe, expect, test } from "bun:test";
import { profilePicSrc } from "./profile-pic";

describe("profilePicSrc", () => {
  test("raw SVG markup sniffs svg mime", () => {
    expect(profilePicSrc("<svg xmlns='x'></svg>").startsWith("data:image/svg+xml;base64,")).toBe(true);
  });

  test("base64 SVG (PHN2) sniffs svg mime", () => {
    expect(profilePicSrc("PHN2ZyB4bWxucz0naCd+PC9zdmc+").startsWith("data:image/svg+xml;base64,")).toBe(true);
  });

  test("PNG base64 defaults to png mime", () => {
    expect(profilePicSrc("iVBORw0KGgoAAAANSUhEUg==").startsWith("data:image/png;base64,")).toBe(true);
  });

  test("leading whitespace ignored for sniffing", () => {
    expect(profilePicSrc("  <svg></svg>").startsWith("data:image/svg+xml;base64,")).toBe(true);
  });

  test("empty and non-string input yields empty string", () => {
    expect(profilePicSrc("")).toBe("");
    expect(profilePicSrc(undefined)).toBe("");
    expect(profilePicSrc(null)).toBe("");
    expect(profilePicSrc(42)).toBe("");
  });
});
