/**
 * Deep-merges a partial (persisted) object over a base one. Leaves values from
 * the base for any keys missing in the patch, and merges nested objects. This
 * mirrors Nicotine+ `config.py` `_set_config` behaviour so unknown or newer
 * keys always fall back to sane defaults.
 */
export function deepMerge<T>(base: T, patch: unknown): T {
  if (
    patch === null ||
    patch === undefined ||
    typeof patch !== "object" ||
    typeof base !== "object" ||
    Array.isArray(patch)
  ) {
    return (patch === undefined ? base : (patch as T));
  }

  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const key of Object.keys(patch as Record<string, unknown>)) {
    out[key] = deepMerge(out[key], (patch as Record<string, unknown>)[key]);
  }
  return out as T;
}
