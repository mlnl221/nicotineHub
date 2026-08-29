// SPDX-FileCopyrightText: 2001-2026 Nicotine+ Contributors
// SPDX-FileCopyrightText: 2025-2026 nicotine-mobile Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Portions based on nicotine-plus pynicotine/shares.py

/**
 * ShareDB — peer shares DB, Phase 3.
 * In-memory, persisted under DATA_DIR/shares.json (or SHARES_DIR if set).
 * Handles SharedFileList 4/5 and FolderContents 36/37, respects ExcludedSearchPhrases.
 * Also handles inbound FileSearch (server 26) filtering.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, basename, relative, extname } from "node:path";
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
  private lastShareRequests = new Map<string, number>(); // flood protection 0.4s per nicotine shares.py:1342
  private static readonly SHARE_THROTTLE_MS = 400;
  private shareFilters: string[] = [".*", ".*\\", "@eaDir\\", "#recycle\\", "#snapshot\\", "desktop.ini", "Thumbs.db"];
  private fileFilterRegexes: RegExp[] = [];
  private folderFilterRegexes: RegExp[] = [];
  private fileMtimes = new Map<string, number>(); // realPath -> mtimeMs for incremental rescan (pynicotine shares.py:616)
  private watchers: Array<ReturnType<typeof import("node:fs").watch>> = [];

  constructor(opts?: { dataDir?: string; shareFilters?: string[] }) {
    this.dataDir = opts?.dataDir || defaultDataDir();
    if (opts?.shareFilters) this.setShareFilters(opts.shareFilters);
    else this.compileShareFilters();
    this.load();
    // Auto-scan if folders empty and shared dirs exist on FS
    if (this.folders.length === 0) {
      const auto = this.scanFsShares();
      if (auto.length > 0) {
        this.folders = auto;
        this.persist();
      }
    }
    // fs.watch incremental — debounce 2s, mirrors pynicotine Scanner rescanning
    try {
      const dirs = this.resolveSharedDirs();
      for (const d of dirs) {
        if (!existsSync(d)) continue;
        try {
          const { watch } = require("node:fs") as typeof import("node:fs");
          const w = watch(d, { recursive: true } as unknown as { recursive: boolean }, () => {
            const now = Date.now();
            const last = (this as unknown as { _watchDebounce?: number })._watchDebounce || 0;
            if (now - last < 2000) return;
            (this as unknown as { _watchDebounce: number })._watchDebounce = now;
            // incremental: only re-scan if >2s since last
            this.rescanAsync().catch(() => {});
          });
          this.watchers.push(w as unknown as ReturnType<typeof import("node:fs").watch>);
        } catch {}
      }
    } catch {}
  }

  private load() {
    const p = sharesPath();
    if (!existsSync(p)) {
      // fallback DATA_DIR/shares.json
      const alt = join(this.dataDir, "shares.json");
      if (existsSync(alt)) {
        try {
          const raw = JSON.parse(readFileSync(alt, "utf8"));
          if (Array.isArray(raw.folders)) {
            this.folders = raw.folders;
            if (Array.isArray(raw.shareFilters)) { this.shareFilters = raw.shareFilters; this.compileShareFilters(); }
          }
        } catch {}
      }
      return;
    }
    try {
      const raw = JSON.parse(readFileSync(p, "utf8"));
      if (Array.isArray(raw.folders)) {
        this.folders = raw.folders;
        if (Array.isArray(raw.shareFilters)) { this.shareFilters = raw.shareFilters; this.compileShareFilters(); }
      }
      else if (Array.isArray(raw)) this.folders = raw;
    } catch {}
  }

  persist() {
    try {
      const p = sharesPath();
      mkdirSync(join(p, ".."), { recursive: true });
      writeFileSync(p, JSON.stringify({ folders: this.folders, shareFilters: this.shareFilters }, null, 2));
      // also mirror to DATA_DIR/shares.json
      const alt = join(this.dataDir, "shares.json");
      if (alt !== p) writeFileSync(alt, JSON.stringify({ folders: this.folders, shareFilters: this.shareFilters }, null, 2));
    } catch {}
  }

  setShareFilters(filters: string[]) {
    this.shareFilters = filters.slice();
    this.compileShareFilters();
    this.persist();
  }

  getShareFilters(): string[] { return [...this.shareFilters]; }

  private compileShareFilters() {
    this.fileFilterRegexes = [];
    this.folderFilterRegexes = [];
    for (const pat of this.shareFilters) {
      if (!pat) continue;
      // Trailing \ indicates folder filter (nicotine shares.py: share_filters with trailing \)
      const isFolder = pat.endsWith("\\");
      try {
        const regex = new RegExp(pat, "i");
        if (isFolder) this.folderFilterRegexes.push(regex);
        else this.fileFilterRegexes.push(regex);
      } catch {
        // invalid regex — skip (nicotine validates via new RegExp("(" + pattern + ")")
        try {
          const regex = new RegExp(`(${pat})`, "i");
          if (isFolder) this.folderFilterRegexes.push(regex);
          else this.fileFilterRegexes.push(regex);
        } catch {}
      }
    }
  }

  isFileFiltered(fileName: string): boolean {
    for (const re of this.fileFilterRegexes) if (re.test(fileName)) return true;
    return false;
  }

  isFolderFiltered(folderName: string): boolean {
    // folder filters tested against virtual path + real folder name
    for (const re of this.folderFilterRegexes) if (re.test(folderName)) return true;
    return false;
  }

  setFolders(folders: ShareFolder[]) {
    this.folders = folders;
    this.persist();
    return this.folders;
  }

  getFolders(): ShareFolder[] { return this.folders; }

  getSharedCounts(): { dirs: number; files: number } {
    let files = 0;
    for (const f of this.folders) files += f.files.length;
    return { dirs: this.folders.length, files };
  }

  /** Flood protection: 0.4s per user — mirrors nicotine shares.py:_requested_share_times */
  shouldThrottle(username: string): boolean {
    const now = Date.now();
    const last = this.lastShareRequests.get(username) || 0;
    if (now - last < ShareDB.SHARE_THROTTLE_MS) return true;
    this.lastShareRequests.set(username, now);
    return false;
  }

  /** FS scanner — walks real dirs under SHARED_DIRS or DATA_DIR/shared (incremental via mtime like pynicotine) */
  scanFsShares(sharedDirs?: string[]): ShareFolder[] {
    const dirs = sharedDirs || this.resolveSharedDirs();
    const folders: ShareFolder[] = [];
    // build prev map realPath -> ShareFile for mtime reuse (shares.py:616)
    const prevByName = new Map<string, ShareFile>();
    for (const fo of this.folders) for (const f of fo.files) prevByName.set(f.name, f);
    // also build reverse virtual -> real via walk prefix later; for now keep prev mtimes
    for (const realDir of dirs) {
      if (!existsSync(realDir)) continue;
      try {
        const virtualBase = basename(realDir);
        this.walkDir(realDir, virtualBase, folders, prevByName);
      } catch {}
    }
    return folders;
  }

  private resolveSharedDirs(): string[] {
    // Env SHARED_DIRS=" /data/shared:/data/music" or SHARES_DIR
    const env = process.env.SHARED_DIRS || process.env.SHARES_DIR || "";
    if (env) return env.split(":").map(s => s.trim()).filter(Boolean);
    const candidates = [join(this.dataDir, "shared"), join(this.dataDir, "shares"), "/data/shared"];
    return candidates.filter(p => existsSync(p));
  }

  private walkDir(realPath: string, virtualPath: string, out: ShareFolder[], prevByName?: Map<string, ShareFile>) {
    let entries: string[];
    try { entries = readdirSync(realPath); } catch { return; }
    // Check folder filter against virtual path (with trailing \)
    const folderTest = `${virtualPath}\\`;
    if (this.isFolderFiltered(folderTest) || this.isFolderFiltered(virtualPath)) return;
    const files: ShareFile[] = [];
    for (const ent of entries) {
      const full = join(realPath, ent);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        const subVirtual = `${virtualPath}\\${ent}`;
        if (this.isFolderFiltered(`${subVirtual}\\`) || this.isFolderFiltered(subVirtual)) continue;
        this.walkDir(full, subVirtual, out, prevByName);
      } else if (st.isFile()) {
        if (this.isFileFiltered(ent) || this.isFileFiltered(`${virtualPath}\\${ent}`)) continue;
        // Skip hidden files on Win32 hidden attr — plain dotfile check for unix
        if (ent.startsWith(".")) {
          // honour share filter ".*": already matches dotfiles via regex; if not filtered, still skip hidden if share_filters contains ".*"
          // we already filtered via regex, so keep dotfiles unless explicitly filtered
        }
        const ext = extname(ent).slice(1).toLowerCase();
        const vName = `${virtualPath}\\${ent}`;
        const mtime = st.mtimeMs;
        const prevMtime = this.fileMtimes.get(full);
        // pynicotine: if mtime == old_mtimes.get(path) and path in old_files → reuse, skip TinyTag parse
        if (prevMtime !== undefined && prevMtime === mtime && prevByName?.has(vName)) {
          const prev = prevByName.get(vName)!;
          files.push({ ...prev, size: st.size }); // keep attrs, update size if changed
          continue;
        }
        this.fileMtimes.set(full, mtime);
        const attrs = this.buildAttrs(full, ext, st.size);
        files.push({ name: vName, size: st.size, ext, attrs });
      }
    }
    if (files.length) out.push({ name: virtualPath, files: files.sort((a,b)=> a.name.localeCompare(b.name)) });
  }

  private buildAttrs(full: string, ext: string, _size: number): Array<[number, number]> {
    // Nicotine uses TinyTag for bitrate/length/sampleRate/bitDepth (slskmessages.py FileAttribute 0/1/2/4/5)
    // Bridge tries music-metadata sync fallback; async rescan uses full parsing
    // Keep sync fast — return empty here, async path fills via scanFsSharesAsync
    if (["mp3","flac","ogg","m4a","wav","wma","aac","opus","aiff"].includes(ext)) {
      try {
        // Try quick header parse without async: attempt to read bitrate from file if tiny
        // Fallback empty — async scanner will enrich via music-metadata
        void full;
      } catch {}
      return [];
    }
    return [];
  }

  /** Async FS scanner with music-metadata enrichment (TinyTag parity) */
  async scanFsSharesAsync(sharedDirs?: string[]): Promise<ShareFolder[]> {
    const dirs = sharedDirs || this.resolveSharedDirs();
    const folders: ShareFolder[] = [];
    for (const realDir of dirs) {
      if (!existsSync(realDir)) continue;
      try {
        const virtualBase = basename(realDir);
        await this.walkDirAsync(realDir, virtualBase, folders);
      } catch {}
    }
    return folders;
  }

  private async walkDirAsync(realPath: string, virtualPath: string, out: ShareFolder[]) {
    let entries: string[];
    try { entries = readdirSync(realPath); } catch { return; }
    const folderTest = `${virtualPath}\\`;
    if (this.isFolderFiltered(folderTest) || this.isFolderFiltered(virtualPath)) return;
    // prev map for async reuse
    const prevByName = new Map<string, ShareFile>();
    for (const fo of this.folders) for (const f of fo.files) prevByName.set(f.name, f);
    const files: ShareFile[] = [];
    for (const ent of entries) {
      const full = join(realPath, ent);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        const subVirtual = `${virtualPath}\\${ent}`;
        if (this.isFolderFiltered(`${subVirtual}\\`) || this.isFolderFiltered(subVirtual)) continue;
        await this.walkDirAsync(full, subVirtual, out);
      } else if (st.isFile()) {
        if (this.isFileFiltered(ent) || this.isFileFiltered(`${virtualPath}\\${ent}`)) continue;
        const ext = extname(ent).slice(1).toLowerCase();
        const vName = `${virtualPath}\\${ent}`;
        const mtime = st.mtimeMs;
        const prevMtime = this.fileMtimes.get(full);
        if (prevMtime !== undefined && prevMtime === mtime && prevByName.has(vName)) {
          const prev = prevByName.get(vName)!;
          files.push({ ...prev, size: st.size });
          continue;
        }
        this.fileMtimes.set(full, mtime);
        const attrs = await this.buildAttrsAsync(full, ext);
        files.push({ name: vName, size: st.size, ext, attrs });
      }
    }
    if (files.length) out.push({ name: virtualPath, files: files.sort((a,b)=> a.name.localeCompare(b.name)) });
  }

  private async buildAttrsAsync(full: string, ext: string): Promise<Array<[number, number]>> {
    if (!["mp3","flac","ogg","m4a","wav","wma","aac","opus","aiff","wv"].includes(ext)) return [];
    try {
      const { parseFile } = await import("music-metadata");
      const meta = await parseFile(full, { duration: true });
      const attrs: Array<[number, number]> = [];
      const bitrate = meta.format.bitrate ? Math.round(meta.format.bitrate / 1000) : undefined;
      const duration = meta.format.duration ? Math.round(meta.format.duration) : undefined;
      const sampleRate = meta.format.sampleRate;
      const bitsPerSample = (meta.format as unknown as { bitsPerSample?: number }).bitsPerSample;
      if (bitrate) attrs.push([0, bitrate]);
      if (duration) attrs.push([1, duration]);
      // VBR detection via codec profile — stub 0 for now
      if (sampleRate) attrs.push([4, sampleRate]);
      if (bitsPerSample) attrs.push([5, bitsPerSample]);
      return attrs;
    } catch {
      return [];
    }
  }

  async rescanAsync(): Promise<ShareFolder[]> {
    const scanned = await this.scanFsSharesAsync();
    if (scanned.length > 0) {
      this.folders = scanned;
      this.persist();
    }
    return this.folders;
  }

  /** Rescan and persist — called on startup or via WS rescan request */
  rescan(): ShareFolder[] {
    const scanned = this.scanFsShares();
    if (scanned.length > 0) {
      this.folders = scanned;
      this.persist();
    }
    return this.folders;
  }

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
