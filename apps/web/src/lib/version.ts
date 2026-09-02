"use client";

// Build tag — matches Docker GHCR tag (TAG env in compose, e.g. latest / sha-abc123 / 0.2.0 / v0.2.0)
// Injected at build time via NEXT_PUBLIC_BUILD_TAG (Docker ARG TAG) or Vercel COMMIT_SHA.
// Fallback to package version 0.1.0 for local dev.
export const buildTag: string = process.env.NEXT_PUBLIC_BUILD_TAG || process.env.NEXT_PUBLIC_APP_VERSION || "0.1.0";

export const shortSha: string = (process.env.NEXT_PUBLIC_COMMIT_SHA || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "").slice(0, 7);

export const buildDate: string = process.env.NEXT_PUBLIC_BUILD_DATE || "";

export const appVersion: string = buildTag;

export const soulseekClientVersion = "160.3";

export function displayVersion(): string {
  // Prefer buildTag; if it looks like sha-xxxx, keep as is, if numeric tag add v prefix for consistency
  if (!buildTag || buildTag === "0.1.0") return `v${buildTag}`;
  if (/^\d+\.\d+\.\d+/.test(buildTag) && !buildTag.startsWith("v")) return `v${buildTag}`;
  return buildTag;
}

export function fullBuildInfo(): string {
  const parts: string[] = [displayVersion()];
  if (shortSha && !buildTag.includes(shortSha)) parts.push(shortSha);
  if (buildDate) parts.push(buildDate);
  return parts.join(" • ");
}
