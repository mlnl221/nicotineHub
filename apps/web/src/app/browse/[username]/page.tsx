"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { Sidebar } from "@/components/Sidebar";
import { useBrowse } from "@/lib/browse";
import { useTransfers } from "@/lib/transfers";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export default function BrowseUserPage() {
  const params = useParams<{ username: string }>();
  const username = decodeURIComponent(params.username ?? "");
  const { state } = useSession();
  const router = useRouter();
  const { loading, error, folders, filteredFolders, currentFolder, currentFiles, query, setQuery, openFolder } =
    useBrowse(username);
  const { requestDownload } = useTransfers();
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  const [fileQuery, setFileQuery] = useState("");

  useEffect(() => {
    if (state.status !== "connected") router.replace("/");
  }, [state.status, router]);

  useEffect(() => {
    if (folders.length && !selectedFolder) setSelectedFolder(folders[0].name);
  }, [folders, selectedFolder]);

  const activeFolder = useMemo(() => {
    if (currentFiles && currentFolder) return { name: currentFolder, files: currentFiles };
    return folders.find((f) => f.name === selectedFolder) || null;
  }, [currentFiles, currentFolder, folders, selectedFolder]);

  const visibleFiles = useMemo(() => {
    if (!activeFolder) return [];
    if (!fileQuery) return activeFolder.files;
    const q = fileQuery.toLowerCase();
    return activeFolder.files.filter((f) => f.name.toLowerCase().includes(q));
  }, [activeFolder, fileQuery]);

  if (state.status !== "connected" || !username) return null;

  const breadcrumbs = selectedFolder ? selectedFolder.split("\\\\").filter(Boolean) : [];
  const totalSize = folders.reduce((acc, f) => acc + f.files.reduce((a, file) => a + (file.size || 0), 0), 0);
  const totalFiles = folders.reduce((acc, f) => acc + f.files.length, 0);

  return (
    <div className="flex min-h-screen bg-background font-body text-on-surface antialiased">
      <Sidebar />
      <main className="ml-72 flex min-h-screen flex-1 flex-col overflow-hidden">
        {/* Header breadcrumbs */}
        <header className="sticky top-0 z-10 border-b border-surface-container-highest/20 bg-surface-container-lowest/80 backdrop-blur-xl px-6 py-4 md:px-8">
          <nav className="flex items-center gap-1 font-body text-xs overflow-x-auto">
            <button onClick={() => router.push("/browse")} className="text-on-surface-variant hover:text-primary whitespace-nowrap">
              Browse
            </button>
            <span className="material-symbols-outlined text-[16px] text-outline-variant">chevron_right</span>
            <span className="font-semibold text-on-surface whitespace-nowrap">{username}</span>
            {selectedFolder ? (
              <>
                <span className="material-symbols-outlined text-[16px] text-outline-variant">chevron_right</span>
                <span className="truncate text-on-surface-variant">{selectedFolder.split("\\\\").pop()}</span>
              </>
            ) : null}
          </nav>
          <div className="mt-3 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <h1 className="font-headline text-2xl font-bold tracking-tight">{username}&apos;s Shares</h1>
              <p className="mt-1 font-body text-xs text-on-surface-variant">
                {loading ? "Loading…" : `${folders.length} folders • ${totalFiles} files • ${formatBytes(totalSize)}`}
                {error ? ` • ${error}` : ""}
              </p>
            </div>
            <div className="flex gap-2">
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[16px] text-outline">search</span>
                <input
                  value={fileQuery}
                  onChange={(e) => setFileQuery(e.target.value)}
                  placeholder="Search files in folder..."
                  className="w-64 rounded-full bg-surface-container-low py-2 pl-9 pr-4 font-body text-sm placeholder:text-outline-variant focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>
          </div>
        </header>

        <div className="flex flex-1 overflow-hidden">
          {/* Folder list — desktop Miller col */}
          <aside className="hidden w-80 flex-shrink-0 flex-col border-r border-surface-container-highest/30 bg-surface-container-lowest md:flex">
            <div className="border-b border-surface-container-highest/20 p-3">
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[18px] text-outline">search</span>
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search folders..."
                  className="w-full rounded-full bg-surface-container-low py-2 pl-9 pr-4 font-body text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {loading && folders.length === 0 ? (
                <div className="space-y-2 p-2">
                  <div className="h-10 animate-pulse rounded-lg bg-surface-container-high" />
                  <div className="h-10 animate-pulse rounded-lg bg-surface-container-high" />
                </div>
              ) : filteredFolders.length === 0 ? (
                <p className="p-4 font-body text-sm text-outline">No folders found.</p>
              ) : (
                filteredFolders.map((f) => (
                  <button
                    key={f.name}
                    onClick={() => {
                      setSelectedFolder(f.name);
                      openFolder(f.name);
                    }}
                    className={`flex w-full items-center gap-3 rounded-lg p-3 text-left transition-colors ${selectedFolder === f.name ? "bg-primary-fixed/20 text-primary border border-primary/10" : "hover:bg-surface-container-low text-on-surface-variant"}`}
                  >
                    <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                      folder
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-body text-sm font-medium">{f.name.split("\\\\").pop() || f.name}</p>
                      <p className="truncate font-label text-[11px] text-on-surface-variant">{f.files.length} files</p>
                    </div>
                  </button>
                ))
              )}
            </div>
          </aside>

          {/* File list + detail */}
          <div className="flex flex-1 flex-col overflow-hidden">
            {/* Mobile folder picker */}
            <div className="border-b border-surface-container-highest/20 bg-surface-container-lowest p-3 md:hidden">
              <select
                value={selectedFolder || ""}
                onChange={(e) => {
                  setSelectedFolder(e.target.value);
                  openFolder(e.target.value);
                }}
                className="w-full rounded-lg bg-surface-container-low px-3 py-2 font-body text-sm"
              >
                {filteredFolders.map((f) => (
                  <option key={f.name} value={f.name}>
                    {f.name} ({f.files.length})
                  </option>
                ))}
              </select>
            </div>

            {loading && !activeFolder ? (
              <div className="flex flex-1 items-center justify-center p-10">
                <div className="text-center">
                  <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  <p className="mt-3 font-body text-sm text-on-surface-variant">Fetching shares from {username}…</p>
                  <p className="mt-1 font-label text-xs text-outline">This can take up to 30s if the peer is behind NAT.</p>
                </div>
              </div>
            ) : error && folders.length === 0 ? (
              <div className="flex flex-1 items-center justify-center p-10">
                <div className="rounded-xl bg-surface-container-lowest p-8 text-center ghost-border">
                  <span className="material-symbols-outlined text-3xl text-error">cloud_off</span>
                  <h3 className="mt-2 font-headline font-semibold">Could not browse {username}</h3>
                  <p className="mt-1 font-body text-sm text-on-surface-variant">{error}</p>
                  <button
                    onClick={() => window.location.reload()}
                    className="mt-4 rounded-full bg-primary px-5 py-2 font-label text-xs font-bold uppercase tracking-widest text-on-primary"
                  >
                    Retry
                  </button>
                </div>
              </div>
            ) : !activeFolder ? (
              <div className="flex flex-1 items-center justify-center p-10 font-body text-sm text-outline">Select a folder to view files.</div>
            ) : (
              <div className="flex flex-1 flex-col overflow-hidden">
                <div className="flex items-center justify-between border-b border-surface-container-highest/20 bg-surface-container-low px-4 py-3">
                  <h2 className="truncate font-label text-xs uppercase tracking-widest text-on-surface font-bold">
                    {activeFolder.name}
                  </h2>
                  <span className="font-label text-xs text-on-surface-variant">{visibleFiles.length} files</span>
                </div>
                <div className="flex-1 overflow-y-auto">
                  {visibleFiles.length === 0 ? (
                    <p className="p-6 font-body text-sm text-outline">
                      No files match &quot;{fileQuery}&quot; in this folder.
                    </p>
                  ) : (
                    <ul className="divide-y divide-surface-container-highest/30">
                      {visibleFiles.map((file) => {
                        const shortName = file.name.split("\\\\").pop() || file.name;
                        return (
                          <li
                            key={file.name}
                            className="flex items-center gap-3 px-4 py-3 hover:bg-surface-container-low/60"
                          >
                            <span className="material-symbols-outlined text-outline text-[20px]">audio_file</span>
                            <div className="min-w-0 flex-1">
                              <p className="truncate font-body text-sm font-medium text-on-surface">{shortName}</p>
                              <p className="font-label text-xs text-on-surface-variant">
                                {formatBytes(file.size)} {file.ext ? `• ${file.ext}` : ""}
                              </p>
                            </div>
                            <button
                              onClick={() => {
                                const virtualPath = `${activeFolder.name}\\\\${shortName}`;
                                // If file.name already contains full path, prefer it
                                const vp = file.name.includes("\\\\") ? file.name : virtualPath;
                                requestDownload({ username, virtualPath: vp, size: file.size, fileName: shortName });
                              }}
                              className="rounded-full bg-primary px-4 py-2 font-label text-xs font-bold text-on-primary hover:bg-primary-container"
                            >
                              Download
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
