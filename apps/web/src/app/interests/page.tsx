"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { Sidebar } from "@/components/Sidebar";
import { useInterests } from "@/lib/interests";
import { useRouter as NavRouter } from "next/navigation";

export default function InterestsPage() {
  const { state } = useSession();
  const router = useRouter();
  const {
    likes,
    hates,
    recommendations,
    similarUsers,
    itemRecommendations,
    itemSimilarUsers,
    itemName,
    loading,
    addLike,
    removeLike,
    addHate,
    removeHate,
    refresh,
    fetchItemDetails,
    clearItem,
  } = useInterests();
  const [likeInput, setLikeInput] = useState("");
  const [hateInput, setHateInput] = useState("");
  const [showItemModal, setShowItemModal] = useState(false);

  useEffect(() => {
    if (state.status !== "connected") router.replace("/");
  }, [state.status, router]);

  useEffect(() => {
    if (itemName) setShowItemModal(true);
  }, [itemName]);

  if (state.status !== "connected") return null;

  const handleLikeAdd = () => {
    if (likeInput.trim()) {
      addLike(likeInput.trim());
      setLikeInput("");
    }
  };
  const handleHateAdd = () => {
    if (hateInput.trim()) {
      addHate(hateInput.trim());
      setHateInput("");
    }
  };

  return (
    <div className="flex min-h-screen bg-background font-body text-on-surface antialiased">
      <Sidebar />
      <main className="ml-72 flex min-h-screen flex-1 flex-col">
        <div className="flex w-full max-w-screen-2xl flex-1 flex-col gap-12 px-6 py-12 md:px-10 lg:flex-row">
          {/* Left Column: Interests Matrix */}
          <div className="flex flex-1 flex-col space-y-12">
            <header className="space-y-4">
              <div className="flex items-center space-x-3">
                <span className="material-symbols-outlined text-tertiary text-3xl">account_tree</span>
                <h1 className="font-headline text-4xl font-light tracking-tight text-on-surface">Affinity Matrix</h1>
              </div>
              <p className="max-w-2xl font-body text-lg leading-relaxed text-on-surface-variant">
                Curate your scholarly profile. These semantic vectors inform your discovery algorithms and peer-to-peer
                network routing.
              </p>
            </header>

            <div className="grid grid-cols-1 gap-8 md:grid-cols-2">
              {/* Likes */}
              <section className="relative overflow-hidden rounded-xl bg-surface-container-lowest p-8 shadow-sm ring-1 ring-outline-variant/15">
                <div className="absolute inset-0 bg-gradient-to-b from-transparent to-surface-container-low/50 pointer-events-none" />
                <div className="relative flex items-center justify-between border-b border-surface-container-highest pb-4 mb-6">
                  <h2 className="flex items-center font-headline text-xl font-medium text-on-surface">
                    <span className="material-symbols-outlined mr-2 text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>
                      add_circle
                    </span>
                    Vectors of Interest
                  </h2>
                  <span className="font-label text-xs uppercase tracking-widest text-outline">Positive</span>
                </div>
                <div className="relative flex flex-wrap gap-3">
                  {likes.length === 0 ? (
                    <p className="font-body text-sm text-outline">No interests yet. Add one below.</p>
                  ) : (
                    likes.map((thing) => (
                      <button
                        key={thing}
                        onClick={() => fetchItemDetails(thing)}
                        className="chip flex cursor-pointer items-center rounded-lg border border-primary/20 bg-surface-container-low px-4 py-2 font-body text-sm text-on-surface transition-all hover:-translate-y-0.5"
                        title="Click for recommendations for this item. Long-press to remove."
                        onContextMenu={(e) => {
                          e.preventDefault();
                          removeLike(thing);
                        }}
                      >
                        <span>{thing}</span>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={(e) => {
                            e.stopPropagation();
                            removeLike(thing);
                          }}
                          onKeyDown={(e) => e.key === "Enter" && removeLike(thing)}
                          className="material-symbols-outlined ml-2 text-sm text-primary"
                        >
                          close
                        </span>
                      </button>
                    ))
                  )}
                  <div className="mt-4 flex w-full items-center">
                    <input
                      value={likeInput}
                      onChange={(e) => setLikeInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleLikeAdd()}
                      placeholder="Add semantic vector..."
                      className="w-full rounded-l-lg border border-outline-variant/30 bg-surface-container-lowest px-4 py-2 font-body text-sm text-on-surface placeholder:text-outline-variant focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                    />
                    <button
                      onClick={handleLikeAdd}
                      className="rounded-r-lg bg-primary px-4 py-2 text-on-primary transition-colors hover:bg-primary-container"
                    >
                      <span className="material-symbols-outlined text-sm">add</span>
                    </button>
                  </div>
                </div>
              </section>

              {/* Hates */}
              <section className="relative overflow-hidden rounded-xl bg-surface-container-lowest p-8 shadow-sm ring-1 ring-outline-variant/15">
                <div className="absolute inset-0 bg-gradient-to-b from-transparent to-surface-container-low/50 pointer-events-none" />
                <div className="relative flex items-center justify-between border-b border-surface-container-highest pb-4 mb-6">
                  <h2 className="flex items-center font-headline text-xl font-medium text-on-surface">
                    <span className="material-symbols-outlined mr-2 text-error" style={{ fontVariationSettings: "'FILL' 1" }}>
                      do_not_disturb_on
                    </span>
                    Excluded Nodes
                  </h2>
                  <span className="font-label text-xs uppercase tracking-widest text-outline">Negative</span>
                </div>
                <div className="relative flex flex-wrap gap-3">
                  {hates.length === 0 ? (
                    <p className="font-body text-sm text-outline">No exclusions. Add one below.</p>
                  ) : (
                    hates.map((thing) => (
                      <div
                        key={thing}
                        className="chip flex cursor-pointer items-center rounded-lg border border-error/20 bg-surface-container-low px-4 py-2 font-body text-sm text-on-surface opacity-80"
                      >
                        <strike className="text-on-surface-variant">{thing}</strike>
                        <span
                          role="button"
                          tabIndex={0}
                          onClick={() => removeHate(thing)}
                          onKeyDown={(e) => e.key === "Enter" && removeHate(thing)}
                          className="material-symbols-outlined ml-2 text-sm text-error"
                        >
                          close
                        </span>
                      </div>
                    ))
                  )}
                  <div className="mt-4 flex w-full items-center">
                    <input
                      value={hateInput}
                      onChange={(e) => setHateInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleHateAdd()}
                      placeholder="Add exclusion vector..."
                      className="w-full rounded-l-lg border border-outline-variant/30 bg-surface-container-lowest px-4 py-2 font-body text-sm text-on-surface placeholder:text-outline-variant focus:border-error focus:ring-1 focus:ring-error outline-none"
                    />
                    <button
                      onClick={handleHateAdd}
                      className="rounded-r-lg bg-surface-container-high px-4 py-2 text-error transition-colors hover:bg-error hover:text-on-error"
                    >
                      <span className="material-symbols-outlined text-sm">add</span>
                    </button>
                  </div>
                </div>
              </section>
            </div>

            {/* Item drill-down inline */}
            {itemName && (
              <div className="rounded-xl bg-surface-container-low p-6 ghost-border">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="font-headline text-lg font-semibold">For &quot;{itemName}&quot;</h3>
                  <button onClick={clearItem} className="p-2 rounded-full hover:bg-surface-container-high">
                    <span className="material-symbols-outlined text-sm">close</span>
                  </button>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <h4 className="font-label text-xs uppercase tracking-widest text-on-surface-variant mb-3">Item Recommendations</h4>
                    {itemRecommendations === null ? (
                      <p className="text-sm text-outline">Loading…</p>
                    ) : itemRecommendations.length === 0 ? (
                      <p className="text-sm text-outline">No recommendations for this item.</p>
                    ) : (
                      <ul className="space-y-2">
                        {itemRecommendations.slice(0, 8).map((r) => (
                          <li key={r.thing} className="flex items-center justify-between rounded-lg bg-surface-container-lowest p-3 text-sm">
                            <span className="font-medium truncate">{r.thing}</span>
                            <span className="ml-2 text-xs font-label bg-tertiary/10 text-tertiary px-2 py-0.5 rounded">{r.rating}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div>
                    <h4 className="font-label text-xs uppercase tracking-widest text-on-surface-variant mb-3">Users who like this</h4>
                    {itemSimilarUsers === null ? (
                      <p className="text-sm text-outline">Loading…</p>
                    ) : itemSimilarUsers.length === 0 ? (
                      <p className="text-sm text-outline">No users found.</p>
                    ) : (
                      <ul className="space-y-2">
                        {itemSimilarUsers.slice(0, 8).map((u) => (
                          <li key={u.username} className="flex items-center justify-between rounded-lg bg-surface-container-lowest p-3 text-sm">
                            <span className="font-medium truncate">{u.username}</span>
                            <span className="text-xs text-on-surface-variant">{u.rating}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
                <div className="mt-4 flex gap-2">
                  <button
                    onClick={() => {
                      const q = itemName;
                      window.location.href = `/search?q=${encodeURIComponent(q)}`;
                    }}
                    className="rounded-lg bg-surface-container-high px-4 py-2 font-label text-xs uppercase tracking-widest hover:bg-surface-variant"
                  >
                    Search for Item
                  </button>
                  <button
                    onClick={() => addLike(itemName)}
                    className="rounded-lg bg-primary px-4 py-2 font-label text-xs font-semibold uppercase tracking-widest text-on-primary"
                  >
                    I Like This
                  </button>
                  <button
                    onClick={() => addHate(itemName)}
                    className="rounded-lg bg-surface-container-high px-4 py-2 font-label text-xs uppercase tracking-widest text-error"
                  >
                    I Dislike
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Recommendations Panel */}
          <aside className="w-full lg:w-96 flex-shrink-0">
            <div className="sticky top-6 rounded-xl bg-surface-container-low/60 p-8 backdrop-blur-sm ghost-border">
              <div className="mb-6 flex items-center justify-between">
                <h3 className="font-headline text-xl font-medium text-on-surface">Curated Discoveries</h3>
                <span className="material-symbols-outlined text-tertiary">auto_awesome</span>
              </div>
              <p className="mb-6 border-b border-surface-container-highest pb-2 font-label text-xs uppercase tracking-widest text-on-surface-variant">
                {likes.length === 0 ? "Popular Interests" : "Based on Affinity Vectors"}
              </p>

              {loading ? (
                <div className="space-y-3">
                  <div className="h-12 animate-pulse rounded-lg bg-surface-container-high" />
                  <div className="h-12 animate-pulse rounded-lg bg-surface-container-high" />
                </div>
              ) : recommendations.length === 0 ? (
                <p className="font-body text-sm text-on-surface-variant">
                  No recommendations yet. Add some likes to get personalized suggestions.
                </p>
              ) : (
                <div className="space-y-6 max-h-[45vh] overflow-y-auto pr-2">
                  {recommendations.slice(0, 12).map((r) => (
                    <div
                      key={r.thing}
                      className="group flex cursor-pointer items-start space-x-4"
                      onClick={() => fetchItemDetails(r.thing)}
                    >
                      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-surface-container-high group-hover:bg-primary-container transition-colors">
                        <span className="material-symbols-outlined text-sm text-on-surface-variant group-hover:text-on-primary-container">
                          interests
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <h4 className="truncate font-body text-sm font-semibold text-on-surface group-hover:text-primary">{r.thing}</h4>
                        <div className="mt-2 flex items-center space-x-2">
                          <span className="rounded bg-tertiary/10 px-2 py-0.5 font-label text-[10px] text-tertiary">{r.rating}</span>
                          <span className="font-label text-[10px] text-outline">tap for details</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <div className="mt-8 border-t border-surface-container-highest pt-6">
                <h4 className="font-label text-xs uppercase tracking-widest text-on-surface-variant mb-3">Similar Users</h4>
                {similarUsers.length === 0 ? (
                  <p className="font-body text-sm text-outline">No similar users yet.</p>
                ) : (
                  <ul className="space-y-2 max-h-[30vh] overflow-y-auto pr-2">
                    {similarUsers.slice(0, 10).map((u) => (
                      <li
                        key={u.username}
                        onClick={() => (window.location.href = `/profile/${encodeURIComponent(u.username)}`)}
                        className="flex cursor-pointer items-center justify-between rounded-lg bg-surface-container-lowest p-3 hover:bg-surface-container-high transition-colors"
                      >
                        <span className="font-body text-sm font-medium truncate">{u.username}</span>
                        <span className="ml-2 rounded bg-surface-container-high px-2 py-0.5 font-label text-[10px]">{u.rating}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <button
                onClick={refresh}
                className="mt-8 w-full rounded-lg bg-surface-container-highest py-3 font-label text-sm text-on-surface hover:bg-surface-variant transition-colors"
              >
                Refresh Discovery Algorithm
              </button>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
}
