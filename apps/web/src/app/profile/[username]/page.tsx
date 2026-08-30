"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "@/lib/session";

export default function ProfileRedirect() {
  const params = useParams<{ username: string }>();
  const username = decodeURIComponent(params.username ?? "");
  const { state } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (state.status !== "connected") { router.replace("/"); return; }
    if (username) {
      try {
        const key = "nicotineHub.recentProfiles";
        const raw = (localStorage.getItem(key) ?? localStorage.getItem(key.replace ? key.replace("nicotineHub.", "nicotine.") : key));
        const list: string[] = raw ? JSON.parse(raw) : [];
        const next = [username, ...list.filter((x: string) => x.toLowerCase() !== username.toLowerCase())].slice(0, 20);
        localStorage.setItem(key, JSON.stringify(next));
      } catch {}
      router.replace(`/profile?user=${encodeURIComponent(username)}`);
    } else {
      router.replace("/profile");
    }
  }, [username, state.status, router]);
  return null;
}
