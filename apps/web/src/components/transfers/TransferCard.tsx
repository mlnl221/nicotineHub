"use client";

import type { Transfer } from "@/lib/protocol";

function humanSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = bytes;
  let i = -1;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
}

function humanSpeed(bps: number): string {
  if (!bps) return "—";
  return `${humanSize(bps)}/s`;
}

function humanETA(sec: number | null): string {
  if (sec == null) return "—";
  if (sec < 60) return `00:${String(sec).padStart(2, "0")}`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}:${String(mm).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function TransferCard({
  transfer,
  onPause,
  onCancel,
  onResume,
  onClear,
}: {
  transfer: Transfer;
  onPause?: () => void;
  onCancel?: () => void;
  onResume?: () => void;
  onClear?: () => void;
}) {
  const pct = transfer.size > 0 ? Math.min(100, Math.round((transfer.current / transfer.size) * 100)) : 0;
  const isQueued = transfer.status === "Queued";
  const isPaused = transfer.status === "Paused";
  const isFinished = transfer.status === "Finished";
  const isCancelled = transfer.status === "Cancelled";
  const isTransferring = transfer.status === "Transferring" || transfer.status === "Getting status";

  const barColor = transfer.isUpload
    ? isQueued
      ? "bg-outline"
      : "bg-tertiary"
    : isQueued
      ? "bg-outline"
      : "bg-primary";

  const speedLabel =
    isFinished ? "Finished" : isQueued ? "Queued" : isPaused ? "Paused" : humanSpeed(transfer.speed);
  const etaLabel =
    isFinished ? "Complete" : isQueued ? `Place ${transfer.queuePosition ?? "—"}` : isPaused ? "Paused" : `ETA: ${humanETA(transfer.timeLeft)}`;

  const speedColor = transfer.isUpload ? "text-tertiary" : "text-primary";

  return (
    <div
      data-testid="transfer-card"
      data-transfer-id={transfer.id}
      data-status={transfer.status}
      className={`flex flex-col gap-3 rounded-xl p-4 ghost-border bg-surface-container-lowest dark:bg-surface-container/50 group relative overflow-hidden ${isQueued ? "opacity-75" : ""}`}
    >
      <div className="flex justify-between items-start gap-3">
        <div className="min-w-0 flex-1">
          <h4 className="font-body font-semibold text-sm truncate pr-2" title={transfer.fileName}>
            {transfer.fileName}
          </h4>
          <p className="font-label text-xs text-on-surface-variant dark:text-outline mt-1 truncate">
            {transfer.isUpload ? "To: " : "Peer: "}
            {transfer.username} • {humanSize(transfer.size)}
            {isQueued && transfer.queuePosition ? ` • Queue ${transfer.queuePosition}` : ""}
          </p>
          <p className="font-label text-[11px] text-outline mt-0.5 truncate hidden md:block" title={transfer.virtualPath}>
            {transfer.virtualPath}
          </p>
        </div>
        <div className="text-right shrink-0">
          <div className={`font-label font-bold text-sm ${isQueued || isPaused || isFinished || isCancelled ? "text-outline" : speedColor}`}>
            {speedLabel}
          </div>
          <div className="font-label text-xs text-on-surface-variant dark:text-outline">{etaLabel}</div>
        </div>
      </div>

      <div className="w-full bg-surface-container-highest dark:bg-surface-container-high rounded-full h-1.5 overflow-hidden">
        <div
          className={`h-1.5 rounded-full transition-all duration-500 ${barColor} ${transfer.isUpload ? "" : isTransferring ? "progress-glow" : ""}`}
          style={{ width: `${isQueued ? 0 : pct}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>

      <div className="flex justify-end gap-2">
        {isPaused ? (
          <button
            aria-label="Resume"
            onClick={onResume}
            className="p-2 min-h-11 min-w-11 flex items-center justify-center rounded-lg bg-surface-container-high text-on-surface-variant hover:text-primary dark:hover:text-inverse-primary transition-colors"
            title="Resume"
          >
            <span className="material-symbols-outlined text-[18px]">play_arrow</span>
          </button>
        ) : isTransferring || isQueued ? (
          <button
            aria-label="Pause"
            onClick={onPause}
            className="p-2 min-h-11 min-w-11 flex items-center justify-center rounded-lg bg-surface-container-high text-on-surface-variant hover:text-primary transition-colors"
            title="Pause"
          >
            <span className="material-symbols-outlined text-[18px]">pause</span>
          </button>
        ) : null}
        {isQueued && !transfer.isUpload ? (
          <button
            aria-label="Prioritize"
            onClick={onResume}
            className="p-2 min-h-11 min-w-11 flex items-center justify-center rounded-lg bg-surface-container-high text-on-surface-variant hover:text-tertiary transition-colors"
            title="Prioritize"
          >
            <span className="material-symbols-outlined text-[18px]">arrow_upward</span>
          </button>
        ) : null}
        {(isFinished || isCancelled || transfer.status === "Filtered") ? (
          <button
            aria-label="Clear"
            onClick={onClear}
            className="p-2 min-h-11 min-w-11 flex items-center justify-center rounded-lg bg-surface-container-high text-on-surface-variant hover:text-primary transition-colors"
            title="Clear"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        ) : (
          <button
            aria-label="Cancel"
            onClick={onCancel}
            className="p-2 min-h-11 min-w-11 flex items-center justify-center rounded-lg bg-surface-container-high text-on-surface-variant hover:text-error transition-colors"
            title="Cancel"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        )}
      </div>
    </div>
  );
}
