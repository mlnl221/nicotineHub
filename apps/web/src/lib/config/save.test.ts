import { describe, expect, test } from "bun:test";
import { defaults } from "./defaults";
import { buildSectionMessages } from "./save";

function setProfilePic(pic: string): string | undefined {
  const s = { ...defaults, userinfo: { ...defaults.userinfo, pic } };
  const msgs = buildSectionMessages("userinfo", s);
  const set = msgs.find((m) => m.type === "userinfo") as unknown as {
    profile: { pic?: string };
  };
  return set.profile.pic;
}

describe("userinfo pic", () => {
  test("keeps JPEG data URL whose base64 starts with /9j/", () => {
    // ffd8ff JPEG magic base64-encodes to /9j/ — must not read as a path
    const b64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP/";
    expect(setProfilePic(`data:image/jpeg;base64,${b64}`)).toBe(b64);
  });

  test("keeps PNG data URL", () => {
    const b64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    expect(setProfilePic(`data:image/png;base64,${b64}`)).toBe(b64);
  });

  test("drops filesystem paths", () => {
    expect(setProfilePic("/path/to/image.jpg")).toBeUndefined();
    expect(setProfilePic("C:\\pics\\avatar.png")).toBeUndefined();
  });

  test("drops oversize payloads even from data URLs", () => {
    expect(setProfilePic(`data:image/jpeg;base64,${"A".repeat(5_000_001)}`)).toBeUndefined();
  });

  test("empty pic sends undefined", () => {
    expect(setProfilePic("")).toBeUndefined();
  });
});
