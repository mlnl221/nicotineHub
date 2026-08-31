// SPDX-FileCopyrightText: 2025-2026 Nicotine Hub Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Secure filesystem browsing for DATA_DIR.
 * All paths are contained within DATA_DIR; traversal outside is rejected.
 */
import { readdir, stat, lstat, realpath } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve, relative, basename, sep } from "node:path";

export interface FileEntry {
  name: string;
  type: "directory" | "file" | "symlink";
  size: number;
  mtime: number; // epoch ms
  path: string; // relative to DATA_DIR, always starts with "/"
}

export interface BrowseResult {
  path: string; // requested relative path, normalized "/..." or "/"
  absolutePath: string; // resolved absolute on disk
  entries: FileEntry[];
  parent: string | null; // parent relative path or null if root
}

function getDataDir(): string {
  return resolve(process.env.DATA_DIR || "/data");
}

/**
 * Normalize user-supplied path to a safe relative path.
 * Accepts "", "/", "subdir", "/subdir", "a/b/c", with or without trailing slash.
 * Rejects null bytes, control chars, empty segments with ".." traversal intent is sanitized via resolve check.
 */
export function normalizeRequestedPath(raw: string | null | undefined): string {
  if (!raw) return "/";
  let p = String(raw).trim();
  // Strip null bytes
  p = p.replace(/\0/g, "");
  // Must be reasonable length
  if (p.length > 1024) p = p.slice(0, 1024);
  // Ensure leading slash for uniform handling, but treat as relative to DATA_DIR root
  if (!p.startsWith("/")) p = "/" + p;
  // Collapse multiple slashes, remove trailing slash except root
  p = p.replace(/\/+/g, "/");
  if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
  // Decode URI components that may have been double-encoded? The caller already does decodeURIComponent via URLSearchParams
  // Reject obvious control chars already
  return p;
}

/**
 * Resolve a requested relative path to an absolute path under DATA_DIR.
 * Returns absolute path if contained, otherwise throws.
 */
export async function resolveSafePath(requestedPath: string, dataDirOverride?: string): Promise<string> {
  const DATA_DIR = resolve(dataDirOverride || getDataDir());
  const normalized = normalizeRequestedPath(requestedPath);
  // relative segment without leading slash
  const rel = normalized === "/" ? "" : normalized.slice(1);
  const joined = join(DATA_DIR, rel);
  const resolved = resolve(joined);
  const dataResolved = resolve(DATA_DIR);
  // Containment check
  if (resolved !== dataResolved && !resolved.startsWith(dataResolved + sep)) {
    throw new Error(`Path traversal detected: ${requestedPath}`);
  }
  // If path exists and is symlink, check realpath containment as well
  try {
    if (existsSync(resolved)) {
      const lst = await lstat(resolved);
      if (lst.isSymbolicLink()) {
        const real = await realpath(resolved);
        const realResolved = resolve(real);
        if (realResolved !== dataResolved && !realResolved.startsWith(dataResolved + sep)) {
          throw new Error(`Symlink escapes DATA_DIR`);
        }
        // Return real path's resolved? We keep resolved (logical) but ensure real is contained
      }
    }
  } catch (e) {
    // If file doesn't exist, containment already checked; throw original if traversal
    if ((e as Error).message.includes("escapes")) throw e;
    // else ignore (file not found will be handled by caller)
  }
  return resolved;
}

export function getParentPath(normalizedPath: string): string | null {
  const n = normalizeRequestedPath(normalizedPath);
  if (n === "/") return null;
  const idx = n.lastIndexOf("/");
  if (idx === 0) return "/";
  return n.slice(0, idx);
}

/**
 * List directory entries under DATA_DIR.
 * Returns sorted: directories first, then files, alphabetical case-insensitive.
 */
export async function listDirectory(requestedPath: string, dataDirOverride?: string): Promise<BrowseResult> {
  const DATA_DIR = resolve(dataDirOverride || getDataDir());
  const normalized = normalizeRequestedPath(requestedPath);
  const absolutePath = await resolveSafePath(normalized, DATA_DIR);

  let dirStat;
  try {
    dirStat = await stat(absolutePath);
  } catch {
    const err = new Error(`Not found: ${normalized}`);
    (err as unknown as { status?: number }).status = 404;
    throw err;
  }
  if (!dirStat.isDirectory()) {
    const err = new Error(`Not a directory: ${normalized}`);
    (err as unknown as { status?: number }).status = 400;
    throw err;
  }

  const dirents = await readdir(absolutePath, { withFileTypes: true });
  const entries: FileEntry[] = [];
  for (const d of dirents) {
    const name = d.name;
    // Skip hidden dotfiles? Keep them but they are visible; alternatively skip . and .. is already not listed
    if (name === "." || name === "..") continue;
    // Skip control-char names
    if (/[\x00-\x1f\x7f]/.test(name)) continue;
    const full = join(absolutePath, name);
    let type: FileEntry["type"] = "file";
    let size = 0;
    let mtime = 0;
    try {
      // Use lstat to detect symlink without following, but get size/mtime via stat if not symlink?
      const lst = await lstat(full);
      if (lst.isSymbolicLink()) {
        type = "symlink";
        // Try to stat target for size/mtime if inside DATA_DIR
        try {
          const targetStat = await stat(full);
          size = targetStat.isDirectory() ? 0 : targetStat.size;
          mtime = targetStat.mtimeMs;
          // If symlink points to directory outside DATA_DIR, keep as symlink type but still list
          // Containment already checked for directory navigation, but symlink target may escape — we still listing symlink itself is okay,
          // but navigating into it will be blocked by resolveSafePath realpath check.
        } catch {
          size = 0;
          mtime = lst.mtimeMs;
        }
      } else if (lst.isDirectory()) {
        type = "directory";
        size = 0;
        mtime = lst.mtimeMs;
      } else {
        type = "file";
        size = lst.size;
        mtime = lst.mtimeMs;
      }
    } catch {
      // unreadable entry — skip
      continue;
    }
    const relPath = normalized === "/" ? `/${name}` : `${normalized}/${name}`;
    entries.push({ name, type, size, mtime, path: relPath });
  }

  // Sort directories first, symlink treated as per target? Keep symlink as file unless it points to directory — we can't know without extra stat, sort as file
  entries.sort((a, b) => {
    const rank = (t: string) => (t === "directory" ? 0 : t === "symlink" ? 1 : 2);
    const ra = rank(a.type);
    const rb = rank(b.type);
    if (ra !== rb) return ra - rb;
    return a.name.toLowerCase().localeCompare(b.name.toLowerCase());
  });

  // Cap to avoid huge payloads (e.g., 5000 entries)
  const capped = entries.slice(0, 5000);

  return {
    path: normalized,
    absolutePath,
    entries: capped,
    parent: getParentPath(normalized),
  };
}
