"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { SearchProvider } from "@/lib/search";
import { SearchScreen } from "@/components/search/SearchScreen";
import { Sidebar } from "@/components/Sidebar";

export default function SearchPage() {
  const { state } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (state.status !== "connected") router.replace("/");
  }, [state.status, router]);

  if (state.status !== "connected") return null;

  return (
    <div className="flex min-h-screen bg-surface-container-low dark:bg-inverse-surface">
      <Sidebar />
      <main className="ml-72 flex min-h-screen flex-1 flex-col bg-surface-container-low dark:bg-inverse-surface">
        <SearchProvider>
          <SearchScreen />
        </SearchProvider>
      </main>
    </div>
  );
}
