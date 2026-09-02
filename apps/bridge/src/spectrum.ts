// SPDX-FileCopyrightText: 2025-2026 Nicotine Hub Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Ported from smokin-salmon/smoked-salmon src/salmon/uploader/spectrals.py (Apache-2.0)
// sox spectrogram + oxipng method: Full 2000x513 + Zoom 500x1025, Kaiser -z 120

import { existsSync, mkdirSync, statSync, readdirSync, unlinkSync } from "node:fs";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { logger } from "./logger.ts";

export const SPECTRUM_DIR = process.env.SPECTRUM_DIR || "/tmp/hub-spectrum";

// Ensure dir exists on import (best-effort)
try {
  mkdirSync(SPECTRUM_DIR, { recursive: true });
} catch {}

export function calculateZoomStartpoint(duration?: number): number {
  if (typeof duration === "number" && duration > 5) return Math.floor(duration / 2);
  return 0;
}

export function getSpectrumHash(token: number, mtimeMs: number, size: number): string {
  const h = createHash("sha256").update(`${token}:${mtimeMs}:${size}`).digest("hex");
  return h.slice(0, 16);
}

export function getSpectrumPaths(token: number, hash: string): { full: string; zoom: string; meta: string } {
  const base = `${token}-${hash}`;
  return {
    full: join(SPECTRUM_DIR, `${base}-Full.png`),
    zoom: join(SPECTRUM_DIR, `${base}-Zoom.png`),
    meta: join(SPECTRUM_DIR, `${base}.json`),
  };
}

export function isAudioFile(fileName: string): boolean {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  return ["flac", "wav", "aiff", "aif", "mp3", "ogg", "wma", "m4a", "wv", "aac", "opus"].includes(ext);
}

function pruneIfNeeded() {
  try {
    const files = readdirSync(SPECTRUM_DIR);
    // Delete oldest if >100 files (keeps ~50 pairs) or tmp >80% is handled by caller; here just file count
    if (files.length > 100) {
      const withStat = files
        .map((f) => {
          const p = join(SPECTRUM_DIR, f);
          try {
            const s = statSync(p);
            return { f, p, mtime: s.mtimeMs };
          } catch {
            return null;
          }
        })
        .filter(Boolean) as Array<{ f: string; p: string; mtime: number }>;
      withStat.sort((a, b) => a.mtime - b.mtime);
      const toDelete = withStat.slice(0, withStat.length - 100);
      for (const ent of toDelete) {
        try {
          unlinkSync(ent.p);
        } catch {}
      }
      logger.info("spectrum", "pruned old spectra", { deleted: toDelete.length });
    }
  } catch {}
}

function needsTranscode(ext: string): boolean {
  // sox on this image supports flac/wav/aiff/ogg but not m4a/mp3/aac/wma/opus (see `sox --help` AUDIO FILE FORMATS)
  return ["mp3", "m4a", "aac", "wma", "opus", "alac"].includes(ext.toLowerCase());
}

async function transcodeToWav(inputPath: string): Promise<string | null> {
  try {
    const tmp = join(SPECTRUM_DIR, `.transcode-${Date.now()}-${Math.random().toString(36).slice(2,6)}.wav`);
    mkdirSync(SPECTRUM_DIR, { recursive: true });
    const r = spawnSync("ffmpeg", ["-y", "-i", inputPath, "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", tmp], { stdio: "ignore", timeout: 20000 });
    if (r.status === 0 && existsSync(tmp) && statSync(tmp).size > 1000) return tmp;
    try { unlinkSync(tmp); } catch {}
  } catch {}
  return null;
}

async function runSox(inputPath: string, fullPath: string, zoomPath: string, zoomStart: number): Promise<void> {
  const ext = inputPath.split(".").pop()?.toLowerCase() ?? "";
  let effectiveInput = inputPath;
  let tmpWav: string | null = null;
  // Pre-transcode m4a/mp3 etc via ffmpeg so sox can handle it (ponytail: one transcoding pass, not custom decoder)
  if (needsTranscode(ext)) {
    const transcoded = await transcodeToWav(inputPath);
    if (transcoded) { effectiveInput = transcoded; tmpWav = transcoded; }
  }

  const run = async (inp: string) => {
    const args = [
      "--multi-threaded",
      inp,
      "--buffer",
      "128000",
      "-n",
      "remix",
      "1",
      "spectrogram",
      "-x",
      "2000",
      "-y",
      "513",
      "-z",
      "120",
      "-w",
      "Kaiser",
      "-o",
      fullPath,
      "remix",
      "1",
      "spectrogram",
      "-x",
      "500",
      "-y",
      "1025",
      "-z",
      "120",
      "-w",
      "Kaiser",
      "-S",
      String(zoomStart),
      "-d",
      "0:02",
      "-o",
      zoomPath,
    ];
    await new Promise<void>((resolveP, reject) => {
      const child: any = spawn("sox", args, { stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      child.stderr?.on("data", (d: any) => (stderr += String(d)));
      const timer = setTimeout(() => {
        try { child.kill("SIGKILL"); } catch {}
        reject(new Error("sox timeout after 90s"));
      }, 90_000);
      child.on("error", (e: any) => { clearTimeout(timer); reject(e); });
      child.on("close", (code: any) => {
        clearTimeout(timer);
        if (code === 0) resolveP();
        else reject(new Error(`sox exited ${code}: ${stderr.slice(0, 500)}`));
      });
    });
  };

  try {
    await run(effectiveInput);
  } catch (e) {
    const msg = (e as Error).message || "";
    // Fallback: if sox failed due to missing handler and we haven't yet transcoded, try ffmpeg transcode once
    if (!tmpWav && (msg.includes("no handler") || msg.includes("FAIL formats"))) {
      const transcoded = await transcodeToWav(inputPath);
      if (transcoded) {
        tmpWav = transcoded; effectiveInput = transcoded;
        await run(effectiveInput);
      } else throw e;
    } else throw e;
  } finally {
    if (tmpWav) try { unlinkSync(tmpWav); } catch {}
  }
}

async function compressPng(pngPath: string): Promise<void> {
  // Try oxipng -o 2 --strip all ; fallback to no-op if not installed
  await new Promise<void>((resolveP) => {
    const child: any = spawn("oxipng", ["-o", "2", "--strip", "all", pngPath], { stdio: ["ignore", "pipe", "pipe"] });
    let done = false;
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
      if (!done) {
        done = true;
        resolveP();
      }
    }, 15_000);
    child.on("error", () => {
      clearTimeout(timer);
      if (!done) {
        done = true;
        resolveP();
      }
    });
    child.on("close", () => {
      clearTimeout(timer);
      if (!done) {
        done = true;
        resolveP();
      }
    });
  });
}

export class SpectrumManager {
  private running = 0;
  private queue: Array<() => void> = [];
  private inFlight = new Map<string, Promise<{ fullPath: string; zoomPath: string; etag: string; hash: string }>>();
  private maxConcurrent = 2;

  private async acquire(): Promise<void> {
    if (this.running < this.maxConcurrent) {
      this.running++;
      return;
    }
    await new Promise<void>((res) => this.queue.push(res));
    this.running++;
  }

  private release() {
    this.running = Math.max(0, this.running - 1);
    const next = this.queue.shift();
    if (next) next();
  }

  getCachedPaths(token: number, hash: string): { full: string; zoom: string } | null {
    const { full, zoom } = getSpectrumPaths(token, hash);
    if (existsSync(full) && existsSync(zoom)) return { full, zoom };
    return null;
  }

  // Lookup by token without hash: find newest matching token prefix
  findLatestForToken(token: number): { full: string; zoom: string; etag: string; hash: string } | null {
    try {
      const files = readdirSync(SPECTRUM_DIR);
      const prefix = `${token}-`;
      const candidates = files.filter((f) => f.startsWith(prefix) && f.endsWith("-Full.png"));
      if (!candidates.length) return null;
      // pick newest by mtime
      let best: { f: string; mtime: number } | null = null;
      for (const f of candidates) {
        try {
          const s = statSync(join(SPECTRUM_DIR, f));
          if (!best || s.mtimeMs > best.mtime) best = { f, mtime: s.mtimeMs };
        } catch {}
      }
      if (!best) return null;
      const hash = best.f.slice(prefix.length, -"-Full.png".length);
      const { full, zoom } = getSpectrumPaths(token, hash);
      if (existsSync(full) && existsSync(zoom)) {
        const etag = `"${hash}"`;
        return { full, zoom, etag, hash };
      }
      return null;
    } catch {
      return null;
    }
  }

  async ensureSpectrum(opts: {
    token: number;
    filePath: string;
    mtimeMs: number;
    size: number;
    duration?: number;
  }): Promise<{ fullPath: string; zoomPath: string; etag: string; hash: string; fromCache: boolean }> {
    const hash = getSpectrumHash(opts.token, opts.mtimeMs, opts.size);
    const etag = `"${hash}"`;
    const { full, zoom, meta } = getSpectrumPaths(opts.token, hash);

    // Cache hit?
    if (existsSync(full) && existsSync(zoom)) {
      logger.info("spectrum", "cache hit", { token: opts.token, hash });
      return { fullPath: full, zoomPath: zoom, etag, hash, fromCache: true };
    }

    const key = `${opts.token}:${hash}`;
    const existing = this.inFlight.get(key);
    if (existing) {
      const res = await existing;
      return { ...res, fromCache: false };
    }

    const promise = (async () => {
      await this.acquire();
      try {
        // Double-check after acquire (another concurrent may have finished)
        if (existsSync(full) && existsSync(zoom)) {
          return { fullPath: full, zoomPath: zoom, etag, hash };
        }
        try {
          mkdirSync(SPECTRUM_DIR, { recursive: true });
        } catch {}
        const zoomStart = calculateZoomStartpoint(opts.duration);
        logger.info("spectrum", "generating", { token: opts.token, file: opts.filePath, zoomStart, hash });
        await runSox(opts.filePath, full, zoom, zoomStart);
        // Verify outputs
        if (!existsSync(full) || !existsSync(zoom)) throw new Error("sox did not produce expected files");
        // Compress (best-effort)
        try {
          await compressPng(full);
          await compressPng(zoom);
        } catch {}
        // Write meta
        try {
          const { writeFileSync } = await import("node:fs");
          writeFileSync(meta, JSON.stringify({ token: opts.token, hash, etag, full, zoom, filePath: opts.filePath, mtimeMs: opts.mtimeMs, size: opts.size, duration: opts.duration, createdAt: new Date().toISOString() }, null, 2));
        } catch {}
        pruneIfNeeded();
        logger.info("spectrum", "generated", { token: opts.token, hash });
        return { fullPath: full, zoomPath: zoom, etag, hash };
      } finally {
        this.release();
        // clean inFlight after completion
        setTimeout(() => this.inFlight.delete(key), 1000);
      }
    })();

    this.inFlight.set(key, promise);
    const res = await promise;
    return { ...res, fromCache: false };
  }

  deleteForToken(token: number): void {
    try {
      const files = readdirSync(SPECTRUM_DIR);
      const prefix = `${token}-`;
      for (const f of files) {
        if (f.startsWith(prefix)) {
          try {
            unlinkSync(join(SPECTRUM_DIR, f));
          } catch {}
        }
      }
    } catch {}
  }
}

export const spectrumManager = new SpectrumManager();
