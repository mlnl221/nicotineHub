"use client";

import { useEffect } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useSession } from "@/lib/session";
import { RequireAuth } from "@/components/RequireAuth";

export default function BrowseUserRedirect() {
  return (
    <RequireAuth>
      <BrowseUserInner />
    </RequireAuth>
  );
}

function BrowseUserInner() {
  const params = useParams<{ username: string }>();
  const username = decodeURIComponent(params.username ?? "");
  const { state } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  useEffect(() => {
    if (state.status !== "connected") return;
    if (username) {
      // Persist recent and redirect to tabbed browse with query param
      try {
        const key = "nicotineHub.recentBrowse";
        const raw = (localStorage.getItem(key) ?? localStorage.getItem(key.replace ? key.replace("nicotineHub.", "nicotine.") : key));
        const list: string[] = raw ? JSON.parse(raw) : [];
        const next = [username, ...list.filter((x: string) => x.toLowerCase() !== username.toLowerCase())].slice(0, 20);
        localStorage.setItem(key, JSON.stringify(next));
      } catch {}
      // Preserve ?folder so /browse can preselect it (else the param is dropped)
      const folder = searchParams.get("folder");
      router.replace(`/browse?user=${encodeURIComponent(username)}${folder ? `&folder=${encodeURIComponent(folder)}` : ""}`);
    } else {
      router.replace("/browse");
    }
  }, [username, state.status, router, searchParams]);
  return null;
}
