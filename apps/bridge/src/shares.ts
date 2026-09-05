// SPDX-FileCopyrightText: 2001-2026 Nicotine+ Contributors
// SPDX-FileCopyrightText: 2025-2026 Nicotine Hub Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Portions based on nicotine-plus pynicotine/shares.py

/**
 * ShareDB — peer shares DB, Phase 3.
 * In-memory, persisted under CONFIG_DIR/shares.json ().
 * Handles SharedFileList 4/5 and FolderContents 36/37, respects ExcludedSearchPhrases.
 * Also handles inbound FileSearch (server 26) filtering.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, basename, relative, extname, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { frameMessage, packString, packUint32, packUint64, PEER_MESSAGE_CODES, sanitizeSearchTerm } from "./soulseek.ts";

export interface ShareFile {
  name: string; // virtual path e.g. Music\Artist\file.mp3
  size: number | bigint;
  ext?: string;
  attrs?: Array<[number, number]>; // file attribute type/value pairs
}

export interface ShareFolder {
  name: string;
  files: ShareFile[];
  level?: PermissionLevel;
}

export enum PermissionLevel {
  PUBLIC = "public",
  BUDDY = "buddy",
  TRUSTED = "trusted",
  BANNED = "banned",
}

function defaultDataDir(): string {
  return process.env.DATA_DIR || "/data";
}
function defaultConfigDir(): string {
  return process.env.CONFIG_DIR || "/config";
}
function sharesPath(): string {
  const base = process.env.CONFIG_DIR || "/config";
  try { mkdirSync(base, { recursive: true }); } catch {}
  return join(base, "shares.json");
}

export class ShareDB {
  private folders: ShareFolder[] = []; // combined view (legacy + privacy-filtered)
  private publicFolders: ShareFolder[] = [];
  private buddyFolders: ShareFolder[] = [];
  private trustedFolders: ShareFolder[] = [];
  private excludedPhrases = new Set<string>();
  private allowedTokens = new Set<number>(); // gated responses — not used for shares but for search
  private dataDir: string;
  private lastShareRequests = new Map<string, number>(); // flood protection 0.4s per nicotine shares.py:1342
  private static readonly SHARE_THROTTLE_MS = 400;
  private shareFilters: string[] = [".*", ".*\\", "@eaDir\\", "#recycle\\", "#snapshot\\", "desktop.ini", "Thumbs.db"];
  private fileFilterRegexes: RegExp[] = [];
  private folderFilterRegexes: RegExp[] = [];
  private exclusions: string[] = [];
  private exclusionFileRegexes: RegExp[] = [];
  private exclusionFolderRegexes: RegExp[] = [];
  private fileMtimes = new Map<string, number>(); // realPath -> mtimeMs for incremental rescan (pynicotine shares.py:616)
  private watchers: Array<ReturnType<typeof import("node:fs").watch>> = [];
  private virtual2real = new Map<string, string>();
  private real2virtual = new Map<string, string>();
  private revealBuddyShares = false;
  private revealTrustedShares = false;
  private wordIndex = new Map<string, Set<ShareFile>>(); // word -> files containing word (lower, punctuation-split)
  private customRootsByLevel = new Map<PermissionLevel, [string, string][]>();

  constructor(opts?: { dataDir?: string; shareFilters?: string[]; exclusions?: string[] }) {
    this.dataDir = opts?.dataDir || defaultDataDir();
    if (opts?.shareFilters) this.setShareFilters(opts.shareFilters);
    else this.compileShareFilters();
    if (opts?.exclusions) this.setExclusions(opts.exclusions);
    else this.compileExclusions();
    this.load();
    // Auto-scan if folders empty and shared dirs exist on FS
    if (this.folders.length === 0 && this.publicFolders.length === 0) {
      const auto = this.scanFsShares();
      if (auto.length > 0) {
        this.publicFolders = auto;
        this.rebuildCombined();
        this.persist();
      }
    } else {
      this.rebuildCombined();
    }
    // Bridge is SLSK-only: local share attrs stay [] (peer attrs are authoritative).
    // Worker owns audio analysis (mutagen/TinyTag parity) via POST /analyze if needed.
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

  private loadCustomRoots(raw: Record<string, unknown>) {
    const cr = raw.customRoots as Record<string, [string, string][]> | undefined;
    if (cr && typeof cr === "object") {
      for (const [k, v] of Object.entries(cr)) {
        const lvl = k === "buddy" ? PermissionLevel.BUDDY : k === "trusted" ? PermissionLevel.TRUSTED : PermissionLevel.PUBLIC;
        if (Array.isArray(v)) this.customRootsByLevel.set(lvl, v.filter((x) => Array.isArray(x) && x.length === 2) as [string, string][]);
      }
    }
    const legacy = raw.customRootsByLevel as unknown;
    if (Array.isArray(legacy)) {
      for (const [k, v] of legacy as [string, [string, string][]][]) {
        const lvl = k === "buddy" ? PermissionLevel.BUDDY : k === "trusted" ? PermissionLevel.TRUSTED : PermissionLevel.PUBLIC;
        if (Array.isArray(v)) this.customRootsByLevel.set(lvl, v);
      }
    }
  }

  private load() {
    const p = sharesPath();
    if (!existsSync(p)) {
      return;
    }
    try {
      const raw = JSON.parse(readFileSync(p, "utf8"));
      if (Array.isArray(raw.folders)) {
        this.folders = raw.folders;
        if (Array.isArray(raw.publicFolders)) this.publicFolders = raw.publicFolders;
        else this.publicFolders = raw.folders;
        if (Array.isArray(raw.buddyFolders)) this.buddyFolders = raw.buddyFolders;
        if (Array.isArray(raw.trustedFolders)) this.trustedFolders = raw.trustedFolders;
        if (typeof raw.revealBuddyShares === "boolean") this.revealBuddyShares = raw.revealBuddyShares;
        if (typeof raw.revealTrustedShares === "boolean") this.revealTrustedShares = raw.revealTrustedShares;
        if (Array.isArray(raw.shareFilters)) { this.shareFilters = raw.shareFilters; this.compileShareFilters(); }
        if (Array.isArray(raw.exclusions)) { this.exclusions = raw.exclusions; this.compileExclusions(); }
        this.loadCustomRoots(raw);
      }
      else if (Array.isArray(raw)) this.folders = raw;
      else {
        if (Array.isArray(raw.publicFolders)) this.publicFolders = raw.publicFolders;
        if (Array.isArray(raw.buddyFolders)) this.buddyFolders = raw.buddyFolders;
        if (Array.isArray(raw.trustedFolders)) this.trustedFolders = raw.trustedFolders;
        if (Array.isArray(raw.shareFilters)) { this.shareFilters = raw.shareFilters; this.compileShareFilters(); }
        if (Array.isArray(raw.exclusions)) { this.exclusions = raw.exclusions; this.compileExclusions(); }
        this.loadCustomRoots(raw);
      }
    } catch {}
  }

  private rebuildCombined() {
    this.folders = [...this.publicFolders, ...this.buddyFolders, ...this.trustedFolders];
    this.rebuildVirtualMaps();
    this.rebuildWordIndex();
  }
  private rebuildVirtualMaps() {
    this.virtual2real.clear();
    this.real2virtual.clear();
    // Rebuild from current folders by scanning SHARED_DIRS mapping? Best-effort: derive virtual->real via walkDir already populates during scan.
    // For persisted loads, we lack real paths — virtual2real will be rebuilt on next scanFsShares (which walks FS and knows realPath).
  }

  private serializeCustomRoots(): Record<string, [string, string][]> {
    const out: Record<string, [string, string][]> = {};
    for (const [lvl, roots] of this.customRootsByLevel) out[lvl] = roots.slice();
    return out;
  }

  persist() {
    try {
      const p = sharesPath();
      mkdirSync(join(p, ".."), { recursive: true });
      const payload = { folders: this.folders, publicFolders: this.publicFolders, buddyFolders: this.buddyFolders, trustedFolders: this.trustedFolders, shareFilters: this.shareFilters, exclusions: this.exclusions, revealBuddyShares: this.revealBuddyShares, revealTrustedShares: this.revealTrustedShares, customRoots: this.serializeCustomRoots() };
      writeFileSync(p, JSON.stringify(payload, null, 2));
      // strict: no mirror to DATA_DIR
    } catch {}
  }

  setShareFilters(filters: string[]) {
    this.shareFilters = filters.slice();
    this.compileShareFilters();
    this.persist();
  }

  getShareFilters(): string[] { return [...this.shareFilters]; }

  setExclusions(patterns: string[]) {
    this.exclusions = patterns.slice();
    this.compileExclusions();
    this.persist();
  }

  getExclusions(): string[] { return [...this.exclusions]; }

  private compileExclusions() {
    const fileFilters: string[] = [];
    const folderFilters: string[] = [];
    for (const pat of [...this.exclusions].sort()) {
      if (!pat) continue;
      const escaped = pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*");
      if (escaped.endsWith("\\\\") || escaped.endsWith("\\\\.*")) {
        folderFilters.push(escaped);
      } else {
        fileFilters.push(escaped);
      }
    }
    this.exclusionFileRegexes = [];
    this.exclusionFolderRegexes = [];
    if (fileFilters.length) {
      try {
        this.exclusionFileRegexes = [new RegExp("(\\\\(" + fileFilters.join("|") + ")$)", "i")];
      } catch {}
    }
    if (folderFilters.length) {
      try {
        this.exclusionFolderRegexes = [new RegExp("(\\\\(" + folderFilters.join("|") + ")$)", "i")];
      } catch {}
    }
  }

  isFileExcludedByExclusions(fileName: string): boolean {
    if (this.exclusionFileRegexes.length === 0) return false;
    const test = "\\" + fileName;
    for (const re of this.exclusionFileRegexes) if (re.test(test)) return true;
    return false;
  }

  isFolderExcludedByExclusions(folderName: string): boolean {
    if (this.exclusionFolderRegexes.length === 0) return false;
    let t = folderName;
    if (!t.endsWith("\\")) t += "\\";
    if (!t.startsWith("\\")) t = "\\" + t;
    for (const re of this.exclusionFolderRegexes) if (re.test(t)) return true;
    return false;
  }

  // Secret heuristic — files that look like leaked secrets (banner, not filter)
  isSecretFile(virtualPath: string): boolean {
    const base = virtualPath.split("\\").pop()?.toLowerCase() ?? "";
    if (!base) return false;
    if (base === ".env" || base.startsWith(".env.")) return true;
    if (base === "id_rsa" || base === "id_ed25519") return true;
    if (base.endsWith(".pem")) return true;
    if (base.endsWith(".key")) return true;
    if (base === "credentials.json") return true;
    if (base.startsWith("wallet") && base !== "wallet.jpg" && base !== "wallet.png") return true;
    // .git dir itself is secret if ever exposed as folder entry
    if (base === ".git") return true;
    return false;
  }

  private collectSecretHits(folders: ShareFolder[], limit = 20): string[] {
    const hits: string[] = [];
    for (const f of folders) {
      if (f.name.toLowerCase().includes(".git")) {
        if (hits.length < limit) hits.push(f.name + "\\ (.git folder)");
        if (hits.length >= limit) break;
      }
      for (const file of f.files) {
        if (this.isSecretFile(file.name)) {
          if (hits.length < limit) hits.push(file.name);
          if (hits.length >= limit) break;
        }
        // also flag files inside .git virtual path
        if (file.name.toLowerCase().includes("\\.git\\")) {
          if (hits.length < limit && !hits.includes(file.name)) hits.push(file.name);
          if (hits.length >= limit) break;
        }
      }
      if (hits.length >= limit) break;
    }
    return hits;
  }

  getSecretHits(limit = 20): string[] {
    return this.collectSecretHits(this.folders, limit);
  }

  /** Throwaway preview — dry-run scan with overridden exclusions without mutating live state. */
  async previewWithExclusions(exclusionsOverride?: string[]): Promise<{ counts: { dirs: number; files: number }; sample: string[]; excludedCount: number; secretHits: string[] }> {
    const makeTmp = (excls: string[]) => {
      const tmp = new ShareDB({ dataDir: this.dataDir });
      // override filters without persisting (avoid tmp persist side-effect)
      // @ts-expect-error private
      tmp.shareFilters = [...this.shareFilters];
      // @ts-expect-error private
      tmp.compileShareFilters();
      // suppress auto-scan side effects: clear folders populated by ctor if any, then set desired exclusions
      tmp.publicFolders = [];
      tmp.buddyFolders = [];
      tmp.trustedFolders = [];
      // @ts-expect-error private
      tmp.folders = [];
      tmp.exclusions = excls.slice();
      // @ts-expect-error private
      tmp.compileExclusions();
      // copy custom roots
      // @ts-expect-error private
      tmp.customRootsByLevel = new Map(this.customRootsByLevel);
      // clear maps to isolate
      // @ts-expect-error private
      tmp.virtual2real = new Map();
      // @ts-expect-error private
      tmp.real2virtual = new Map();
      // @ts-expect-error private
      tmp.fileMtimes = new Map();
      return tmp;
    };

    const excl = exclusionsOverride !== undefined ? exclusionsOverride : this.exclusions;
    const tmpA = makeTmp(excl);
    const scanA = async (db: ShareDB): Promise<ShareFolder[]> => {
      const folders: ShareFolder[] = [];
      // @ts-expect-error private
      const rootsMap: Map<PermissionLevel, [string,string][]> = db.customRootsByLevel;
      if (rootsMap.size > 0) {
        for (const lvl of [PermissionLevel.PUBLIC, PermissionLevel.BUDDY, PermissionLevel.TRUSTED] as const) {
          const roots = rootsMap.get(lvl);
          if (!roots) continue;
          const rescanned = await db.scanCustomRootsAsync(roots);
          folders.push(...rescanned);
        }
        const publicRoots = rootsMap.get(PermissionLevel.PUBLIC);
        if (!publicRoots || publicRoots.length === 0) {
          const scanned = await db.scanFsSharesAsync();
          folders.push(...scanned);
        }
      } else {
        const scanned = await db.scanFsSharesAsync();
        folders.push(...scanned);
      }
      return folders;
    };

    const foldersA = await scanA(tmpA);
    let excludedCount = 0;
    let excludedSample: string[] = [];
    // compute excluded diff vs no-exclusions baseline if exclusions non-empty
    if (excl.length > 0) {
      const tmpB = makeTmp([]);
      const foldersB = await scanA(tmpB);
      const setA = new Set(foldersA.flatMap(f => f.files.map(fi => fi.name)));
      const missing: string[] = [];
      let totalB = 0;
      for (const f of foldersB) {
        totalB += f.files.length;
        for (const fi of f.files) if (!setA.has(fi.name)) missing.push(fi.name);
      }
      const totalA = foldersA.reduce((s, f) => s + f.files.length, 0);
      excludedCount = Math.max(0, totalB - totalA);
      excludedSample = missing.slice(0, 20);
      // prefer showing excluded sample if caller wants? we return shared sample as primary, but keep missing for debug if needed
      // For now primary sample is shared files; excludedCount is count, sample remains shared
    }

    const counts = { dirs: foldersA.length, files: foldersA.reduce((s, f) => s + f.files.length, 0) };
    const allFilesA = foldersA.flatMap(f => f.files.map(fi => fi.name));
    const sample = allFilesA.slice(0, 20);
    const secretHits = this.collectSecretHits(foldersA, 20);
    // if we have excludedSample and no shared sample, include hint? but spec wants exposed top 20
    return { counts, sample, excludedCount, secretHits };
  }

  private compileShareFilters() {
    // Mirrors pynicotine/shares.py Scanner.load_filters:
    // escaped = re.escape(sfilter).replace("\\*", ".*")
    // folder if escaped endswith ("\\", "\\.*") else file
    // regex = re.compile("(\\\\(" + "|".join(filters) + ")$)", re.I)
    const fileFilters: string[] = [];
    const folderFilters: string[] = [];
    for (const pat of [...this.shareFilters].sort()) {
      if (!pat) continue;
      const escaped = pat.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*");
      if (escaped.endsWith("\\\\") || escaped.endsWith("\\\\.*")) {
        folderFilters.push(escaped);
      } else {
        fileFilters.push(escaped);
      }
    }
    this.fileFilterRegexes = [];
    this.folderFilterRegexes = [];
    if (fileFilters.length) {
      try {
        this.fileFilterRegexes = [new RegExp("(\\\\(" + fileFilters.join("|") + ")$)", "i")];
      } catch {}
    }
    if (folderFilters.length) {
      try {
        this.folderFilterRegexes = [new RegExp("(\\\\(" + folderFilters.join("|") + ")$)", "i")];
      } catch {}
    }
  }

  isFileFiltered(fileName: string): boolean {
    if (this.fileFilterRegexes.length === 0) return false;
    const test = "\\" + fileName;
    for (const re of this.fileFilterRegexes) if (re.test(test)) return true;
    return false;
  }

  isFolderFiltered(folderName: string): boolean {
    if (this.folderFilterRegexes.length === 0) return false;
    let t = folderName;
    if (!t.endsWith("\\")) t += "\\";
    if (!t.startsWith("\\")) t = "\\" + t;
    for (const re of this.folderFilterRegexes) if (re.test(t)) return true;
    return false;
  }

  setFolders(folders: ShareFolder[], level: PermissionLevel = PermissionLevel.PUBLIC) {
    if (level === PermissionLevel.BUDDY) this.buddyFolders = folders;
    else if (level === PermissionLevel.TRUSTED) this.trustedFolders = folders;
    else this.publicFolders = folders;
    this.rebuildCombined();
    this.persist();
    return folders;
  }

  getFolders(level?: PermissionLevel): ShareFolder[] {
    if (level === PermissionLevel.PUBLIC) return [...this.publicFolders];
    if (level === PermissionLevel.BUDDY) return [...this.buddyFolders];
    if (level === PermissionLevel.TRUSTED) return [...this.trustedFolders];
    return [...this.folders];
  }
  getFoldersForPermission(permission: PermissionLevel): ShareFolder[] {
    // Mirrors shares.py create_compressed_shares_message reveal logic
    if (permission === PermissionLevel.BANNED) return [];
    if (permission === PermissionLevel.PUBLIC) {
      const base = [...this.publicFolders];
      if (this.revealBuddyShares) base.push(...this.buddyFolders);
      if (this.revealTrustedShares) base.push(...this.trustedFolders);
      return base;
    }
    if (permission === PermissionLevel.BUDDY) {
      const base = [...this.publicFolders, ...this.buddyFolders];
      if (this.revealTrustedShares) base.push(...this.trustedFolders);
      return base;
    }
    // TRUSTED
    return [...this.publicFolders, ...this.buddyFolders, ...this.trustedFolders];
  }
  setRevealFlags(revealBuddy: boolean, revealTrusted: boolean) {
    this.revealBuddyShares = !!revealBuddy;
    this.revealTrustedShares = !!revealTrusted;
    this.persist();
  }
  getRevealFlags(): { revealBuddyShares: boolean; revealTrustedShares: boolean } {
    return { revealBuddyShares: this.revealBuddyShares, revealTrustedShares: this.revealTrustedShares };
  }
  checkSharesAvailable(): boolean {
    return this.folders.length > 0 && this.folders.some(f => f.files.length > 0);
  }
  // ponytail: /data is Docker convention; WSL bun DATA_DIR falls back to ./data — resolve /data/* against actual DATA_DIR
  private resolveRealPath(p: string): string {
    if (!p) return p;
    if (existsSync(p)) return p;
    if ((p === "/data" || p.startsWith("/data/")) && this.dataDir !== "/data") {
      const suffix = p === "/data" ? "" : p.slice(5);
      const cand = suffix ? join(this.dataDir, suffix.replace(/^\//, "")) : this.dataDir;
      if (existsSync(cand)) return cand;
      try {
        const absCand = suffix ? resolve(this.dataDir, suffix.replace(/^\//, "")) : resolve(this.dataDir);
        if (absCand !== cand && existsSync(absCand)) return absCand;
      } catch {}
    }
    return p;
  }

  /** Mirrors pynicotine/shares.py check_shares_available: list roots not accessible on bridge FS (e.g. /data/Music not mounted) */
  getUnavailableShares(): [string, string][] {
    const out: [string, string][] = [];
    for (const roots of this.customRootsByLevel.values()) {
      for (const [v, p] of roots) {
        const real = this.resolveRealPath(p);
        if (!existsSync(real)) out.push([v, p]);
        else {
          try {
            const st = statSync(real);
            if (!st.isDirectory() && !st.isFile()) out.push([v, p]);
          } catch {
            out.push([v, p]);
          }
        }
      }
    }
    return out;
  }
  hasUnavailableShares(): boolean { return this.getUnavailableShares().length > 0; }
  getVirtual2Real(virtualPath: string): string | undefined { return this.virtual2real.get(virtualPath); }
  getReal2Virtual(realPath: string): string | undefined { return this.real2virtual.get(realPath); }
  hasVirtualPath(virtualPath: string): boolean {
    if (this.virtual2real.has(virtualPath)) return true;
    for (const f of this.folders) {
      if (f.name === virtualPath || virtualPath.startsWith(f.name + "\\")) return true;
      if (f.files.some(fi => fi.name === virtualPath)) return true;
    }
    return false;
  }

  getSharedCounts(): { dirs: number; files: number } {
    let files = 0;
    for (const f of this.folders) files += f.files.length;
    return { dirs: this.folders.length, files };
  }
  getSharedCountsForPermission(permission: PermissionLevel): { dirs: number; files: number } {
    const folders = this.getFoldersForPermission(permission);
    let files = 0;
    for (const f of folders) files += f.files.length;
    return { dirs: folders.length, files };
  }

  /**
   * Real file sharing — web sends [virtualName,path] pairs.
   * Scan each real path (must be mounted into container, e.g. -v ~/Music:/data/shares/Music)
   * and map to the requested virtualName. Persists and invalidates watchers.
   */
  setCustomShares(roots: [string, string][], level: PermissionLevel = PermissionLevel.PUBLIC): ShareFolder[] {
    // Persist canonical roots for rescan (covers "just-added" shares after restart)
    this.customRootsByLevel.set(level, roots.slice());
    const prevByName = new Map<string, ShareFile>();
    for (const fo of this.folders) for (const f of fo.files) prevByName.set(f.name, f);
    const folders: ShareFolder[] = [];
    // Keep other levels untouched; rebuild that level from scratch
    const keep = (lvl: PermissionLevel) => (lvl === level ? [] : this.getFolders(lvl));
    const beforePublic = level === PermissionLevel.PUBLIC ? [] : [...this.publicFolders];
    const beforeBuddy = level === PermissionLevel.BUDDY ? [] : [...this.buddyFolders];
    const beforeTrusted = level === PermissionLevel.TRUSTED ? [] : [...this.trustedFolders];
    // Scan each requested root — always on full real path, never virtual name
    for (const [virtualRaw, realRaw] of roots) {
      const vName = (virtualRaw || "").trim().replace(/[/\\]+/g, "_").replace(/^[" ]+|[" ]+$/g, "") || "Shared";
      const rawPath = (realRaw || "").trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
      if (!vName || !rawPath) continue;
      const rPath = this.resolveRealPath(rawPath);
      if (!existsSync(rPath)) {
        // Path not mounted — keep placeholder so UI shows, but no files. Persist virtual→real mapping anyway.
        this.virtual2real.set(vName, rawPath);
        this.real2virtual.set(rawPath, vName);
        // create empty folder entry so peer sees virtual name even if host path missing (nicotine parity: empty dirs still reported)
        const existsVirtual = folders.find((f) => f.name === vName);
        if (!existsVirtual) folders.push({ name: vName, files: [] });
        continue;
      }
      try {
        const stats = statSync(rPath);
        if (stats.isFile()) {
          // single file share — respect file filters + exclusions
          const fileName = `${vName}\\${basename(rPath)}`;
          const base = basename(rPath);
          if (this.isFileFiltered(base) || this.isFileFiltered(fileName) || this.isFileExcludedByExclusions(base) || this.isFileExcludedByExclusions(fileName)) {
            this.virtual2real.set(vName, rPath);
            this.real2virtual.set(rPath, vName);
            const existsVirtual = folders.find((f) => f.name === vName);
            if (!existsVirtual) folders.push({ name: vName, files: [] });
          } else {
            const ext = extname(rPath).slice(1).toLowerCase();
            const prev = prevByName.get(fileName);
            const mtime = stats.mtimeMs;
            const prevMtime = this.fileMtimes.get(rPath);
            if (prev && prevMtime === mtime) {
              folders.push({ name: vName, files: [{ ...prev, size: stats.size }] });
            } else {
              this.fileMtimes.set(rPath, mtime);
              // attrs async not needed sync — use empty
              folders.push({ name: vName, files: [{ name: fileName, size: stats.size, ext, attrs: [] }] });
            }
            this.virtual2real.set(vName, rPath);
            this.real2virtual.set(rPath, vName);
            this.virtual2real.set(fileName, rPath);
            this.real2virtual.set(rPath, fileName);
          }
        } else if (stats.isDirectory()) {
          this.walkDir(rPath, vName, folders, prevByName);
        }
      } catch {}
    }
    // Merge untouched levels back into their arrays
    if (level === PermissionLevel.PUBLIC) this.publicFolders = folders;
    else if (level === PermissionLevel.BUDDY) this.buddyFolders = folders;
    else if (level === PermissionLevel.TRUSTED) this.trustedFolders = folders;
    // Rebuild combined + persist
    this.rebuildCombined();
    // Re-add untouched levels' folders (rebuildCombined already merged all three, so we need to ensure we didn't lose them: we kept before* but set above only one level — need to restore others)
    // Actually public/buddy/trusted already set above; rebuildCombined merges all three, so fine.
    this.persist();
    // Re-establish watchers for new dirs
    try {
      for (const w of this.watchers) try { (w as unknown as { close: () => void }).close(); } catch {}
      this.watchers = [];
      const dirs = this.resolveSharedDirs();
      // also watch custom roots (resolve /data/* against DATA_DIR)
      for (const [, r] of roots) {
        const real = this.resolveRealPath(r.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, ""));
        if (existsSync(real)) dirs.push(real);
      }
      for (const d of dirs) {
        if (!existsSync(d)) continue;
        try {
          const { watch } = require("node:fs") as typeof import("node:fs");
          const w = watch(d, { recursive: true } as unknown as { recursive: boolean }, () => {
            const now = Date.now();
            const last = (this as unknown as { _watchDebounce?: number })._watchDebounce || 0;
            if (now - last < 2000) return;
            (this as unknown as { _watchDebounce: number })._watchDebounce = now;
            this.rescanAsync().catch(() => {});
          });
          this.watchers.push(w as unknown as ReturnType<typeof import("node:fs").watch>);
        } catch {}
      }
    } catch {}
    return folders;
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
    const env = process.env.SHARED_DIRS || "";
    if (env) return env.split(":").map(s => s.trim()).filter(Boolean);
    const candidates = [join(this.dataDir, "shared"), join(this.dataDir, "shares"), "/data/shared"];
    return candidates.filter(p => existsSync(p));
  }

  private walkDir(realPath: string, virtualPath: string, out: ShareFolder[], prevByName?: Map<string, ShareFile>) {
    let entries: string[];
    try { entries = readdirSync(realPath); } catch { return; }
    // Check folder filter + exclusions against virtual path (with trailing \)
    const folderTest = `${virtualPath}\\`;
    if (this.isFolderFiltered(folderTest) || this.isFolderFiltered(virtualPath) || this.isFolderExcludedByExclusions(folderTest) || this.isFolderExcludedByExclusions(virtualPath)) return;
    const files: ShareFile[] = [];
    // virtual2real for folder itself
    this.virtual2real.set(virtualPath, realPath);
    this.real2virtual.set(realPath, virtualPath);
    for (const ent of entries) {
      const full = join(realPath, ent);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        const subVirtual = `${virtualPath}\\${ent}`;
        if (this.isFolderFiltered(`${subVirtual}\\`) || this.isFolderFiltered(subVirtual) || this.isFolderExcludedByExclusions(`${subVirtual}\\`) || this.isFolderExcludedByExclusions(subVirtual)) continue;
        this.walkDir(full, subVirtual, out, prevByName);
      } else if (st.isFile()) {
        if (this.isFileFiltered(ent) || this.isFileFiltered(`${virtualPath}\\${ent}`) || this.isFileExcludedByExclusions(ent) || this.isFileExcludedByExclusions(`${virtualPath}\\${ent}`)) continue;
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
          // populate virtual maps for file
          this.virtual2real.set(vName, full);
          this.real2virtual.set(full, vName);
          continue;
        }
        this.fileMtimes.set(full, mtime);
        // ponytail: attrs empty — bridge is SLSK-only, worker owns TinyTag/mutagen analysis (POST /analyze)
        const attrs: Array<[number, number]> = [];
        files.push({ name: vName, size: st.size, ext, attrs });
        this.virtual2real.set(vName, full);
        this.real2virtual.set(full, vName);
      }
    }
    if (files.length) out.push({ name: virtualPath, files: files.sort((a,b)=> a.name.localeCompare(b.name)) });
  }

  /** Async FS scanner (no local enrichment — bridge stays SLSK-only) */
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
    if (this.isFolderFiltered(folderTest) || this.isFolderFiltered(virtualPath) || this.isFolderExcludedByExclusions(folderTest) || this.isFolderExcludedByExclusions(virtualPath)) return;
    // prev map for async reuse
    const prevByName = new Map<string, ShareFile>();
    for (const fo of this.folders) for (const f of fo.files) prevByName.set(f.name, f);
    const files: ShareFile[] = [];
    this.virtual2real.set(virtualPath, realPath);
    this.real2virtual.set(realPath, virtualPath);
    for (const ent of entries) {
      const full = join(realPath, ent);
      let st;
      try { st = statSync(full); } catch { continue; }
      if (st.isDirectory()) {
        const subVirtual = `${virtualPath}\\${ent}`;
        if (this.isFolderFiltered(`${subVirtual}\\`) || this.isFolderFiltered(subVirtual) || this.isFolderExcludedByExclusions(`${subVirtual}\\`) || this.isFolderExcludedByExclusions(subVirtual)) continue;
        await this.walkDirAsync(full, subVirtual, out);
      } else if (st.isFile()) {
        if (this.isFileFiltered(ent) || this.isFileFiltered(`${virtualPath}\\${ent}`) || this.isFileExcludedByExclusions(ent) || this.isFileExcludedByExclusions(`${virtualPath}\\${ent}`)) continue;
        const ext = extname(ent).slice(1).toLowerCase();
        const vName = `${virtualPath}\\${ent}`;
        const mtime = st.mtimeMs;
        const prevMtime = this.fileMtimes.get(full);
        if (prevMtime !== undefined && prevMtime === mtime && prevByName.has(vName)) {
          const prev = prevByName.get(vName)!;
          files.push({ ...prev, size: st.size });
          this.virtual2real.set(vName, full);
          this.real2virtual.set(full, vName);
          continue;
        }
        this.fileMtimes.set(full, mtime);
        // ponytail: bridge stays SLSK-only — worker owns analysis
        const attrs: Array<[number, number]> = [];
        files.push({ name: vName, size: st.size, ext, attrs });
        this.virtual2real.set(vName, full);
        this.real2virtual.set(full, vName);
      }
    }
    if (files.length) out.push({ name: virtualPath, files: files.sort((a,b)=> a.name.localeCompare(b.name)) });
  }

  private async scanCustomRootsAsync(roots: [string, string][]): Promise<ShareFolder[]> {
    const prevByName = new Map<string, ShareFile>();
    for (const fo of this.folders) for (const f of fo.files) prevByName.set(f.name, f);
    const folders: ShareFolder[] = [];
    for (const [virtualRaw, realRaw] of roots) {
      const vName = (virtualRaw || "").trim().replace(/[/\\]+/g, "_").replace(/^[" ]+|[" ]+$/g, "") || "Shared";
      const rawPath = (realRaw || "").trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
      if (!vName || !rawPath) continue;
      const rPath = this.resolveRealPath(rawPath);
      if (!existsSync(rPath)) {
        this.virtual2real.set(vName, rawPath);
        this.real2virtual.set(rawPath, vName);
        if (!folders.find((f) => f.name === vName)) folders.push({ name: vName, files: [] });
        continue;
      }
      try {
        const stats = statSync(rPath);
        if (stats.isFile()) {
          const fileName = `${vName}\\${basename(rPath)}`;
          const base = basename(rPath);
          if (this.isFileFiltered(base) || this.isFileFiltered(fileName) || this.isFileExcludedByExclusions(base) || this.isFileExcludedByExclusions(fileName)) {
            this.virtual2real.set(vName, rPath);
            this.real2virtual.set(rPath, vName);
            if (!folders.find((f) => f.name === vName)) folders.push({ name: vName, files: [] });
          } else {
            const ext = extname(rPath).slice(1).toLowerCase();
            const prev = prevByName.get(fileName);
            const mtime = stats.mtimeMs;
            const prevMtime = this.fileMtimes.get(rPath);
            if (prev && prevMtime === mtime) {
              folders.push({ name: vName, files: [{ ...prev, size: stats.size }] });
            } else {
              this.fileMtimes.set(rPath, mtime);
              // ponytail: bridge SLSK-only — attrs empty, worker handles TinyTag
              const attrs: Array<[number, number]> = [];
              folders.push({ name: vName, files: [{ name: fileName, size: stats.size, ext, attrs }] });
            }
            this.virtual2real.set(vName, rPath);
            this.real2virtual.set(rPath, vName);
            this.virtual2real.set(fileName, rPath);
            this.real2virtual.set(rPath, fileName);
          }
        } else if (stats.isDirectory()) {
          await this.walkDirAsync(rPath, vName, folders);
        }
      } catch {}
    }
    return folders;
  }

  private scanCustomRoots(roots: [string, string][]): ShareFolder[] {
    const prevByName = new Map<string, ShareFile>();
    for (const fo of this.folders) for (const f of fo.files) prevByName.set(f.name, f);
    const folders: ShareFolder[] = [];
    for (const [virtualRaw, realRaw] of roots) {
      const vName = (virtualRaw || "").trim().replace(/[/\\]+/g, "_").replace(/^[" ]+|[" ]+$/g, "") || "Shared";
      const rawPath = (realRaw || "").trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "");
      if (!vName || !rawPath) continue;
      const rPath = this.resolveRealPath(rawPath);
      if (!existsSync(rPath)) {
        this.virtual2real.set(vName, rawPath);
        this.real2virtual.set(rawPath, vName);
        if (!folders.find((f) => f.name === vName)) folders.push({ name: vName, files: [] });
        continue;
      }
      try {
        const stats = statSync(rPath);
        if (stats.isFile()) {
          const fileName = `${vName}\\${basename(rPath)}`;
          const base = basename(rPath);
          if (this.isFileFiltered(base) || this.isFileFiltered(fileName) || this.isFileExcludedByExclusions(base) || this.isFileExcludedByExclusions(fileName)) {
            this.virtual2real.set(vName, rPath);
            this.real2virtual.set(rPath, vName);
            if (!folders.find((f) => f.name === vName)) folders.push({ name: vName, files: [] });
          } else {
            const ext = extname(rPath).slice(1).toLowerCase();
            const prev = prevByName.get(fileName);
            const mtime = stats.mtimeMs;
            const prevMtime = this.fileMtimes.get(rPath);
            if (prev && prevMtime === mtime) {
              folders.push({ name: vName, files: [{ ...prev, size: stats.size }] });
            } else {
              this.fileMtimes.set(rPath, mtime);
              // ponytail: bridge SLSK-only — attrs empty, worker handles TinyTag
              const attrs: Array<[number, number]> = [];
              folders.push({ name: vName, files: [{ name: fileName, size: stats.size, ext, attrs }] });
            }
            this.virtual2real.set(vName, rPath);
            this.real2virtual.set(rPath, vName);
            this.virtual2real.set(fileName, rPath);
            this.real2virtual.set(rPath, fileName);
          }
        } else if (stats.isDirectory()) {
          this.walkDir(rPath, vName, folders, prevByName);
        }
      } catch {}
    }
    return folders;
  }

  async rescanAsync(): Promise<ShareFolder[]> {
    // ponytail: full rescan covers custom mounts + SHARED_DIRS, not just SHARED_DIRS
    if (this.customRootsByLevel.size > 0) {
      let touched = false;
      const levels: PermissionLevel[] = [PermissionLevel.PUBLIC, PermissionLevel.BUDDY, PermissionLevel.TRUSTED];
      for (const lvl of levels) {
        const roots = this.customRootsByLevel.get(lvl);
        if (!roots) continue;
        const rescanned = await this.scanCustomRootsAsync(roots);
        if (lvl === PermissionLevel.PUBLIC) this.publicFolders = rescanned;
        else if (lvl === PermissionLevel.BUDDY) this.buddyFolders = rescanned;
        else this.trustedFolders = rescanned;
        touched = true;
      }
      // If public had no custom roots, still scan SHARED_DIRS fallback
      const publicRoots = this.customRootsByLevel.get(PermissionLevel.PUBLIC);
      if (!publicRoots || publicRoots.length === 0) {
        const scanned = await this.scanFsSharesAsync();
        if (scanned.length > 0) { this.publicFolders = scanned; touched = true; }
      }
      if (touched) { this.rebuildCombined(); this.persist(); }
      return this.folders;
    }
    // Legacy: no customRoots yet — be careful not to wipe custom shares that haven't been re-synced after upgrade.
    // If public folders look custom (virtual names not matching SHARED_DIRS basenames), skip destructive overwrite.
    const scanned = await this.scanFsSharesAsync();
    if (scanned.length > 0) {
      if (this.publicFolders.length === 0) {
        this.publicFolders = scanned; this.rebuildCombined(); this.persist();
      } else {
        const sharedBases = new Set(this.resolveSharedDirs().map((d) => basename(d)));
        const looksLikeShared = this.publicFolders.every((f) => sharedBases.has(f.name));
        if (looksLikeShared) { this.publicFolders = scanned; this.rebuildCombined(); this.persist(); }
      }
    }
    return this.folders;
  }

  /** Rescan and persist — called on startup or via WS rescan request */
  rescan(): ShareFolder[] {
    if (this.customRootsByLevel.size > 0) {
      let touched = false;
      const levels: PermissionLevel[] = [PermissionLevel.PUBLIC, PermissionLevel.BUDDY, PermissionLevel.TRUSTED];
      for (const lvl of levels) {
        const roots = this.customRootsByLevel.get(lvl);
        if (!roots) continue;
        const rescanned = this.scanCustomRoots(roots);
        if (lvl === PermissionLevel.PUBLIC) this.publicFolders = rescanned;
        else if (lvl === PermissionLevel.BUDDY) this.buddyFolders = rescanned;
        else this.trustedFolders = rescanned;
        touched = true;
      }
      const publicRoots = this.customRootsByLevel.get(PermissionLevel.PUBLIC);
      if (!publicRoots || publicRoots.length === 0) {
        const scanned = this.scanFsShares();
        if (scanned.length > 0) { this.publicFolders = scanned; touched = true; }
      }
      if (touched) { this.rebuildCombined(); this.persist(); }
      return this.folders;
    }
    const scanned = this.scanFsShares();
    if (scanned.length > 0) {
      if (this.publicFolders.length === 0) {
        this.publicFolders = scanned; this.rebuildCombined(); this.persist();
      } else {
        const sharedBases = new Set(this.resolveSharedDirs().map((d) => basename(d)));
        const looksLikeShared = this.publicFolders.every((f) => sharedBases.has(f.name));
        if (looksLikeShared) { this.publicFolders = scanned; this.rebuildCombined(); this.persist(); }
      }
    }
    return this.folders;
  }

  setExcludedPhrases(phrases: string[]) {
    for (const ph of phrases) this.excludedPhrases.add(ph.toLowerCase());
  }

  /** Check if file name contains excluded phrase (server 160 filtering) */
  isExcluded(query: string): boolean {
    const lower = query.toLowerCase();
    for (const ph of this.excludedPhrases) if (lower.includes(ph)) return true;
    return false;
  }
  isFileExcluded(fileName: string): boolean {
    const lower = fileName.toLowerCase();
    for (const ph of this.excludedPhrases) if (lower.includes(ph)) return true;
    return false;
  }

  private rebuildWordIndex() {
    this.wordIndex.clear();
    const punctRe = /[!"#$%&'()*+,\-.\/:;<=>?@\[\\\]^_`{|}~]+/g;
    for (const folder of this.folders) {
      for (const f of folder.files) {
        const lower = f.name.toLowerCase();
        // split via punctuation + backslash/space
        const words = lower.replace(punctRe, " ").replace(/\\/g, " ").split(/\s+/).filter(Boolean);
        const uniq = new Set(words);
        for (const w of uniq) {
          if (!this.wordIndex.has(w)) this.wordIndex.set(w, new Set());
          this.wordIndex.get(w)!.add(f);
        }
        // also index full filename tokens for suffix partial handling
        // keep raw lower for partial suffix scan fallback
      }
    }
  }

  /** Search shares by query (sanitized, word-index accelerated, handles -excluded and *partial) */
  search(query: string): ShareFile[] {
    const clean = sanitizeSearchTerm(query);
    const included = clean.includedWords;
    const excluded = clean.excludedWords;
    if (!included.length) return [];
    // Use wordIndex intersection for exact words where possible, fallback to substring scan
    let candidates: Set<ShareFile> | null = null;
    for (const w of included) {
      const isPartial = false; // sanitized already stripped *, we treat all as exact for index
      // For partial, we would need suffix scan — fallback to linear
      const set = this.wordIndex.get(w);
      if (set) {
        if (candidates === null) candidates = new Set(set);
        else {
          const next = new Set<ShareFile>();
          for (const f of candidates) if (set.has(f)) next.add(f);
          candidates = next;
          if (candidates.size === 0) break;
        }
      } else {
        // No exact word match — fallback to substring linear scan for this word
        // If candidates already narrowed, filter it; else need full scan
        if (candidates === null) {
          // need full scan for first word fallback
          candidates = new Set();
          for (const folder of this.folders) for (const f of folder.files) if (f.name.toLowerCase().includes(w)) candidates.add(f);
        } else {
          const filtered = new Set<ShareFile>();
          for (const f of candidates) if (f.name.toLowerCase().includes(w)) filtered.add(f);
          candidates = filtered;
        }
        if (candidates.size === 0) break;
      }
    }
    if (!candidates || candidates.size === 0) return [];
    let out = [...candidates];
    // Filter excluded words (must not be present) and excluded phrases (file contains phrase)
    if (excluded.length) {
      out = out.filter(f => {
        const lower = f.name.toLowerCase();
        for (const ex of excluded) if (lower.includes(ex)) return false;
        return true;
      });
    }
    // Filter server excluded phrases
    if (this.excludedPhrases.size) {
      out = out.filter(f => !this.isFileExcluded(f.name));
    }
    return out.sort((a,b)=> a.name.localeCompare(b.name));
  }

  /** Build SharedFileListResponse 5 payload (zlib lvl4, sorted) — respects PermissionLevel + reveal flags (shares.py:392) */
  buildSharedFileListResponse(permission: PermissionLevel = PermissionLevel.PUBLIC): Buffer {
    const folders = this.getFoldersForPermission(permission);
    // Locked directories are those not visible to requester (Soulseek.NET BrowseResponseFactory.cs:83)
    const all = [...this.publicFolders, ...this.buddyFolders, ...this.trustedFolders];
    const visibleNames = new Set(folders.map(f => f.name));
    const locked = all.filter(f => !visibleNames.has(f.name));
    // inner payload: uint32 ndirs, then for each dir: string name, uint32 nfiles, then files
    const parts: Buffer[] = [];
    parts.push(packUint32(folders.length));
    // sorted folders
    const sorted = [...folders].sort((a,b)=> a.name.localeCompare(b.name));
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
    // Include unknown int 0 + locked dirs block (BrowseResponseFactory.cs:83)
    parts.push(packUint32(0)); // unknown
    parts.push(packUint32(locked.length));
    const lockedSorted = [...locked].sort((a,b)=> a.name.localeCompare(b.name));
    for (const folder of lockedSorted) {
      parts.push(packString(folder.name));
      parts.push(packUint32(folder.files.length));
      const filesSorted = [...folder.files].sort((a,b)=> a.name.localeCompare(b.name));
      for (const f of filesSorted) {
        parts.push(Buffer.from([1]));
        parts.push(packString(f.name));
        const sz = typeof f.size === "bigint" ? f.size : BigInt(f.size);
        parts.push(packUint64(sz));
        parts.push(packString(f.ext || ""));
        const attrs = f.attrs || [];
        parts.push(packUint32(attrs.length));
        for (const [type, val] of attrs) {
          parts.push(packUint32(type));
          parts.push(packUint32(val));
        }
      }
    }
    const inner = Buffer.concat(parts);
    const compressed = deflateSync(inner, { level: 4 });
    // Raw cache for BrowseResponse (Soulseek.NET RawBrowseResponse disk-cache) — persist compressed
    try {
      const cachePath = join(defaultConfigDir(), "browse.cache");
      writeFileSync(cachePath + ".tmp", compressed);
      // atomic rename? keep simple
      try { const { renameSync } = require("node:fs") as typeof import("node:fs"); renameSync(cachePath + ".tmp", cachePath); } catch { try { writeFileSync(cachePath, compressed); } catch {} }
    } catch {}
    return frameMessage(PEER_MESSAGE_CODES.sharedFileListResponse, compressed);
  }

  /** Build FolderContentsResponse 37 — respects PermissionLevel.
   * SLSKPROTOCOL.md Peer Code 37: token + folder + nfolders + [dir + nfiles + files].
   * The response covers the folder "with all subfolders", so include descendant
   * virtual paths (dir + "\\" prefix) alongside the exact match. */
  buildFolderContentsResponse(token: number, dir: string, permission: PermissionLevel = PermissionLevel.PUBLIC): Buffer {
    const folders = this.getFoldersForPermission(permission);
    const matches = folders.filter((f) => f.name === dir || f.name.startsWith(dir + "\\"))
      .sort((a, b) => a.name.localeCompare(b.name));
    const parts: Buffer[] = [];
    parts.push(packUint32(token >>> 0));
    parts.push(packString(dir));
    parts.push(packUint32(matches.length));
    for (const folder of matches) {
      const files = [...folder.files].sort((a, b) => a.name.localeCompare(b.name));
      parts.push(packString(folder.name));
      parts.push(packUint32(files.length));
      for (const f of files) {
        parts.push(Buffer.from([1]));
        parts.push(packString(f.name));
        const sz = typeof f.size === "bigint" ? f.size : BigInt(f.size);
        parts.push(packUint64(sz));
        parts.push(packString(f.ext || ""));
        const attrs = f.attrs || [];
        parts.push(packUint32(attrs.length));
        for (const [type, val] of attrs) {
          parts.push(packUint32(type));
          parts.push(packUint32(val));
        }
      }
    }
    const inner = Buffer.concat(parts);
    const compressed = deflateSync(inner, { level: 4 });
    return frameMessage(PEER_MESSAGE_CODES.folderContentsResponse, compressed);
  }

  /** Build FileSearchResponse 9 for inbound FileSearch queries (if someone searches us) — respects permission + maxresults cap (nicotine-plus searches.maxresults 300) */
  buildFileSearchResponse(token: number, username: string, query: string, freeSlots = true, speed = 0, inQueue = 0, permission: PermissionLevel = PermissionLevel.PUBLIC, maxResults?: number): Buffer | null {
    const clean = sanitizeSearchTerm(query);
    const included = clean.includedWords;
    const excluded = clean.excludedWords;
    if (!included.length) return null;
    // Filter search results by permission level's folders only
    const folders = this.getFoldersForPermission(permission);
    const filtered: ShareFile[] = [];
    for (const folder of folders) {
      for (const f of folder.files) {
        const nameLower = f.name.toLowerCase();
        if (!included.every(t => nameLower.includes(t))) continue;
        if (excluded.length && excluded.some(t => nameLower.includes(t))) continue;
        if (this.isFileExcluded(f.name)) continue;
        filtered.push(f);
      }
    }
    let results = filtered.sort((a,b)=> a.name.localeCompare(b.name));
    if (!results.length) return null;
    if (typeof maxResults === "number" && maxResults > 0 && results.length > maxResults) results = results.slice(0, maxResults);
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
    parts.push(packUint32(0)); // unknown 0 separator before private block (Peer Code 9 step 8)
    const inner = Buffer.concat(parts);
    const compressed = deflateSync(inner);
    return frameMessage(PEER_MESSAGE_CODES.fileSearchResponse, compressed);
  }
}
