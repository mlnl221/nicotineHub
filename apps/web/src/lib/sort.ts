/**
 * Search result ordering. Nicotine-plus defaults to network arrival order and
 * sorts only on header click; we default to best-first (free slots, then
 * fastest peer, then shortest queue) with arrival kept as a mode for parity.
 */
import type { SearchRow } from "@/lib/protocol";

export type SearchSortMode = "best" | "speed" | "queue" | "arrival";

function byName(a: SearchRow, b: SearchRow): number {
  return a.filename.localeCompare(b.filename);
}

export function compareSearchRows(a: SearchRow, b: SearchRow, mode: SearchSortMode): number {
  switch (mode) {
    case "speed":
      return b.speed - a.speed || Number(b.slotFree) - Number(a.slotFree) || a.inQueue - b.inQueue || byName(a, b);
    case "queue":
      return Number(b.slotFree) - Number(a.slotFree) || a.inQueue - b.inQueue || b.speed - a.speed || byName(a, b);
    case "arrival":
      return 0;
    case "best":
    default:
      return Number(b.slotFree) - Number(a.slotFree) || b.speed - a.speed || a.inQueue - b.inQueue || byName(a, b);
  }
}

/** Stable sort; input order is the arrival-order tiebreak. */
export function sortSearchRows(rows: SearchRow[], mode: SearchSortMode): SearchRow[] {
  if (mode === "arrival") return rows.slice();
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => compareSearchRows(a.row, b.row, mode) || a.index - b.index)
    .map(({ row }) => row);
}
