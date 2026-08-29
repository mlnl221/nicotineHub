import * as Comlink from "comlink";
import { applyFilters } from "./filter";
import type { FilterState, SearchRow } from "./protocol";

export const filterWorker = {
  apply(rows: SearchRow[], f: FilterState): SearchRow[] {
    return applyFilters(rows, f);
  },
};

Comlink.expose(filterWorker);
