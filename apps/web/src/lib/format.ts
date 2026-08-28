/** Display formatters for search result metadata. */

export function humanSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "—";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = unit === 0 ? value : Math.round(value * 10) / 10;
  return `${rounded} ${units[unit]}`;
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
