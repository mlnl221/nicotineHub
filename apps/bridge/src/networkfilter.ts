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

// Simple GeoIP lookup via env-provided mapping or fallback.
// nicotine uses external/data/ip_country_data.csv bisect. We implement a minimal
// in-memory map that can be populated at runtime; otherwise returns "".
const ipCountryCache = new Map<string, string>();

export function setCountryForIp(ip: string, countryCode: string) {
  ipCountryCache.set(ip, countryCode.toUpperCase());
}

export function getCountryCode(ip: string): string {
  return ipCountryCache.get(ip) || "";
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
