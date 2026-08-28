"use client";

import { useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { Sidebar } from "@/components/Sidebar";
import { SearchHeader } from "@/components/SearchHeader";
import { SearchBar } from "@/components/SearchBar";
import { ResultCard, fileToCard, type ResultCardProps } from "@/components/ResultCard";

const TRENDING: ResultCardProps[] = [
  {
    icon: "audio_file",
    badge: "FLAC",
    title: "Archival Symphony Collection Vol. 1",
    description: "High-fidelity orchestral recordings from the central European hub.",
    meta: [
      { label: "Peers", value: "245" },
      { label: "Size", value: "1.2 GB" },
      { label: "Bitrate", value: "1411 kbps" },
    ],
  },
  {
    icon: "video_file",
    badge: "MKV",
    title: "Cyberpunk Documentary 2044",
    description: "A deep dive into the underground tech scene. 4K HDR release.",
    meta: [
      { label: "Peers", value: "892" },
      { label: "Size", value: "14.5 GB" },
      { label: "Quality", value: "2160p" },
    ],
  },
  {
    icon: "developer_mode",
    badge: "ISO",
    title: "Nicotine+ NodeOS v4.2",
    description: "Latest stable release of the decentralized operating system for homelabs.",
    meta: [
      { label: "Peers", value: "1,402" },
      { label: "Size", value: "4.8 GB" },
      { label: "Verified", value: "Yes" },
    ],
  },
];

export default function SearchPage() {
  const { state } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (state.status !== "connected") router.replace("/");
  }, [state.status, router]);

  const liveFiles = useMemo(
    () => state.results.flatMap((r) => r.results.map((f) => fileToCard({ ...f, username: r.username }))),
    [state.results],
  );

  if (state.status !== "connected") return null;

  const hasResults = liveFiles.length > 0;

  return (
    <div className="flex min-h-screen bg-surface-dim font-body text-on-surface antialiased dark:bg-inverse-surface">
      <Sidebar />

      <main className="relative ml-72 flex min-h-screen flex-1 flex-col overflow-hidden">
        {/* Ambient background */}
        <div
          className="pointer-events-none absolute inset-0 opacity-20"
          style={{
            background:
              "radial-gradient(circle at 50% 20%, rgba(51, 102, 204, 0.15) 0%, transparent 60%)",
          }}
        />

        <SearchHeader />

        <div className="relative z-10 mx-auto w-full max-w-5xl flex-1 flex-col px-10 pt-12 pb-8">
          <h1 className="mb-2 font-headline text-5xl font-light tracking-tight text-on-surface dark:text-inverse-primary">
            Search Files
          </h1>
          <p className="mb-10 font-body text-lg text-on-surface-variant dark:text-outline">
            Query the decentralized network. Secure, encrypted, limitless.
          </p>

          <SearchBar />

          <div className="mt-16 flex-1">
            <div className="mb-6 flex items-center justify-between">
              <h2 className="font-headline text-2xl tracking-tight text-on-surface dark:text-inverse-on-surface">
                {hasResults ? "Network Results" : "Trending Network Shares"}
              </h2>
              {!hasResults ? (
                <a
                  href="#"
                  className="font-label text-xs uppercase tracking-widest text-tertiary hover:underline dark:text-tertiary-fixed"
                >
                  View All Network
                </a>
              ) : null}
            </div>

            {hasResults ? (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                {liveFiles.map((card, i) => (
                  <ResultCard key={`${card.title}-${i}`} {...card} />
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
                {TRENDING.map((card) => (
                  <ResultCard key={card.title} {...card} />
                ))}
              </div>
            )}
          </div>
        </div>

        <footer className="relative z-10 w-full border-t border-surface-container-high px-12 py-6 dark:border-surface-container-high/30">
          <div className="flex items-center justify-between">
            <div className="font-label text-[10px] tracking-tight text-tertiary dark:text-tertiary-fixed">
              © 2024 Alexandria High-End Editorial — Homelab Edition
            </div>
            <div className="flex space-x-6">
              {["Protocol Stats", "Node Security", "Peer Graph", "System Health"].map((link) => (
                <a
                  key={link}
                  href="#"
                  className="font-label text-[10px] tracking-tight text-on-secondary-fixed-variant opacity-80 transition-all hover:opacity-100 hover:text-tertiary hover:underline dark:hover:text-tertiary-fixed"
                >
                  {link}
                </a>
              ))}
            </div>
          </div>
        </footer>
      </main>
    </div>
  );
}
