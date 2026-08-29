"use client";

import { useEffect } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { SearchProvider } from "@/lib/search";
import { Sidebar } from "@/components/Sidebar";
import { TopBar } from "@/components/mobile/TopBar";
import { BottomNav } from "@/components/mobile/BottomNav";

const SearchScreen = dynamic(() => import("@/components/search/SearchScreen").then((m) => m.SearchScreen), {
  loading: () => <div className="flex flex-1 items-center justify-center p-10"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>,
});

export default function SearchPage() {
  const { state } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (state.status !== "connected") router.replace("/");
  }, [state.status, router]);

  if (state.status !== "connected") return null;

  return (
    <div className="flex min-h-screen max-w-[100vw] overflow-x-hidden bg-surface-container-low dark:bg-inverse-surface">
      <Sidebar />
      <TopBar title="Search" subtitle="Find files across the network" />
      <main className="md:ml-72 flex min-h-screen flex-1 flex-col bg-surface-container-low dark:bg-inverse-surface pt-[calc(60px+env(safe-area-inset-top,0px))] md:pt-0 pb-[calc(64px+env(safe-area-inset-bottom,0px))] md:pb-0 max-w-full overflow-x-hidden min-w-0">
        <SearchProvider>
          <SearchScreen />
        </SearchProvider>
      </main>
      <BottomNav />
    </div>
  );
}
