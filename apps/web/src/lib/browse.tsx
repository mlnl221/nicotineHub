"use client";

import { useCallback, useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import type { BrowseFolder, BrowseFile } from "@/lib/protocol";

export interface BrowseState {
  loading: boolean;
  error: string | null;
  folders: BrowseFolder[];
  currentFolder: string | null;
  currentFiles: BrowseFile[] | null;
  query: string;
}

export function useBrowse(username: string) {
  const { send, subscribe, state } = useSession();
  const [browse, setBrowse] = useState<BrowseState>({
    loading: true,
    error: null,
    folders: [],
    currentFolder: null,
    currentFiles: null,
    query: "",
  });

  useEffect(() => {
    if (!username || state.status !== "connected") return;
    setBrowse((s) => ({ ...s, loading: true, error: null }));
    const unsub = subscribe((msg) => {
      const rawType = (msg as unknown as { type: string }).type;
      const isShares = rawType === "browse:shares" || rawType === "browse-error";
      const isFolder = rawType === "browse:folder";
      const isLegacyFolderErr = rawType === "browse-error" && (msg as unknown as { token?: number }).token !== undefined;
      if (isShares && !isLegacyFolderErr) {
        const m = msg as unknown as { username: string; folders: BrowseFolder[]; error?: string };
        if (m.username.toLowerCase() !== username.toLowerCase()) return;
        const hasError = !!m.error || rawType === "browse-error";
        const errMsg = m.error || (rawType === "browse-error" ? "Timed out fetching shares" : undefined);
        if (hasError) {
          setBrowse((s) => ({ ...s, loading: false, error: errMsg || "Failed to fetch shares" }));
        } else setBrowse((s) => ({ ...s, loading: false, folders: m.folders || [], error: null }));
      } else if (isFolder || isLegacyFolderErr) {
        const m = msg as unknown as { username: string; folder: string; token: number; files: BrowseFile[]; error?: string };
        if (m.username.toLowerCase() !== username.toLowerCase()) return;
        const hasError = !!m.error || isLegacyFolderErr;
        if (hasError) setBrowse((s) => ({ ...s, error: m.error || "Failed to fetch folder" }));
        else setBrowse((s) => ({ ...s, currentFolder: m.folder, currentFiles: m.files }));
      }
    });
    send({ type: "browse", action: "shares", username });
    const timer = setTimeout(() => {
      setBrowse((s) => {
        if (!s.loading) return s;
        if (s.folders.length) return { ...s, loading: false, error: null };
        return { ...s, loading: false, error: "Timed out — user may be offline or not sharing." };
      });
    }, 32000);
    return () => {
      clearTimeout(timer);
      unsub();
    };
  }, [username, state.status, send, subscribe]);

  const openFolder = useCallback(
    (folder: string) => {
      setBrowse((s) => ({ ...s, currentFolder: folder, currentFiles: null }));
      send({ type: "browse", action: "folder", username, folder });
    },
    [username, send],
  );

  const setQuery = useCallback((q: string) => {
    setBrowse((s) => ({ ...s, query: q }));
  }, []);

  const filteredFolders = browse.query
    ? browse.folders.filter(
        (f) =>
          f.name.toLowerCase().includes(browse.query.toLowerCase()) ||
          f.files.some((file) => file.name.toLowerCase().includes(browse.query.toLowerCase())),
      )
    : browse.folders;

  return { ...browse, filteredFolders, openFolder, setQuery, setBrowse };
}
