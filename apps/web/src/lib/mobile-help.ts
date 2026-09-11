// Pure mobile-compactness rules (react-free so bun:test can import them).
// Scope select is the sole setMode path in SearchBar — never strand mobile
// users in global (non-global modes need the row for target inputs too).
export function scopeRowVisible(mode: string, scopeOpen: boolean): boolean {
  return mode !== "global" || scopeOpen;
}

// Single collapsible wishlist: one mounted instance, CSS show/hide only, so
// the draft input survives toggling and breakpoint resizes. Desktop starts open.
export function wishlistDefaultOpen(viewportWidth: number): boolean {
  return viewportWidth >= 768;
}
