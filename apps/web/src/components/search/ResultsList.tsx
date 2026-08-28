"use client";

import { useMemo, useState } from "react";
import type { SearchRow } from "@/lib/protocol";
import { humanLength, humanQuality, humanSize, rowLengthSeconds } from "@/lib/format";

function fileTypeIcon(ext: string): string {
  const e = ext.toLowerCase();
  if (["mp3", "flac", "wav", "ogg", "m4a", "aac", "opus", "ape", "wma", "alac"].includes(e))
    return "audio_file";
  if (["mp4", "mkv", "avi", "mov", "wmv", "flv", "webm", "m4v", "mpg", "mpeg"].includes(e))
    return "video_file";
  if (["jpg", "jpeg", "png", "gif", "bmp", "webp", "tif", "tiff", "svg", "heic"].includes(e))
    return "image";
  if (["pdf", "doc", "docx", "txt", "rtf", "odt", "ppt", "pptx", "xls", "xlsx", "epub", "mobi"].includes(e))
    return "description";
  if (["zip", "rar", "7z", "tar", "gz", "iso", "dmg"].includes(e)) return "archive";
  if (["exe", "msi", "apk", "deb", "rpm", "jar", "dll"].includes(e)) return "terminal";
  return "draft";
}

interface ResultsListProps {
  rows: SearchRow[];
  onRowTap: (row: SearchRow) => void;
}

export function ResultsList({ rows, onRowTap }: ResultsListProps) {
  const groups = useMemo(() => {
    const map = new Map<string, SearchRow[]>();
    for (const row of rows) {
      const key = row.folder || "(root)";
      const list = map.get(key);
      if (list) list.push(row);
      else map.set(key, [row]);
    }
    return [...map.entries()];
  }, [rows]);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  if (rows.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 py-16 text-center">
        <span className="material-symbols-outlined text-4xl text-outline">search</span>
        <p className="font-body text-sm text-on-surface-variant">No results yet. Try a search above.</p>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-3 py-2">
      {groups.map(([folder, items]) => {
        const isCollapsed = collapsed.has(folder);
        return (
          <div key={folder} className="mb-2 overflow-hidden rounded-2xl bg-surface-container-lowest">
            <button
              type="button"
              onClick={() =>
                setCollapsed((prev) => {
                  const next = new Set(prev);
                  if (next.has(folder)) next.delete(folder);
                  else next.add(folder);
                  return next;
                })
              }
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
            >
              <span className="material-symbols-outlined text-[18px] text-on-surface-variant">
                {isCollapsed ? "chevron_right" : "expand_more"}
              </span>
              <span className="flex-1 truncate font-label text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                {folder}
              </span>
              <span className="font-label text-xs text-outline">{items.length}</span>
            </button>

            {!isCollapsed ? (
              <ul>
                {items.map((row, i) => (
                  <li key={`${row.user}:${row.path}:${i}`}>
                    <button
                      type="button"
                      onClick={() => onRowTap(row)}
                      className="flex w-full items-center gap-3 border-t border-outline-variant/15 px-4 py-2.5 text-left transition-colors active:bg-surface-container"
                    >
                      <span className="material-symbols-outlined text-[22px] text-primary-container">
                        {fileTypeIcon(row.fileType)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-body text-sm font-medium text-on-surface">
                          {row.filename}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-label text-[11px] text-on-surface-variant">
                          <span className="inline-flex items-center gap-1">
                            <span className="material-symbols-outlined text-[13px]">person</span>
                            {row.user}
                          </span>
                          <span>{humanSize(row.size)}</span>
                          {humanQuality(row.attributes) ? <span>{humanQuality(row.attributes)}</span> : null}
                          {rowLengthSeconds(row.attributes) != null ? (
                            <span>{humanLength(rowLengthSeconds(row.attributes)!)}</span>
                          ) : null}
                          {row.slotFree ? (
                            <span className="rounded-full bg-tertiary-container px-1.5 py-0.5 font-semibold text-on-tertiary-container">
                              free
                            </span>
                          ) : (
                            <span className="text-outline">q:{row.inQueue}</span>
                          )}
                          {row.private ? (
                            <span className="rounded-full bg-surface-container-highest px-1.5 py-0.5 text-on-surface-variant">
                              private
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
