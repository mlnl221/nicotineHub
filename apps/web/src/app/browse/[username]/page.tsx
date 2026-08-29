"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "@/lib/session";

export default function BrowseUserRedirect() {
  const params = useParams<{ username: string }>();
  const username = decodeURIComponent(params.username ?? "");
  const { state } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (state.status !== "connected") { router.replace("/"); return; }
    if (username) {
      // Persist recent and redirect to tabbed browse with query param
      try {
        const key = "nicotine.recentBrowse";
        const raw = localStorage.getItem(key);
        const list: string[] = raw ? JSON.parse(raw) : [];
        const next = [username, ...list.filter((x: string) => x.toLowerCase() !== username.toLowerCase())].slice(0, 20);
        localStorage.setItem(key, JSON.stringify(next));
      } catch {}
      router.replace(`/browse?user=${encodeURIComponent(username)}`);
    } else {
      router.replace("/browse");
    }
  }, [username, state.status, router]);
  return null;
}
