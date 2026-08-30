import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { listDirectory, normalizeRequestedPath, resolveSafePath } from "./files.ts";

function makeTmpDataDir(): string {
  const tmp = mkdtempSync(join(tmpdir(), "nicotine-files-test-"));
  // Ensure DATA_DIR points to tmp for these tests via override param
  return tmp;
}

describe("files — secure DATA_DIR browsing (Option A)", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = makeTmpDataDir();
    mkdirSync(join(tmp, "music", "deep"), { recursive: true });
    mkdirSync(join(tmp, "photos"), { recursive: true });
    writeFileSync(join(tmp, "file.txt"), "hello");
    writeFileSync(join(tmp, "music", "song.mp3"), "mp3");
    writeFileSync(join(tmp, "music", "deep", "track.flac"), "flac");
  });
  afterEach(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch {}
  });

  test("normalizeRequestedPath handles variants", () => {
    expect(normalizeRequestedPath(null)).toBe("/");
    expect(normalizeRequestedPath("")).toBe("/");
    expect(normalizeRequestedPath("/")).toBe("/");
    expect(normalizeRequestedPath("music")).toBe("/music");
    expect(normalizeRequestedPath("/music/")).toBe("/music");
    expect(normalizeRequestedPath("///music///deep//")).toBe("/music/deep");
  });

  test("resolveSafePath containment blocks traversal", async () => {
    await expect(resolveSafePath("/", tmp)).resolves.toBe(resolve(tmp));
    await expect(resolveSafePath("/music", tmp)).resolves.toBe(resolve(join(tmp, "music")));
    await expect(resolveSafePath("/music/../photos", tmp)).resolves.toBe(resolve(join(tmp, "photos")));
    await expect(resolveSafePath("../../etc", tmp)).rejects.toThrow(/traversal/);
    await expect(resolveSafePath("/..", tmp)).rejects.toThrow(/traversal/);
    await expect(resolveSafePath("/music/../../..", tmp)).rejects.toThrow(/traversal/);
    await expect(resolveSafePath("/music/../..", tmp)).rejects.toThrow(/traversal/);
  });

  test("listDirectory root sorted directories first", async () => {
    const res = await listDirectory("/", tmp);
    expect(res.path).toBe("/");
    expect(res.parent).toBe(null);
    expect(res.entries.length).toBeGreaterThanOrEqual(3);
    // directories first
    const types = res.entries.map((e) => e.type);
    // first two should be directories (music, photos) then file
    expect(types[0]).toBe("directory");
    expect(types[1]).toBe("directory");
    expect(res.entries.find((e) => e.name === "music")?.type).toBe("directory");
    expect(res.entries.find((e) => e.name === "photos")?.type).toBe("directory");
    expect(res.entries.find((e) => e.name === "file.txt")?.type).toBe("file");
    expect(res.entries.find((e) => e.name === "file.txt")?.path).toBe("/file.txt");
  });

  test("listDirectory subdirectory", async () => {
    const res = await listDirectory("/music", tmp);
    expect(res.path).toBe("/music");
    expect(res.parent).toBe("/");
    expect(res.entries.find((e) => e.name === "song.mp3")?.type).toBe("file");
    expect(res.entries.find((e) => e.name === "deep")?.type).toBe("directory");
    expect(res.entries.find((e) => e.name === "deep")?.path).toBe("/music/deep");
  });

  test("listDirectory deep subdirectory via browsing", async () => {
    const res = await listDirectory("/music/deep", tmp);
    expect(res.entries.length).toBe(1);
    expect(res.entries[0].name).toBe("track.flac");
    expect(res.entries[0].path).toBe("/music/deep/track.flac");
  });

  test("listDirectory rejects traversal", async () => {
    await expect(listDirectory("/../etc", tmp)).rejects.toThrow(/traversal|escapes/);
    await expect(listDirectory("../../", tmp)).rejects.toThrow(/traversal|escapes/);
  });

  test("listDirectory 404 on missing", async () => {
    await expect(listDirectory("/nonexistent", tmp)).rejects.toThrow(/Not found/);
    try {
      await listDirectory("/nonexistent", tmp);
    } catch (e) {
      expect((e as unknown as { status?: number }).status).toBe(404);
    }
  });

  test("listDirectory 400 on file path", async () => {
    await expect(listDirectory("/file.txt", tmp)).rejects.toThrow(/Not a directory/);
    try {
      await listDirectory("/file.txt", tmp);
    } catch (e) {
      expect((e as unknown as { status?: number }).status).toBe(400);
    }
  });

  test("symlink inside DATA_DIR is listed but traversal symlink blocked on navigate", async () => {
    // Create a symlink inside tmp that points inside
    const innerTarget = join(tmp, "photos");
    symlinkSync(innerTarget, join(tmp, "link_to_photos"));
    const root = await listDirectory("/", tmp);
    const link = root.entries.find((e) => e.name === "link_to_photos");
    expect(link).toBeDefined();
    expect(link?.type).toBe("symlink");
    // Create symlink pointing outside /tmp (e.g., /etc) — listing should still show, but navigating into it should be blocked
    // Use /tmp itself as outside? Use system /etc if exists, else use parent of tmp
    const outside = resolve(tmp, "..");
    const outsideLink = join(tmp, "link_outside");
    try { symlinkSync(outside, outsideLink); } catch {}
    const root2 = await listDirectory("/", tmp);
    const outLink = root2.entries.find((e) => e.name === "link_outside");
    if (outLink) {
      await expect(listDirectory("/link_outside", tmp)).rejects.toThrow(/escapes|traversal/);
    }
  });
});
