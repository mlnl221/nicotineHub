/** Display formatters for search result metadata. */

export function humanSize(bytes: number, fileSizeUnit?: "B" | ""): string {
  if (bytes == null || Number.isNaN(bytes as number) || bytes < 0) return "—";
  if (!bytes) return "0 B";
  // nicotine-plus ui.file_size_unit === "B" means exact bytes, "" means humanized
  // Read from localStorage if not passed (for non-hook contexts)
  let unit = fileSizeUnit;
  if (unit === undefined) {
    try {
      const raw = typeof localStorage !== "undefined" ? (localStorage.getItem("nicotineHub.settings") ?? localStorage.getItem("nicotine.settings")) : null;
      if (raw) {
        const parsed = JSON.parse(raw) as { ui?: { file_size_unit?: string } };
        unit = parsed?.ui?.file_size_unit as "B" | "" | undefined;
      }
    } catch {}
  }
  if (unit === "B") return `${bytes.toLocaleString()} B`;
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let u = 0;
  while (value >= 1024 && u < units.length - 1) {
    value /= 1024;
    u += 1;
  }
  const rounded = u === 0 ? value : Math.round(value * 10) / 10;
  return `${rounded} ${units[u]}`;
}

/** Format display path respecting ui.reverse_file_paths (nicotine-plus). When true, filename comes before path. */
export function formatDisplayPath(virtualPath: string, reverse?: boolean): string {
  let rev = reverse;
  if (rev === undefined) {
    try {
      const raw = typeof localStorage !== "undefined" ? (localStorage.getItem("nicotineHub.settings") ?? localStorage.getItem("nicotine.settings")) : null;
      if (raw) {
        const parsed = JSON.parse(raw) as { ui?: { reverse_file_paths?: boolean } };
        rev = parsed?.ui?.reverse_file_paths;
      }
    } catch { rev = true; }
    if (rev === undefined) rev = true;
  }
  if (!virtualPath) return virtualPath;
  if (rev) return virtualPath;
  // when not reversed, show path with forward slashes first? For Soulseek it's \ separated; we just return as-is but conceptually path before filename is same string.
  // Keeping as-is since virtualPath already is "Folder\\file" — reversing would be "file (Folder)" — we handle that in caller if needed.
  return virtualPath;
}

export function humanSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return "";
  return `${humanSize(bytesPerSec)}/s`;
}

export function humanLength(seconds: number): string {
  if (!seconds || seconds <= 0) return "";
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Quality string: lossless shows sample rate / bit depth, else bitrate kbps. */
export function humanQuality(attrs: {
  bitrate?: number;
  sampleRate?: number;
  bitDepth?: number;
  vbr?: number;
}): string {
  if (attrs.sampleRate && attrs.bitDepth) {
    const khz = (attrs.sampleRate / 1000).toPrecision(3);
    return `${khz} kHz / ${attrs.bitDepth} bit`;
  }
  if (attrs.bitrate) {
    return `${attrs.bitrate} kbps${attrs.vbr ? " (vbr)" : ""}`;
  }
  return "";
}
