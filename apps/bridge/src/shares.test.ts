import { describe, expect, test } from "bun:test";
import { parseFolderContentsResponse, parseSharedFileListResponse, tryParseMessage, PEER_MESSAGE_CODES } from "./soulseek.ts";
import { PermissionLevel, ShareDB } from "./shares.ts";

function testDb(): ShareDB {
  const db = Object.create(ShareDB.prototype) as ShareDB;
  const publicFolders = [{ name: "Music", files: [{ name: "Music\\song.mp3", size: 42, ext: "mp3", attrs: [] }] }];
  const buddyFolders = [{ name: "Private", files: [{ name: "Private\\secret.mp3", size: 7, ext: "mp3", attrs: [] }] }];
  Object.assign(db as unknown as Record<string, unknown>, {
    publicFolders,
    buddyFolders,
    trustedFolders: [],
    revealBuddyShares: false,
    revealTrustedShares: false,
  });
  return db;
}

describe("ShareDB browse responses", () => {
  test("emits Nicotine+ share-list metadata and private block", () => {
    const parsedFrame = tryParseMessage(testDb().buildSharedFileListResponse(PermissionLevel.PUBLIC));
    expect(parsedFrame?.code).toBe(PEER_MESSAGE_CODES.sharedFileListResponse);
    const parsed = parseSharedFileListResponse(parsedFrame!.payload);
    expect(parsed.folders.map((folder) => folder.name)).toEqual(["Music"]);
  });

  test("reveals buddy shares when flag set", () => {
    const db = testDb();
    db.setRevealFlags(true, false);
    const parsedFrame = tryParseMessage(db.buildSharedFileListResponse(PermissionLevel.PUBLIC));
    const parsed = parseSharedFileListResponse(parsedFrame!.payload);
    expect(parsed.folders.map((folder) => folder.name)).toEqual(["Music", "Private"]);
  });

  test("returns no folders for banned permission", () => {
    const parsedFrame = tryParseMessage(testDb().buildSharedFileListResponse(PermissionLevel.BANNED));
    const parsed = parseSharedFileListResponse(parsedFrame!.payload);
    expect(parsed.folders).toHaveLength(0);
  });

  test("emits standard folder response wrapper", () => {
    const parsedFrame = tryParseMessage(testDb().buildFolderContentsResponse(3, "Music"));
    expect(parsedFrame?.code).toBe(PEER_MESSAGE_CODES.folderContentsResponse);
    expect(parseFolderContentsResponse(parsedFrame!.payload)).toEqual({
      token: 3,
      dir: "Music",
      folders: [{ name: "Music", files: [{ name: "song.mp3", size: 42, ext: "mp3", attrs: [] }] }],
      files: [{ name: "song.mp3", size: 42, ext: "mp3", attrs: [] }],
    });
  });

  test("browse wire files are basenames; folder join reconstructs full virtual path", () => {
    // nicotine-plus parity: shares.py packs basename, userbrowse.py joins
    // folder + "\\" + basename. Packing qualified names makes remotes request
    // doubled paths ("Music\\song" advertised as file of "Music" -> request
    // "Music\\Music\\song") that resolveSharedFile then denies.
    const db = testDb();
    const listFrame = tryParseMessage(db.buildSharedFileListResponse(PermissionLevel.PUBLIC));
    const list = parseSharedFileListResponse(listFrame!.payload);
    const music = list.folders.find((f) => f.name === "Music")!;
    expect(music.files.map((f) => f.name)).toEqual(["song.mp3"]);
    expect(`${music.name}\\${music.files[0].name}`).toBe("Music\\song.mp3");
  });
});
