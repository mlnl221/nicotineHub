// SPDX-FileCopyrightText: 2001-2026 Nicotine+ Contributors
// SPDX-FileCopyrightText: 2025-2026 nicotine-mobile Contributors
// SPDX-License-Identifier: GPL-3.0-or-later
// Portions based on nicotine-plus pynicotine/networkfilter.py

/**
 * Network filter — bans, IP blocks, geo-blocking. Mirrors pynicotine/networkfilter.py.
 * Handles username bans, IP wildcard bans, and country geo-blocking.
 */

export function isIpAddress(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    if (p === "*") return true;
    const n = Number(p);
    return Number.isInteger(n) && n >= 0 && n <= 255;
  });
}

export function ipMatchesPattern(ip: string, pattern: string): boolean {
  if (pattern === ip) return true;
  if (!pattern.includes("*")) return false;
  const ipParts = ip.split(".");
  const patParts = pattern.split(".");
  if (ipParts.length !== 4 || patParts.length !== 4) return false;
  for (let i = 0; i < 4; i++) {
    if (patParts[i] === "*") continue;
    if (patParts[i] !== ipParts[i]) return false;
  }
  return true;
}

export function isUserBanned(
  username: string,
  banlist: Set<string> | string[],
): boolean {
  const set = banlist instanceof Set ? banlist : new Set(banlist);
  return set.has(username);
}

export function isIpBlocked(
  ip: string,
  ipblocklist: Record<string, string> | Map<string, string>,
): boolean {
  const entries = ipblocklist instanceof Map ? [...ipblocklist.keys()] : Object.keys(ipblocklist);
  for (const pattern of entries) {
    if (ipMatchesPattern(ip, pattern)) return true;
  }
  return false;
}

export function isGeoblocked(
  countryCode: string,
  geoblock: boolean,
  geoblockcc: string[],
): boolean {
  if (!geoblock) return false;
  if (!countryCode) return false;
  const upper = countryCode.toUpperCase();
  const blocked = geoblockcc.map((c) => c.toUpperCase().trim()).filter(Boolean);
  if (blocked.length === 0 || (blocked.length === 1 && blocked[0] === "")) return false;
  return blocked.includes(upper);
}

// GeoIP lookup — mirrors pynicotine/networkfilter.py _populate_ip_country_data + get_country_code
// Uses pynicotine/external/data/ip_country_data.csv (bisect_left on uint32 ip). Falls back to
// manual setCountryForIp cache when CSV not available.
import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ipCountryCache = new Map<string, string>();
let ipRangeValues: number[] = [];
let ipRangeCountries: string[] = [];
let loadedIpCountryData = false;

function populateIpCountryData(): void {
  if (loadedIpCountryData) return;
  // resolve csv — try multiple locations (bundled src/data, external fallback)
  const candidates = [
    join(dirname(fileURLToPath(import.meta.url)), "data", "ip_country_data.csv"),
    join(process.cwd(), "apps/bridge/src/data/ip_country_data.csv"),
    join(process.cwd(), "src/data/ip_country_data.csv"),
    join(dirname(fileURLToPath(import.meta.url)), "..", "data", "ip_country_data.csv"),
  ];
  let found: string | undefined;
  for (const p of candidates) {
    if (existsSync(p)) { found = p; break; }
  }
  // also try relative to file dir walking up
  if (!found) {
    try {
      const { existsSync: es } = require("node:fs");
      const tryPaths = [
        "/home/magnus/projects/nicotine_mobile/apps/bridge/src/data/ip_country_data.csv",
      ];
      for (const p of tryPaths) if (es(p)) { found = p; break; }
    } catch {}
  }
  if (!found) {
    loadedIpCountryData = true;
    return;
  }
  try {
    const content = readFileSync(found, "utf8");
    let first = true;
    for (const rawLine of content.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      if (first) {
        ipRangeValues = line.split(",").map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
        first = false;
        continue;
      }
      ipRangeCountries = line.split(",").map((s) => s.trim());
      break;
    }
  } catch {}
  loadedIpCountryData = true;
}

function bisectLeft(arr: number[], target: number): number {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function ipToUint32(ip: string): number | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => parseInt(p, 10));
  if (nums.some((n) => isNaN(n) || n < 0 || n > 255)) return null;
  // network order like inet_aton -> big-endian uint32
  return ((nums[0] * 256 + nums[1]) * 256 + nums[2]) * 256 + nums[3];
}

export function setCountryForIp(ip: string, countryCode: string) {
  ipCountryCache.set(ip, countryCode.toUpperCase());
}

export function getCountryCode(ip: string): string {
  const cached = ipCountryCache.get(ip);
  if (cached) return cached;
  if (!loadedIpCountryData) populateIpCountryData();
  if (!ipRangeCountries.length || !ipRangeValues.length) return "";
  const num = ipToUint32(ip);
  if (num === null) return "";
  const idx = bisectLeft(ipRangeValues, num);
  if (idx >= ipRangeCountries.length) return "";
  return ipRangeCountries[idx] || "";
}

export function _resetIpCountryDataForTests(): void {
  loadedIpCountryData = false;
  ipRangeValues = [];
  ipRangeCountries = [];
  ipCountryCache.clear();
}

export function shouldBlockUser(opts: {
  username: string;
  ip: string;
  countryCode?: string;
  banlist: string[];
  ipblocklist: Record<string, string>;
  geoblock: boolean;
  geoblockcc: string[];
}): { blocked: boolean; reason: string } {
  if (isUserBanned(opts.username, opts.banlist)) {
    return { blocked: true, reason: "Banned" };
  }
  if (isIpBlocked(opts.ip, opts.ipblocklist)) {
    return { blocked: true, reason: "Banned" };
  }
  const cc = opts.countryCode ?? getCountryCode(opts.ip);
  if (isGeoblocked(cc, opts.geoblock, opts.geoblockcc)) {
    return { blocked: true, reason: "Geoblocked" };
  }
  return { blocked: false, reason: "" };
}

export function shouldIgnoreUser(opts: {
  username: string;
  ip: string;
  ignorelist: string[];
  ipignorelist: Record<string, string>;
}): boolean {
  if (isUserBanned(opts.username, opts.ignorelist)) return true;
  if (isIpBlocked(opts.ip, opts.ipignorelist)) return true;
  return false;
}
