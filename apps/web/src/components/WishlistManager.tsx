"use client";
import { useState } from "react";
import { useWishlist } from "@/lib/wishlist";
import { useSession } from "@/lib/session";
import { useConfig } from "@/lib/config/provider";

export function WishlistManager() {
  const { terms, addTerm, removeTerm, interval } = useWishlist();
  const { send, state } = useSession();
  const { settings } = useConfig();
  const [input, setInput] = useState("");
  const [autoSearch, setAutoSearch] = useState(true);

  const handleAdd = () => {
    if (!input.trim()) return;
    addTerm(input.trim());
    setInput("");
  };

  const triggerManualSearch = (term: string) => {
    const searchId = `wishlist:${term}:${Date.now()}`;
    send({ type: "search:wishlist", searchId, query: term } as unknown as never);
  };

  return (
    <div className="glass-panel rounded-2xl p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="font-label text-sm font-semibold text-on-surface">Wishlist</h3>
        <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-xs text-on-surface-variant">
          {interval ? `Interval ${Math.round(interval / 60)} min` : terms.length ? "Default 12 min" : "No auto-search"}
        </span>
      </div>

      <div className="mb-3 flex gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="Add wish (e.g. pink floyd - wish you were here)"
          className="flex-1 rounded-xl bg-surface-container-low px-3 py-2 text-sm text-on-surface outline-none focus:ring-1 focus:ring-primary dark:bg-surface-container-high"
        />
        <button onClick={handleAdd} className="rounded-xl bg-primary px-4 py-2 text-sm font-medium text-on-primary">Add</button>
      </div>

      <label className="mb-3 flex items-center gap-2 text-xs text-on-surface-variant">
        <input type="checkbox" checked={autoSearch} onChange={(e) => setAutoSearch(e.target.checked)} />
        Automatic search (bridge cycles one term per interval)
      </label>

      {terms.length === 0 ? (
        <p className="text-xs text-on-surface-variant">No wishes yet. Add a term to auto-search periodically.</p>
      ) : (
        <ul className="space-y-2">
          {terms.map((t) => (
            <li key={t} className="flex items-center justify-between rounded-xl bg-surface-container-low px-3 py-2 dark:bg-surface-container-high">
              <span className="text-sm text-on-surface truncate pr-2">{t}</span>
              <div className="flex gap-1">
                <button
                  onClick={() => triggerManualSearch(t)}
                  disabled={state.status !== "connected"}
                  className="rounded-lg bg-surface-container-high px-2 py-1 text-xs text-on-surface-variant hover:text-primary disabled:opacity-50"
                >
                  Search
                </button>
                <button onClick={() => removeTerm(t)} className="rounded-lg px-2 py-1 text-xs text-error hover:bg-error-container">
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-[11px] text-on-surface-variant">
        Uses <code className="rounded bg-surface-container-high px-1">search:wishlist (103)</code> with server interval <code>WishlistInterval 104</code>. Notifications:{" "}
        {settings.notifications.notification_popup_wish ? "on" : "off"}.
      </p>
    </div>
  );
}
