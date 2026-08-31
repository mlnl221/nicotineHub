"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/mobile/TopBar";
import { BottomNav } from "@/components/mobile/BottomNav";
import { useInterests } from "@/lib/interests";
import { useWishlist } from "@/lib/wishlist";
import { ContextMenu } from "@/components/ui/ContextMenu";
import { interestsMenu, interestsRecMenu, userMenu } from "@/lib/context-menu/menus";

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
  const { addTerm } = useWishlist();
  const [likeInput, setLikeInput] = useState("");
  const [hateInput, setHateInput] = useState("");
  const [showItemModal, setShowItemModal] = useState(false);
  const [menuAnchor, setMenuAnchor] = useState<{ x: number; y: number; thing: string; type: "like" | "hate" | "rec" | "similar" } | null>(null);

  useEffect(() => {
    if (state.status === "failed") router.replace("/");
  }, [state.status, router]);

  useEffect(() => {
    if (itemName) setShowItemModal(true);
  }, [itemName]);

  if (state.status === "idle" || state.status === "connecting") return <div className="flex h-screen items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
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
    <div className="flex min-h-screen bg-surface-dim font-body text-on-surface antialiased dark:bg-inverse-surface">
      <Sidebar />
      <TopBar title="Interests" subtitle={`${likes.length} likes • ${hates.length} dislikes`} />
      <main className="md:ml-72 flex min-h-screen flex-1 flex-col bg-surface-dim dark:bg-inverse-surface pt-[calc(60px+env(safe-area-inset-top,0px))] md:pt-0 pb-[calc(64px+env(safe-area-inset-bottom,0px))] md:pb-0 overflow-x-hidden max-w-full">
        <header className="hidden md:flex sticky top-0 z-30 bg-surface-bright/80 dark:bg-surface-container-lowest/80 backdrop-blur-xl px-4 md:px-10 py-4 md:py-8 flex-col md:flex-row md:justify-between md:items-end gap-3 md:gap-4 border-b border-outline-variant/10">
          <div>
            <h2 className="hidden md:block font-headline text-3xl font-bold text-on-surface dark:text-on-surface tracking-tight">Interests</h2>
            <p className="font-body text-on-surface-variant dark:text-outline text-xs md:text-sm mt-1">{likes.length} likes • {hates.length} dislikes • Recommendations shape your discovery</p>
          </div>
          <div className="flex items-center gap-2 md:gap-4">
            <Link href="/settings?tab=user-profile#user-profile" className="hidden md:flex bg-primary-container text-on-primary-container p-2 rounded-lg hover:bg-primary hover:text-on-primary transition-colors items-center justify-center" aria-label="Profile settings">
              <span className="material-symbols-outlined">settings</span>
            </Link>
          </div>
        </header>
        <div className="flex w-full max-w-screen-2xl flex-1 flex-col gap-8 md:gap-12 px-4 sm:px-6 py-6 md:py-12 md:px-10 lg:flex-row max-w-full overflow-hidden">
          {/* Left Column */}
          <div className="flex flex-1 flex-col space-y-8 md:space-y-12">
            <div className="space-y-2">
              <div className="flex items-center space-x-3">
                <span className="material-symbols-outlined text-primary text-2xl">interests</span>
                <h3 className="font-headline text-xl font-bold tracking-tight text-on-surface">Your Interests</h3>
              </div>
              <p className="max-w-2xl font-body text-sm leading-relaxed text-on-surface-variant">
                Add things you like and dislike. Your likes and dislikes affect the recommendations you receive and help you find similar users — just like in Nicotine+.
              </p>
            </div>

            <div className="grid grid-cols-1 gap-6 md:gap-8 md:grid-cols-2">
              {/* Likes */}
              <section className="relative overflow-hidden rounded-xl bg-surface-container-lowest p-6 md:p-8 shadow-sm ring-1 ring-outline-variant/15">
                <div className="absolute inset-0 bg-gradient-to-b from-transparent to-surface-container-low/50 pointer-events-none" />
                <div className="relative flex items-center justify-between border-b border-surface-container-highest pb-4 mb-6">
                  <h2 className="flex items-center font-headline text-lg md:text-xl font-semibold text-on-surface">
                    <span className="material-symbols-outlined mr-2 text-primary" style={{ fontVariationSettings: "'FILL' 1" }}>
                      add_circle
                    </span>
                    I Like
                  </h2>
                  <span className="font-label text-xs uppercase tracking-widest text-outline">Likes</span>
                </div>
                <div className="relative flex flex-wrap gap-2.5">
                  {likes.length === 0 ? (
                    <p className="font-body text-sm text-outline">No likes yet. Add one below — e.g. an artist, genre, or tag.</p>
                  ) : (
                    likes.map((thing) => (
                      <div
                        key={thing}
                        role="button"
                        tabIndex={0}
                        onClick={() => fetchItemDetails(thing)}
                        onKeyDown={(e) => e.key === "Enter" && fetchItemDetails(thing)}
                        className="chip flex cursor-pointer items-center rounded-full border border-primary/20 bg-primary text-on-primary px-5 py-2.5 min-h-9 font-label text-sm gap-1.5 shadow-[0_2px_8px_rgba(9,76,178,0.15)] transition-all active:scale-95 hover:opacity-90"
                        title="Tap for recommendations. Long-press to remove."
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setMenuAnchor({ x: e.clientX, y: e.clientY, thing, type: "like" });
                        }}
                      >
                        <span>{thing}</span>
                        <button
                          type="button"
                          aria-label="Remove like"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeLike(thing);
                          }}
                          className="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/20 -mr-1 hover:bg-white/30"
                        >
                          <span className="material-symbols-outlined text-[14px]">close</span>
                        </button>
                      </div>
                    ))
                  )}
                  <button
                    onClick={() => document.getElementById("like-input")?.focus()}
                    className="hidden"
                    aria-hidden
                  />
                  <div className="mt-3 flex w-full items-center gap-0 min-w-0 overflow-hidden">
                    <input
                      id="like-input"
                      value={likeInput}
                      onChange={(e) => setLikeInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleLikeAdd()}
                      placeholder="Add a like…"
                      className="flex-1 min-w-0 w-auto rounded-l-full border border-outline-variant/30 bg-surface-container-lowest px-4 py-2.5 min-h-11 font-body text-sm text-on-surface placeholder:text-outline-variant focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                    />
                    <button
                      onClick={handleLikeAdd}
                      className="shrink-0 rounded-r-full bg-primary px-5 py-2.5 min-h-11 text-on-primary transition-colors hover:bg-primary-container active:scale-95"
                    >
                      <span className="material-symbols-outlined text-[18px]">add</span>
                    </button>
                  </div>
                </div>
              </section>

              {/* Hates */}
              <section className="relative overflow-hidden rounded-xl bg-surface-container-lowest p-6 md:p-8 shadow-sm ring-1 ring-outline-variant/15">
                <div className="absolute inset-0 bg-gradient-to-b from-transparent to-surface-container-low/50 pointer-events-none" />
                <div className="relative flex items-center justify-between border-b border-surface-container-highest pb-4 mb-6">
                  <h2 className="flex items-center font-headline text-lg md:text-xl font-semibold text-on-surface">
                    <span className="material-symbols-outlined mr-2 text-error" style={{ fontVariationSettings: "'FILL' 1" }}>
                      do_not_disturb_on
                    </span>
                    I Dislike
                  </h2>
                  <span className="font-label text-xs uppercase tracking-widest text-outline">Dislikes</span>
                </div>
                <div className="relative flex flex-wrap gap-2.5">
                  {hates.length === 0 ? (
                    <p className="font-body text-sm text-outline">No dislikes yet. Add one below.</p>
                  ) : (
                    hates.map((thing) => (
                      <div
                        key={thing}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setMenuAnchor({ x: e.clientX, y: e.clientY, thing, type: "hate" });
                        }}
                        className="chip flex cursor-pointer items-center rounded-full border border-error/20 bg-error-container text-on-error-container px-4 py-2 min-h-9 font-label text-xs gap-1.5 opacity-90"
                      >
                        <span>{thing}</span>
                        <button
                          type="button"
                          aria-label="Remove dislike"
                          onClick={() => removeHate(thing)}
                          className="ml-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-black/10 -mr-1 hover:bg-black/20"
                        >
                          <span className="material-symbols-outlined text-[14px]">close</span>
                        </button>
                      </div>
                    ))
                  )}
                  <div className="mt-3 flex w-full items-center gap-0 min-w-0 overflow-hidden">
                    <input
                      value={hateInput}
                      onChange={(e) => setHateInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleHateAdd()}
                      placeholder="Add a dislike…"
                      className="flex-1 min-w-0 w-auto rounded-l-full border border-outline-variant/30 bg-surface-container-lowest px-4 py-2.5 min-h-11 font-body text-sm text-on-surface placeholder:text-outline-variant focus:border-error focus:ring-1 focus:ring-error outline-none"
                    />
                    <button
                      onClick={handleHateAdd}
                      className="shrink-0 rounded-r-full bg-surface-container-high px-5 py-2.5 min-h-11 text-error transition-colors hover:bg-error hover:text-on-error active:scale-95"
                    >
                      <span className="material-symbols-outlined text-[18px]">add</span>
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
                <div className="mt-4 flex flex-wrap gap-2">
                  <button
                    onClick={() => {
                      const q = itemName;
                      router.push(`/search?q=${encodeURIComponent(q)}`);
                    }}
                    className="rounded-lg bg-surface-container-high px-4 py-2.5 min-h-9 font-label text-xs uppercase tracking-widest hover:bg-surface-variant"
                  >
                    Search for Item
                  </button>
                  <button
                    onClick={() => addLike(itemName)}
                    className="rounded-lg bg-primary px-4 py-2.5 min-h-9 font-label text-xs font-semibold uppercase tracking-widest text-on-primary"
                  >
                    I Like This
                  </button>
                  <button
                    onClick={() => addHate(itemName)}
                    className="rounded-lg bg-surface-container-high px-4 py-2.5 min-h-9 font-label text-xs uppercase tracking-widest text-error"
                  >
                    I Dislike
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Right Column: Recommendations Panel */}
          <aside className="w-full lg:w-96 flex-shrink-0 max-w-full overflow-hidden">
            <div className="lg:sticky lg:top-6 rounded-xl bg-surface-container-lowest md:bg-surface-container-low/60 p-6 md:p-8 backdrop-blur-sm ghost-border max-w-full overflow-hidden">
              <div className="mb-4 flex items-center justify-between">
                <h3 className="font-headline text-xl font-semibold text-on-surface">Recommendations</h3>
                <span className="material-symbols-outlined text-tertiary">auto_awesome</span>
              </div>
              <p className="mb-6 border-b border-surface-container-highest pb-2 font-label text-xs uppercase tracking-widest text-on-surface-variant">
                {likes.length === 0 ? "Global recommendations" : "Based on your likes"}
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
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setMenuAnchor({ x: e.clientX, y: e.clientY, thing: r.thing, type: "rec" });
                      }}
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
                        onClick={() => router.push(`/profile/${encodeURIComponent(u.username)}`)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          setMenuAnchor({ x: e.clientX, y: e.clientY, thing: u.username, type: "similar" });
                        }}
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
                className="mt-8 w-full rounded-full bg-surface-container-highest py-3 font-label text-sm font-semibold text-on-surface hover:bg-surface-variant transition-colors active:scale-95"
              >
                Refresh Recommendations
              </button>
            </div>
          </aside>
        </div>
      </main>
      <BottomNav />
      {menuAnchor ? (
        <ContextMenu
          x={menuAnchor.x}
          y={menuAnchor.y}
          items={
            menuAnchor.type === "like"
              ? interestsMenu(menuAnchor.thing, {
                  onRecommend: () => fetchItemDetails(menuAnchor.thing),
                  onSearch: () => router.push(`/search?q=${encodeURIComponent(menuAnchor.thing)}`),
                  onRemove: () => removeLike(menuAnchor.thing),
                  onWishlist: () => addTerm(menuAnchor.thing),
                })
              : menuAnchor.type === "hate"
                ? interestsMenu(menuAnchor.thing, {
                    onRecommend: () => fetchItemDetails(menuAnchor.thing),
                    onSearch: () => router.push(`/search?q=${encodeURIComponent(menuAnchor.thing)}`),
                    onRemove: () => removeHate(menuAnchor.thing),
                    onWishlist: () => addTerm(menuAnchor.thing),
                  })
                : menuAnchor.type === "rec"
                  ? interestsRecMenu(
                      menuAnchor.thing,
                      likes.includes(menuAnchor.thing),
                      hates.includes(menuAnchor.thing),
                      {
                        onLike: () => addLike(menuAnchor.thing),
                        onDislike: () => addHate(menuAnchor.thing),
                        onRecommend: () => fetchItemDetails(menuAnchor.thing),
                        onSearch: () => router.push(`/search?q=${encodeURIComponent(menuAnchor.thing)}`),
                        onWishlist: () => addTerm(menuAnchor.thing),
                      }
                    )
                  : userMenu(menuAnchor.thing, "interests")
          }
          onClose={() => setMenuAnchor(null)}
        />
      ) : null}
    </div>
  );
}
