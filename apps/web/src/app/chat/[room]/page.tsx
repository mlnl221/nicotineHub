"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { Sidebar } from "@/components/Sidebar";
import { StubNotice } from "@/components/StubNotice";

export default function ChatRoomPage() {
  const params = useParams<{ room: string }>();
  const room = decodeURIComponent(params.room ?? "");
  const { state } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (state.status !== "connected") router.replace("/");
  }, [state.status, router]);

  if (state.status !== "connected" || !room) return null;

  return (
    <div className="flex min-h-screen bg-surface-dim font-body text-on-surface antialiased dark:bg-inverse-surface">
      <Sidebar />
      <main className="relative ml-72 flex min-h-screen flex-1 flex-col overflow-hidden">
        <StubNotice
          title={`Room: ${room}`}
          icon="groups"
          description={`Chat room ${room} has not been implemented yet.`}
        />
      </main>
    </div>
  );
}
