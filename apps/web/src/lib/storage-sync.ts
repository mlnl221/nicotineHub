"use client";

// Cross-tab close sync: `storage` events fire only in OTHER tabs, so the
// writer never echoes. Reconcile is subtractive-only (apply closes, ignore
// opens) — additions propagate on refresh/reconnect as before, and no
// join/refetch storms can start from a sync event.
export function onExternalKey(
  keys: string | readonly string[],
  cb: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const set = new Set(Array.isArray(keys) ? keys : [keys]);
  const onStorage = (e: StorageEvent) => {
    if (e.key && set.has(e.key)) {
      try {
        cb();
      } catch {}
    }
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}
