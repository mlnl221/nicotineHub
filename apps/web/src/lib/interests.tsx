"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import type { Recommendation, SimilarUser, UserInfoEvent } from "@/lib/protocol";

const LIKES_KEY = "nicotine.likes";
const HATES_KEY = "nicotine.hates";

function loadArray(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function useInterests() {
  const { send, subscribe, state } = useSession();
  const [likes, setLikes] = useState<string[]>(() => loadArray(LIKES_KEY));
  const [hates, setHates] = useState<string[]>(() => loadArray(HATES_KEY));
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [similarUsers, setSimilarUsers] = useState<SimilarUser[]>([]);
  const [itemRecommendations, setItemRecommendations] = useState<Recommendation[] | null>(null);
  const [itemSimilarUsers, setItemSimilarUsers] = useState<SimilarUser[] | null>(null);
  const [itemName, setItemName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (state.status !== "connected") return;
    setLoading(true);
    const unsub = subscribe((msg) => {
      if (msg.type !== "userinfo:event") return;
      const ev: UserInfoEvent = msg.event;
      switch (ev.type) {
        case "recommendations":
        case "global-recommendations":
          if (ev.recommendations) {
            setRecommendations(ev.recommendations);
            setLoading(false);
          }
          break;
        case "similar-users":
          if (ev.similarUsers) {
            setSimilarUsers(ev.similarUsers);
          }
          break;
        case "item-recommendations":
          if (ev.recommendations && itemName) {
            setItemRecommendations(ev.recommendations);
          }
          break;
        case "item-similar-users":
          if (ev.similarUsers && itemName) {
            setItemSimilarUsers(ev.similarUsers);
          }
          break;
        default:
          break;
      }
    });
    // initial fetch
    if (likes.length === 0) send({ type: "userinfo", action: "globalRecommendations" });
    else {
      send({ type: "userinfo", action: "recommendations" });
      send({ type: "userinfo", action: "similarUsers" });
    }
    return () => {
      unsub();
    };
  }, [state.status, subscribe, send, likes.length, itemName]);

  useEffect(() => {
    try {
      localStorage.setItem(LIKES_KEY, JSON.stringify(likes));
    } catch {}
  }, [likes]);
  useEffect(() => {
    try {
      localStorage.setItem(HATES_KEY, JSON.stringify(hates));
    } catch {}
  }, [hates]);

  const addLike = useCallback(
    (thing: string) => {
      const t = thing.trim();
      if (!t || likes.includes(t)) return;
      setLikes((prev) => [...prev, t]);
      send({ type: "userinfo", action: "addLike", thing: t });
      // refresh recs after adding
      setTimeout(() => {
        send({ type: "userinfo", action: "recommendations" });
        send({ type: "userinfo", action: "similarUsers" });
      }, 300);
    },
    [likes, send],
  );
  const removeLike = useCallback(
    (thing: string) => {
      setLikes((prev) => prev.filter((x) => x !== thing));
      send({ type: "userinfo", action: "removeLike", thing });
      setTimeout(() => {
        if (likes.length <= 1) send({ type: "userinfo", action: "globalRecommendations" });
        else send({ type: "userinfo", action: "recommendations" });
      }, 300);
    },
    [likes.length, send],
  );
  const addHate = useCallback(
    (thing: string) => {
      const t = thing.trim();
      if (!t || hates.includes(t)) return;
      setHates((prev) => [...prev, t]);
      send({ type: "userinfo", action: "addHate", thing: t });
    },
    [hates, send],
  );
  const removeHate = useCallback(
    (thing: string) => {
      setHates((prev) => prev.filter((x) => x !== thing));
      send({ type: "userinfo", action: "removeHate", thing });
    },
    [send],
  );

  const refresh = useCallback(() => {
    setLoading(true);
    if (likes.length === 0) send({ type: "userinfo", action: "globalRecommendations" });
    else {
      send({ type: "userinfo", action: "recommendations" });
      send({ type: "userinfo", action: "similarUsers" });
    }
    setTimeout(() => setLoading(false), 2000);
  }, [likes.length, send]);

  const fetchItemDetails = useCallback(
    (item: string) => {
      setItemName(item);
      setItemRecommendations(null);
      setItemSimilarUsers(null);
      send({ type: "userinfo", action: "itemRecommendations", item });
      send({ type: "userinfo", action: "itemSimilarUsers", item });
    },
    [send],
  );

  const clearItem = useCallback(() => {
    setItemName(null);
    setItemRecommendations(null);
    setItemSimilarUsers(null);
  }, []);

  return {
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
  };
}
