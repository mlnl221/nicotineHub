"use client";

import { useEffect } from "react";
import { useParams, useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import ChatRoomsPage from "../page";

export default function ChatRoomPage() {
  const params = useParams<{ room: string }>();
  const room = decodeURIComponent(params.room ?? "");
  const { state } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (state.status === "idle" || state.status === "connecting") return;
    if (state.status !== "connected") { router.replace("/"); return; }
    if (room) {
      // navigate to main chat with room active via query param hack? For now push to /chat and rely on shared state.
      // We store desired room in sessionStorage so ChatRoomsPage can pick it up.
      try {
        sessionStorage.setItem("nicotineHub.activeRoom", room);
      } catch {}
      router.replace("/chat");
    }
  }, [state.status, router, room]);

  if (state.status === "idle" || state.status === "connecting") return <div className="flex h-screen items-center justify-center"><div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" /></div>;
  if (state.status !== "connected") return null;
  return <ChatRoomsPage />;
}
