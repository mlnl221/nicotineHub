"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SearchRow } from "@/lib/protocol";
import { humanLength, humanQuality, humanSize, humanSpeed } from "@/lib/format";

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

function qualityBadge(row: SearchRow): { label: string; cls: string } | null {
  const attrs = row.attributes || {};
  const ext = row.fileType?.toLowerCase?.() ?? "";
  const sr = attrs.sampleRate;
  const bd = attrs.bitDepth;
  const br = attrs.bitrate;
  const vbr = attrs.vbr;
  if (sr && bd) {
    const isHiRes = sr > 48000 || bd > 16;
    const srLabel = sr === 44100 ? "44.1" : sr === 48000 ? "48" : `${(sr / 1000).toFixed(1)}`;
    if (isHiRes) return { label: `HI-RES ${srLabel}/${bd}`, cls: "bg-tertiary-container text-on-tertiary-container" };
    return { label: `${ext.toUpperCase()} ${srLabel}/${bd}`, cls: "bg-surface-container-high text-on-surface-variant" };
  }
  if (["flac", "wav", "aiff", "alac", "ape", "wv"].includes(ext) && !br) {
    return { label: "LOSSLESS", cls: "bg-surface-container-high text-on-surface-variant" };
  }
  if (br) {
    const vbrLabel = vbr ? "VBR" : "CBR";
    return { label: `${br} ${vbrLabel}`, cls: "bg-surface-container-high text-on-surface-variant" };
  }
  return null;
}

interface ResultsListProps {
  rows: SearchRow[];
  onRowTap: (row: SearchRow) => void;
  onRowDoubleClick?: (row: SearchRow) => void;
  selectMode?: boolean;
  selectedIds?: Set<string>;
  onToggleSelect?: (row: SearchRow) => void;
  onRangeSelect?: (row: SearchRow) => void;
  onSelectIds?: (ids: string[]) => void;
  onLongPress?: (row: SearchRow) => void;
  grouping?: string;
  expand?: string;
}

export function searchRowId(row: SearchRow): string {
  return `${row.user}:${row.path}`;
}

// Peer health pills shown right after the username: velocity first, then
// slot state. Neutral surface pills; archival gold reserved for `free`.
function PeerPills({ row }: { row: SearchRow }) {
  const speed = humanSpeed(row.speed);
  return (
    <>
      {speed ? (
        <span className="inline-flex items-center gap-0.5 rounded-full bg-surface-container-high px-1.5 py-0.5 font-semibold text-on-surface-variant">
          <span className="material-symbols-outlined text-[12px]">bolt</span>
          {speed}
        </span>
      ) : null}
      {row.slotFree ? (
        <span className="rounded-full bg-tertiary-container px-1.5 py-0.5 font-semibold text-on-tertiary-container">free</span>
      ) : (
        <span className="inline-flex items-center gap-0.5 rounded-full bg-surface-container-high px-1.5 py-0.5 text-outline">
          <span className="material-symbols-outlined text-[12px]">hourglass_top</span>q:{row.inQueue}
        </span>
      )}
    </>
  );
}

// Aggregate peer health for a group header is rendered with PeerPills on the
// group's best row (rows arrive pre-sorted, so items[0] leads).

export function ResultsList({ rows, onRowTap, onRowDoubleClick, selectMode = false, selectedIds = new Set(), onToggleSelect, onRangeSelect, onSelectIds, onLongPress, grouping = "user_grouping", expand = "all" }: ResultsListProps) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Single-tap timer: delays the sheet so a double-click can download instead.
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressed = useRef(false);
  const suppressClick = useRef(false);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const drag = useRef<{ x: number; y: number; active: boolean } | null>(null);
  useEffect(() => () => { if (tapTimer.current) clearTimeout(tapTimer.current); }, []);
  useEffect(() => {
    const move = (e: MouseEvent) => {
      const start = drag.current;
      if (!start) return;
      if (!start.active && Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) return;
      start.active = true;
      const left = Math.min(start.x, e.clientX);
      const right = Math.max(start.x, e.clientX);
      const top = Math.min(start.y, e.clientY);
      const bottom = Math.max(start.y, e.clientY);
      const ids: string[] = [];
      rowRefs.current.forEach((el, id) => {
        const rect = el.getBoundingClientRect();
        if (rect.right >= left && rect.left <= right && rect.bottom >= top && rect.top <= bottom) ids.push(id);
      });
      onSelectIds?.(ids);
      document.body.style.userSelect = "none";
    };
    const up = () => {
      if (drag.current?.active) {
        suppressClick.current = true;
        setTimeout(() => { suppressClick.current = false; }, 0);
      }
      drag.current = null;
      document.body.style.userSelect = "";
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      document.body.style.userSelect = "";
    };
  }, [onSelectIds]);
  const handleTap = (row: SearchRow) => {
    if (!onRowDoubleClick) {
      onRowTap(row);
      return;
    }
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = setTimeout(() => onRowTap(row), 250);
  };
  const handleDouble = (row: SearchRow) => {
    if (tapTimer.current) clearTimeout(tapTimer.current);
    tapTimer.current = null;
    onRowDoubleClick?.(row);
  };

  const handleClick = (e: React.MouseEvent, row: SearchRow) => {
    if (suppressClick.current) {
      e.preventDefault();
      suppressClick.current = false;
      return;
    }
    if (longPressed.current) {
      e.preventDefault();
      longPressed.current = false;
      return;
    }
    if (selectMode || e.ctrlKey || e.metaKey || e.shiftKey) {
      e.preventDefault();
      if (e.shiftKey) onRangeSelect?.(row);
      else onToggleSelect?.(row);
      return;
    }
    handleTap(row);
  };

  const rowEvents = (row: SearchRow) => ({
    onMouseDown: (e: React.MouseEvent) => {
      if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey) drag.current = { x: e.clientX, y: e.clientY, active: false };
    },
    onPointerDown: (e: React.PointerEvent) => {
      if (e.pointerType !== "touch") return;
      longPressTimer.current = setTimeout(() => {
        longPressed.current = true;
        onLongPress?.(row);
        if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(10);
      }, 500);
    },
    onPointerUp: () => { if (longPressTimer.current) clearTimeout(longPressTimer.current); },
    onPointerCancel: () => { if (longPressTimer.current) clearTimeout(longPressTimer.current); },
  });

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

  const groupedByUser = grouping !== "ungrouped";

  const groups = useMemo(() => {
    if (!groupedByUser) {
      return [["ungrouped", sliced] as [string, SearchRow[]]];
    }
    // Groups are keyed by user only — one owner per group, so the header
    // carries username + peer health once and rows stay slim.
    const map = new Map<string, SearchRow[]>();
    for (const row of sliced) {
      const key = row.user;
      const list = map.get(key);
      if (list) list.push(row);
      else map.set(key, [row]);
    }
    return [...map.entries()];
  }, [sliced, groupedByUser]);

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
      // partial: expand first half, collapse rest
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
    <div
      className="flex-1 px-3 py-2 max-w-full overflow-hidden"
      onMouseDown={(e) => {
        if (e.button === 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey) drag.current = { x: e.clientX, y: e.clientY, active: false };
      }}
    >
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
                      ref={(el) => { if (el) rowRefs.current.set(searchRowId(row), el); else rowRefs.current.delete(searchRowId(row)); }}
                      {...rowEvents(row)}
                      onClick={(e) => handleClick(e, row)}
                      onDoubleClick={() => !selectMode && handleDouble(row)}
                      className={`flex w-full items-center gap-3 border-t border-outline-variant/15 px-4 py-2.5 text-left transition-colors active:bg-surface-container max-w-full overflow-hidden first:border-t-0 ${selectedIds.has(searchRowId(row)) ? "bg-primary-fixed/15" : ""}`}
                    >
                      {selectMode ? <input type="checkbox" tabIndex={-1} checked={selectedIds.has(searchRowId(row))} readOnly className="h-4 w-4 shrink-0 accent-primary" /> : null}
                      <span className="material-symbols-outlined text-[22px] text-primary-container shrink-0">{fileTypeIcon(row.fileType)}</span>
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <div className="truncate font-body text-sm font-medium text-on-surface max-w-full">{row.filename}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-label text-[11px] text-on-surface-variant max-w-full overflow-hidden">
                          <span className="inline-flex items-center gap-1 min-w-0 max-w-[35vw] truncate"><span className="material-symbols-outlined text-[13px] shrink-0">person</span><span className="truncate">{row.user}</span></span>
                          <PeerPills row={row} />
                          <span>{humanSize(row.size)}</span>
                          {humanQuality(row.attributes) ? <span>{humanQuality(row.attributes)}</span> : null}
                          {(() => { const qb = qualityBadge(row); return qb ? <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${qb.cls}`}>{qb.label}</span> : null; })()}
                          {humanLength(row.length) ? <span>{humanLength(row.length)}</span> : null}
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
              className="w-full min-h-11 px-4 py-3 text-left"
            >
              <span className="flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px] text-on-surface-variant shrink-0">
                  {isCollapsed ? "chevron_right" : "expand_more"}
                </span>
                <span className="flex-1 min-w-0 truncate font-label text-xs font-semibold uppercase tracking-wide text-on-surface-variant">
                  {folder}
                </span>
                <span className="font-label text-xs text-outline shrink-0">{items.length}</span>
              </span>
              <span className="mt-1 flex items-center gap-1.5 pl-[26px] font-label text-[11px] text-on-surface-variant">
                <PeerPills row={items[0]} />
              </span>
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
                      ref={(el) => { if (el) rowRefs.current.set(searchRowId(row), el); else rowRefs.current.delete(searchRowId(row)); }}
                      {...rowEvents(row)}
                      onClick={(e) => handleClick(e, row)}
                      onDoubleClick={() => !selectMode && handleDouble(row)}
                      className={`flex w-full items-center gap-3 border-t border-outline-variant/15 px-4 py-2.5 text-left transition-colors active:bg-surface-container max-w-full overflow-hidden ${selectedIds.has(searchRowId(row)) ? "bg-primary-fixed/15" : ""}`}
                    >
                      {selectMode ? <input type="checkbox" tabIndex={-1} checked={selectedIds.has(searchRowId(row))} readOnly className="h-4 w-4 shrink-0 accent-primary" /> : null}
                      <span className="material-symbols-outlined text-[22px] text-primary-container shrink-0">
                        {fileTypeIcon(row.fileType)}
                      </span>
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <div className="truncate font-body text-sm text-on-surface max-w-full">
                          <span className="font-semibold">{humanSize(row.size)}</span>
                          <span className="text-outline"> · </span>
                          <span className="font-medium">{row.filename}</span>
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-label text-[11px] text-on-surface-variant max-w-full overflow-hidden">
                          <span className="min-w-0 max-w-[45vw] truncate">{row.folder || "(root)"}</span>
                          {humanQuality(row.attributes) ? <span>{humanQuality(row.attributes)}</span> : null}
                          {(() => { const qb = qualityBadge(row); return qb ? <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${qb.cls}`}>{qb.label}</span> : null; })()}
                          {humanLength(row.length) ? <span>{humanLength(row.length)}</span> : null}
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
