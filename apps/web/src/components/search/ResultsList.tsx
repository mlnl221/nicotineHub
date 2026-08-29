"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SearchRow } from "@/lib/protocol";
import { humanLength, humanQuality, humanSize } from "@/lib/format";

const PAGE_SIZE = 50;

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
  grouping?: string;
  expand?: string;
}

export function ResultsList({ rows, onRowTap, grouping = "folder_grouping", expand = "all" }: ResultsListProps) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // reset when filter/query changes (rows identity)
  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [rows]);

  // infinite scroll: when sentinel enters viewport, grow by 50
  useEffect(() => {
    if (visibleCount >= rows.length) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisibleCount((v) => Math.min(v + PAGE_SIZE, rows.length));
        }
      },
      { rootMargin: "400px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visibleCount, rows.length]);

  const sliced = useMemo(() => rows.slice(0, visibleCount), [rows, visibleCount]);

  const groups = useMemo(() => {
    if (grouping === "ungrouped") {
      return [["ungrouped", sliced] as [string, SearchRow[]]];
    }
    const map = new Map<string, SearchRow[]>();
    for (const row of sliced) {
      const key = grouping === "user_grouping" ? row.user : row.folder || "(root)";
      const list = map.get(key);
      if (list) list.push(row);
      else map.set(key, [row]);
    }
    return [...map.entries()];
  }, [sliced, grouping]);

  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  // sync collapsed to expand setting
  useEffect(() => {
    if (grouping === "ungrouped") {
      setCollapsed(new Set());
      return;
    }
    const keys = groups.map(([k]) => k);
    if (expand === "all") setCollapsed(new Set());
    else if (expand === "none") setCollapsed(new Set(keys));
    else if (expand === "partial") {
      // partial: expand first half, collapse rest (mimics folder_grouping expand_root)
      const half = Math.floor(keys.length / 2);
      setCollapsed(new Set(keys.slice(half)));
    }
  }, [grouping, expand, groups.map(g=>g[0]).join("|")]);
  const hasMore = visibleCount < rows.length;

  if (rows.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 px-8 py-16 text-center">
        <span className="material-symbols-outlined text-4xl text-outline">search</span>
        <p className="font-body text-sm text-on-surface-variant">No results yet. Try a search above.</p>
      </div>
    );
  }

  const isUngrouped = grouping === "ungrouped";

  return (
    <div className="flex-1 px-3 py-2 max-w-full overflow-hidden">
      {groups.map(([folder, items]) => {
        const isCollapsed = isUngrouped ? false : collapsed.has(folder);
        if (isUngrouped) {
          // flat rendering without header
          return (
            <div key={folder} className="mb-2 overflow-hidden rounded-2xl bg-surface-container-lowest max-w-full">
              <ul>
                {items.map((row, i) => (
                  <li key={`${row.user}:${row.path}:${i}`}>
                    <button
                      type="button"
                      data-row-user={row.user}
                      data-row-path={row.path}
                      data-row-filename={row.filename}
                      data-row-folder={row.folder}
                      data-row-size={String(row.size)}
                      onClick={() => onRowTap(row)}
                      className="flex w-full items-center gap-3 border-t border-outline-variant/15 px-4 py-2.5 text-left transition-colors active:bg-surface-container max-w-full overflow-hidden first:border-t-0"
                    >
                      <span className="material-symbols-outlined text-[22px] text-primary-container shrink-0">{fileTypeIcon(row.fileType)}</span>
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <div className="truncate font-body text-sm font-medium text-on-surface max-w-full">{row.filename}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-label text-[11px] text-on-surface-variant max-w-full overflow-hidden">
                          <span className="inline-flex items-center gap-1 min-w-0 max-w-[35vw] truncate"><span className="material-symbols-outlined text-[13px] shrink-0">person</span><span className="truncate">{row.user}</span></span>
                          <span>{humanSize(row.size)}</span>
                          {humanQuality(row.attributes) ? <span>{humanQuality(row.attributes)}</span> : null}
                          {humanLength(row.length) ? <span>{humanLength(row.length)}</span> : null}
                          {row.slotFree ? <span className="rounded-full bg-tertiary-container px-1.5 py-0.5 font-semibold text-on-tertiary-container">free</span> : <span className="text-outline">q:{row.inQueue}</span>}
                          {row.private ? <span className="rounded-full bg-surface-container-highest px-1.5 py-0.5 text-on-surface-variant">private</span> : null}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        }
        return (
          <div key={folder} className="mb-2 overflow-hidden rounded-2xl bg-surface-container-lowest max-w-full">
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
              className="flex w-full min-h-11 items-center gap-2 px-4 py-3 text-left"
            >
              <span className="material-symbols-outlined text-[18px] text-on-surface-variant shrink-0">
                {isCollapsed ? "chevron_right" : "expand_more"}
              </span>
              <span className="flex-1 min-w-0 truncate font-label text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                {folder}
              </span>
              <span className="font-label text-xs text-outline shrink-0">{items.length}</span>
            </button>

            {!isCollapsed ? (
              <ul>
                {items.map((row, i) => (
                  <li key={`${row.user}:${row.path}:${i}`}>
                    <button
                      type="button"
                      data-row-user={row.user}
                      data-row-path={row.path}
                      data-row-filename={row.filename}
                      data-row-folder={row.folder}
                      data-row-size={String(row.size)}
                      onClick={() => onRowTap(row)}
                      className="flex w-full items-center gap-3 border-t border-outline-variant/15 px-4 py-2.5 text-left transition-colors active:bg-surface-container max-w-full overflow-hidden"
                    >
                      <span className="material-symbols-outlined text-[22px] text-primary-container shrink-0">
                        {fileTypeIcon(row.fileType)}
                      </span>
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <div className="truncate font-body text-sm font-medium text-on-surface max-w-full">
                          {row.filename}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-label text-[11px] text-on-surface-variant max-w-full overflow-hidden">
                          <span className="inline-flex items-center gap-1 min-w-0 max-w-[35vw] truncate">
                            <span className="material-symbols-outlined text-[13px] shrink-0">person</span>
                            <span className="truncate">{row.user}</span>
                          </span>
                          <span>{humanSize(row.size)}</span>
                          {humanQuality(row.attributes) ? <span>{humanQuality(row.attributes)}</span> : null}
                          {humanLength(row.length) ? <span>{humanLength(row.length)}</span> : null}
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
      {/* Controls — default 50, LOAD ALL option */}
      {hasMore ? (
        <div className="flex flex-col items-center gap-2 py-4">
          <p className="font-label text-xs text-on-surface-variant">
            Showing {Math.min(visibleCount, rows.length)} of {rows.length}
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setVisibleCount((v) => Math.min(v + PAGE_SIZE, rows.length))}
              className="rounded-full bg-surface-container-high px-4 py-2 font-label text-xs font-semibold text-on-surface"
            >
              Load 50 more
            </button>
            <button
              type="button"
              onClick={() => setVisibleCount(rows.length)}
              className="rounded-full bg-primary px-4 py-2 font-label text-xs font-bold text-on-primary"
            >
              Load all ({rows.length - visibleCount} remaining)
            </button>
          </div>
        </div>
      ) : rows.length > PAGE_SIZE ? (
        <p className="py-3 text-center font-label text-xs text-outline">All {rows.length} results shown (max 2500)</p>
      ) : null}
      {/* Infinite scroll sentinel */}
      {hasMore ? <div ref={sentinelRef} className="h-px" aria-hidden /> : null}
    </div>
  );
}
