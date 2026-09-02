import type { SearchFile } from "@/lib/protocol";
import { humanSize, humanLength as humanDuration } from "@/lib/format";

export interface ResultCardProps {
  icon: string;
  badge: string;
  title: string;
  description: string;
  meta: { label: string; value: string }[];
}

function iconFor(name: string): string {
  const ext = (name.split(".").pop() ?? "").toLowerCase();
  if (["mp3", "flac", "wav", "ogg", "m4a", "aac", "opus"].includes(ext)) return "audio_file";
  if (["mp4", "mkv", "avi", "mov", "webm", "m4v"].includes(ext)) return "video_file";
  return "developer_mode";
}

export function fileToCard(file: SearchFile & { username: string }): ResultCardProps {
  const ext = (file.name.split(".").pop() ?? "FILE").toUpperCase();
  const meta: { label: string; value: string }[] = [{ label: "Size", value: humanSize(file.size) }];

  if (file.attrs.bitrate) meta.push({ label: "Bitrate", value: `${file.attrs.bitrate} kbps` });
  else if (file.attrs.sampleRate) meta.push({ label: "Sample", value: `${file.attrs.sampleRate / 1000} kHz` });
  else meta.push({ label: "Bitrate", value: "—" });

  if (file.attrs.length) meta.push({ label: "Length", value: humanDuration(file.attrs.length) });
  else if (file.attrs.bitDepth) meta.push({ label: "Depth", value: `${file.attrs.bitDepth}-bit` });
  else meta.push({ label: "Length", value: "—" });

  return {
    icon: iconFor(file.name),
    badge: ext,
    title: file.name,
    description: `from ${file.username}`,
    meta,
  };
}

export function ResultCard({ icon, badge, title, description, meta }: ResultCardProps) {
  return (
    <div className="glass-card group flex flex-col rounded-xl p-5 transition-transform duration-300 hover:-translate-y-1">
      <div className="mb-4 flex items-start justify-between">
        <div className="rounded-lg bg-surface-container-highest/20 p-3 text-on-surface-variant dark:text-inverse-primary">
          <span className="material-symbols-outlined" style={{ fontVariationSettings: "'FILL' 1" }}>
            {icon}
          </span>
        </div>
        <span className="rounded bg-primary-container/20 px-2 py-1 font-label text-[10px] font-bold uppercase tracking-wider text-primary dark:bg-primary-container/20 dark:text-primary-fixed">
          {badge}
        </span>
      </div>
      <h3 className="mb-2 font-headline text-lg leading-tight text-on-surface transition-colors group-hover:text-primary dark:text-inverse-on-surface dark:group-hover:text-primary-fixed">
        {title}
      </h3>
      <p className="mb-6 flex-1 font-body text-sm text-on-surface-variant dark:text-outline">
        {description}
      </p>
      <div className="grid grid-cols-3 gap-2 border-t border-outline-variant/10 pt-4 font-label text-xs text-on-surface-variant dark:text-outline">
        {meta.map((m) => (
          <div key={m.label}>
            <span className="mb-1 block text-on-surface dark:text-inverse-primary">{m.label}</span>
            {m.value}
          </div>
        ))}
      </div>
    </div>
  );
}
