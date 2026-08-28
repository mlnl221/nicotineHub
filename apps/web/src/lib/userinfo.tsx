"use client";

import { useEffect, useState } from "react";
import { useSession } from "@/lib/session";
import type {
  UserInfoEvent,
  UserInfoInterests,
  UserInfoProfile,
  UserInfoStats,
  UserInfoStatus,
} from "@/lib/protocol";

export interface UserProfile {
  username: string;
  status?: UserInfoStatus;
  stats?: UserInfoStats;
  interests?: UserInfoInterests;
  info?: UserInfoProfile;
}

/**
 * Subscribe to a user's profile data via the bridge. Sends `watch` (status +
 * stats), `interests`, and `get` (full peer UserInfoResponse) on mount and
 * unwatches on unmount. Returns the merged profile plus loading/error flags.
 */
export function useUserInfo(username: string) {
  const { send, subscribe, state } = useSession();
  const [profile, setProfile] = useState<UserProfile>({ username });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (state.status !== "connected") return;

    setProfile({ username });
    setLoading(true);
    setError(null);

    const unsub = subscribe((msg) => {
      if (msg.type !== "userinfo:event") return;
      const ev: UserInfoEvent = msg.event;
      if (ev.username && ev.username !== username) return;

      switch (ev.type) {
        case "user-status":
          setProfile((p) => ({ ...p, status: ev.status }));
          setLoading(false);
          break;
        case "user-stats":
          setProfile((p) => ({ ...p, stats: ev.stats }));
          setLoading(false);
          break;
        case "user-interests":
          setProfile((p) => ({ ...p, interests: ev.interests }));
          break;
        case "user-info-response":
          setProfile((p) => ({ ...p, info: ev.info }));
          setLoading(false);
          break;
        case "user-info-failed":
          setError("Could not load this user's profile.");
          setLoading(false);
          break;
        default:
          break;
      }
    });

    send({ type: "userinfo", action: "watch", username });
    send({ type: "userinfo", action: "interests", username });
    send({ type: "userinfo", action: "get", username });

    return () => {
      unsub();
      send({ type: "userinfo", action: "unwatch", username });
    };
  }, [username, state.status, send, subscribe]);

  return { profile, loading, error };
}
