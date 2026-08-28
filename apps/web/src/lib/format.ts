export function humanSize(bytes: number): string {
  if (!bytes || bytes < 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let value = bytes;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  const rounded = value >= 100 || i === 0 ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[i]}`;
}

export function humanSpeed(bps: number): string {
  if (!bps) return "0 KB/s";
  return `${humanSize(bps)}/s`;
}

export function humanLength(seconds: number | undefined): string | null {
  if (!seconds || seconds <= 0) return null;
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function humanQuality(attributes: {
  bitrate?: number;
  length?: number;
  vbr?: number;
  sampleRate?: number;
  bitDepth?: number;
}): string | null {
  if (!attributes) return null;
  const { bitrate, length, vbr, sampleRate, bitDepth } = attributes;
  if (bitrate) {
    const kbps = Math.round(bitrate / 1000);
    return `${vbr ? "VBR " : ""}${kbps} kbps${sampleRate ? ` ${sampleRate / 1000}kHz` : ""}${
      bitDepth ? ` ${bitDepth}-bit` : ""
    }`;
  }
  if (length) return humanLength(length / 1000);
  return null;
}

export function rowLengthSeconds(attributes: {
  bitrate?: number;
  length?: number;
  vbr?: number;
  sampleRate?: number;
  bitDepth?: number;
}): number | null {
  const len = attributes.length;
  return len ? Math.round(len / 1000) : null;
}
