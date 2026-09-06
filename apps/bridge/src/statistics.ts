// SPDX-FileCopyrightText: 2001-2026 Nicotine+ Contributors
// SPDX-FileCopyrightText: 2025-2026 Nicotine Hub Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Portions based on nicotine-plus pynicotine/transfers.py:Statistics + pynicotine/statistics.py

/**
 * Transfer statistics — mirrors pynicotine/transfers.py:Statistics and pynicotine/statistics.py.
 * Tracks since_timestamp, started/completed counts and sizes for downloads/uploads.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface Statistics {
  since_timestamp: number;
  started_downloads: number;
  completed_downloads: number;
  downloaded_size: number;
  started_uploads: number;
  completed_uploads: number;
  uploaded_size: number;
  failed_downloads: number;
  cancelled_downloads: number;
  failed_uploads: number;
  cancelled_uploads: number;
}

function defaultConfigDir(): string {
  return process.env.CONFIG_DIR || "/config";
}

function statsPath(configDir: string): string {
  return join(configDir, "statistics.json");
}

export class StatsManager {
  private stats: Statistics;
  private sessionStats: Statistics;
  private configDir: string;

  constructor(opts?: { configDir?: string }) {
    this.configDir = opts?.configDir || defaultConfigDir();
    const loaded = this.load();
    if (loaded) {
      this.stats = normalize(loaded);
      this.sessionStats = {
        since_timestamp: Math.floor(Date.now() / 1000),
        started_downloads: 0,
        completed_downloads: 0,
        downloaded_size: 0,
        started_uploads: 0,
        completed_uploads: 0,
        uploaded_size: 0,
        failed_downloads: 0,
        cancelled_downloads: 0,
        failed_uploads: 0,
        cancelled_uploads: 0,
      };
    } else {
      const now = Math.floor(Date.now() / 1000);
      this.stats = {
        since_timestamp: now,
        started_downloads: 0,
        completed_downloads: 0,
        downloaded_size: 0,
        started_uploads: 0,
        completed_uploads: 0,
        uploaded_size: 0,
        failed_downloads: 0,
        cancelled_downloads: 0,
        failed_uploads: 0,
        cancelled_uploads: 0,
      };
      this.sessionStats = { ...this.stats, since_timestamp: now };
      this.persist();
    }
  }

  private load(): Statistics | null {
    const p = statsPath(this.configDir);
    if (!existsSync(p)) return null;
    try {
      const raw = JSON.parse(readFileSync(p, "utf8"));
      if (typeof raw.since_timestamp === "number") return raw as Statistics;
    } catch {}
    return null;
  }

  persist() {
    try {
      const p = statsPath(this.configDir);
      mkdirSync(join(p, ".."), { recursive: true });
      writeFileSync(p, JSON.stringify(this.stats, null, 2));
    } catch {}
  }

  getTotal(): Statistics { return { ...this.stats }; }
  getSession(): Statistics { return { ...this.sessionStats }; }

  reset() {
    const now = Math.floor(Date.now() / 1000);
    this.stats = {
      since_timestamp: now,
      started_downloads: 0,
      completed_downloads: 0,
      downloaded_size: 0,
      started_uploads: 0,
      completed_uploads: 0,
      uploaded_size: 0,
      failed_downloads: 0,
      cancelled_downloads: 0,
      failed_uploads: 0,
      cancelled_uploads: 0,
    };
    this.sessionStats = { ...this.stats };
    this.persist();
  }

  append(
    type: "started_downloads" | "completed_downloads" | "downloaded_size" | "started_uploads" | "completed_uploads" | "uploaded_size" | "failed_downloads" | "cancelled_downloads" | "failed_uploads" | "cancelled_uploads",
    value: number = 1,
  ) {
    if (type === "downloaded_size" || type === "uploaded_size") {
      this.stats[type] += value;
      this.sessionStats[type] += value;
    } else {
      (this.stats[type] as number) += value;
      (this.sessionStats[type] as number) += value;
    }
    this.persist();
  }

  recordDownloadStarted(size?: number) {
    this.append("started_downloads", 1);
    if (size) this.append("downloaded_size", 0); // placeholder
  }
  recordDownloadCompleted(size: number) {
    this.append("completed_downloads", 1);
    this.append("downloaded_size", size);
  }
  recordUploadStarted() { this.append("started_uploads", 1); }
  recordUploadCompleted(size: number) {
    this.append("completed_uploads", 1);
    this.append("uploaded_size", size);
  }
  recordDownloadFailed() { this.append("failed_downloads", 1); }
  recordDownloadCancelled() { this.append("cancelled_downloads", 1); }
  recordUploadFailed() { this.append("failed_uploads", 1); }
  recordUploadCancelled() { this.append("cancelled_uploads", 1); }
}

// Older statistics.json files predate the failed/cancelled counters.
function normalize(raw: Statistics): Statistics {
  return {
    since_timestamp: raw.since_timestamp,
    started_downloads: raw.started_downloads ?? 0,
    completed_downloads: raw.completed_downloads ?? 0,
    downloaded_size: raw.downloaded_size ?? 0,
    started_uploads: raw.started_uploads ?? 0,
    completed_uploads: raw.completed_uploads ?? 0,
    uploaded_size: raw.uploaded_size ?? 0,
    failed_downloads: (raw as Partial<Statistics>).failed_downloads ?? 0,
    cancelled_downloads: (raw as Partial<Statistics>).cancelled_downloads ?? 0,
    failed_uploads: (raw as Partial<Statistics>).failed_uploads ?? 0,
    cancelled_uploads: (raw as Partial<Statistics>).cancelled_uploads ?? 0,
  };
}
