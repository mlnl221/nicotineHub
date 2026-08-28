"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { SearchProvider } from "@/lib/search";
import { SearchScreen } from "@/components/search/SearchScreen";

export default function SearchPage() {
  const { state } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (state.status !== "connected") router.replace("/");
  }, [state.status, router]);

  if (state.status !== "connected") return null;

  return (
    <SearchProvider>
      <SearchScreen />
    </SearchProvider>
  );
}
