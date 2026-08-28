/**
 * ShareDB — peer shares DB, Phase 3.
 * In-memory, persisted under DATA_DIR/shares.json (or SHARES_DIR if set).
 * Handles SharedFileList 4/5 and FolderContents 36/37, respects ExcludedSearchPhrases.
 * Also handles inbound FileSearch (server 26) filtering.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { frameMessage, packString, packUint32, packUint64, PEER_MESSAGE_CODES } from "./soulseek.ts";

export interface ShareFile {
  name: string; // virtual path e.g. Music\Artist\file.mp3
  size: number | bigint;
  ext?: string;
  attrs?: Array<[number, number]>; // file attribute type/value pairs
}

export interface ShareFolder {
  name: string;
  files: ShareFile[];
}

function defaultDataDir(): string {
  return process.env.DATA_DIR || "/data";
}
function sharesPath(): string {
  const base = process.env.SHARES_DIR || process.env.DATA_DIR || "/data";
  try { mkdirSync(base, { recursive: true }); } catch {}
  return join(base, "shares.json");
}

export class ShareDB {
  private folders: ShareFolder[] = [];
  private excludedPhrases = new Set<string>();
  private allowedTokens = new Set<number>(); // gated responses — not used for shares but for search
  private dataDir: string;

  constructor(opts?: { dataDir?: string }) {
    this.dataDir = opts?.dataDir || defaultDataDir();
    this.load();
  }

  private load() {
    const p = sharesPath();
    if (!existsSync(p)) {
      // fallback DATA_DIR/shares.json
      const alt = join(this.dataDir, "shares.json");
      if (existsSync(alt)) {
        try {
          const raw = JSON.parse(readFileSync(alt, "utf8"));
          if (Array.isArray(raw.folders)) this.folders = raw.folders;
        } catch {}
      }
      return;
    }
    try {
      const raw = JSON.parse(readFileSync(p, "utf8"));
      if (Array.isArray(raw.folders)) this.folders = raw.folders;
      else if (Array.isArray(raw)) this.folders = raw;
    } catch {}
  }

  persist() {
    try {
      const p = sharesPath();
      mkdirSync(join(p, ".."), { recursive: true });
      writeFileSync(p, JSON.stringify({ folders: this.folders }, null, 2));
      // also mirror to DATA_DIR/shares.json
      const alt = join(this.dataDir, "shares.json");
      if (alt !== p) writeFileSync(alt, JSON.stringify({ folders: this.folders }, null, 2));
    } catch {}
  }

  setFolders(folders: ShareFolder[]) {
    this.folders = folders;
    this.persist();
    return this.folders;
  }

  getFolders(): ShareFolder[] { return this.folders; }

  setExcludedPhrases(phrases: string[]) {
    for (const ph of phrases) this.excludedPhrases.add(ph.toLowerCase());
  }

  /** Check if query contains excluded phrase */
  isExcluded(query: string): boolean {
    const lower = query.toLowerCase();
    for (const ph of this.excludedPhrases) if (lower.includes(ph)) return true;
    return false;
  }

  /** Search shares by query (space-separated tokens, case-insensitive, all must match) */
  search(query: string): ShareFile[] {
    if (this.isExcluded(query)) return [];
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return [];
    const out: ShareFile[] = [];
    for (const folder of this.folders) {
      for (const f of folder.files) {
        const nameLower = f.name.toLowerCase();
        if (tokens.every(t => nameLower.includes(t))) out.push(f);
      }
    }
    return out.sort((a,b)=> a.name.localeCompare(b.name));
  }

  /** Build SharedFileListResponse 5 payload (zlib lvl4, sorted) */
  buildSharedFileListResponse(): Buffer {
    // inner payload: uint32 ndirs, then for each dir: string name, uint32 nfiles, then files
    const parts: Buffer[] = [];
    parts.push(packUint32(this.folders.length));
    // sorted folders
    const sorted = [...this.folders].sort((a,b)=> a.name.localeCompare(b.name));
    for (const folder of sorted) {
      parts.push(packString(folder.name));
      parts.push(packUint32(folder.files.length));
      const filesSorted = [...folder.files].sort((a,b)=> a.name.localeCompare(b.name));
      for (const f of filesSorted) {
        parts.push(Buffer.from([1])); // code
        parts.push(packString(f.name));
        const sz = typeof f.size === "bigint" ? f.size : BigInt(f.size);
        parts.push(packUint64(sz));
        parts.push(packString(f.ext || "")); // legacy ext
        const attrs = f.attrs || [];
        parts.push(packUint32(attrs.length));
        for (const [type, val] of attrs) {
          parts.push(packUint32(type));
          parts.push(packUint32(val));
        }
      }
    }
    // Include unknown int 0 + priv? Nicotine adds private share count (0)
    // For simplicity inner includes only above; nicotine also expects private block later but we omit (0)
    // Append npriv 0 as uint32 for compatibility with FileSearch private parsing? For shares response nicotine does not add it.
    const inner = Buffer.concat(parts);
    const compressed = deflateSync(inner, { level: 4 });
    return frameMessage(PEER_MESSAGE_CODES.sharedFileListResponse, compressed);
  }

  /** Build FolderContentsResponse 37 */
  buildFolderContentsResponse(token: number, dir: string): Buffer {
    const folder = this.folders.find(f => f.name === dir);
    const files = folder ? [...folder.files].sort((a,b)=> a.name.localeCompare(b.name)) : [];
    const parts: Buffer[] = [];
    parts.push(packUint32(token >>> 0));
    parts.push(packString(dir));
    parts.push(packUint32(files.length));
    for (const f of files) {
      parts.push(Buffer.from([1]));
      parts.push(packString(f.name));
      const sz = typeof f.size === "bigint" ? f.size : BigInt(f.size);
      parts.push(packUint64(sz));
      parts.push(packString(f.ext || ""));
      const attrs = f.attrs || [];
      parts.push(packUint32(attrs.length));
      for (const [type,val] of attrs) {
        parts.push(packUint32(type));
        parts.push(packUint32(val));
      }
    }
    const inner = Buffer.concat(parts);
    const compressed = deflateSync(inner, { level: 4 });
    return frameMessage(PEER_MESSAGE_CODES.folderContentsResponse, compressed);
  }

  /** Build FileSearchResponse 9 for inbound FileSearch queries (if someone searches us) */
  buildFileSearchResponse(token: number, username: string, query: string, freeSlots = true, speed = 0, inQueue = 0): Buffer | null {
    if (this.isExcluded(query)) return null;
    const results = this.search(query);
    if (!results.length) return null;
    // Build result payload similar to parseFileSearchResponse expectation: zlib compressed
    const parts: Buffer[] = [];
    parts.push(packString(username));
    parts.push(packUint32(token >>> 0));
    parts.push(packUint32(results.length));
    for (const f of results) {
      parts.push(Buffer.from([1]));
      parts.push(packString(f.name));
      const sz = typeof f.size === "bigint" ? f.size : BigInt(f.size);
      parts.push(packUint64(sz));
      parts.push(packUint32(0)); // ext len 0 (legacy)
      const attrs = f.attrs || [];
      parts.push(packUint32(attrs.length));
      for (const [type,val] of attrs) {
        parts.push(packUint32(type));
        parts.push(packUint32(val));
      }
    }
    parts.push(Buffer.from([freeSlots ? 1 : 0]));
    parts.push(packUint32(speed));
    parts.push(packUint32(inQueue));
    // no private block
    const inner = Buffer.concat(parts);
    const compressed = deflateSync(inner);
    return frameMessage(PEER_MESSAGE_CODES.fileSearchResponse, compressed);
  }
}
