// Shared Soulseek profile-picture helper: base64 payload → data URL.
// Sniffs SVG (raw or base64 "PHN2") so vector avatars render; else PNG.
// Non-string/empty input yields "" (no image).
export function profilePicSrc(pic: unknown): string {
  if (typeof pic !== "string" || !pic) return "";
  const trim = pic.trimStart();
  const isSvg = trim.startsWith("<svg") || trim.startsWith("PHN2");
  const mime = isSvg ? "image/svg+xml" : "image/png";
  return `data:${mime};base64,${pic}`;
}
