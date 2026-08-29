"use client";

import { useCallback, useEffect, useState } from "react";
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
  country?: string;
  watchUser?: { exists: boolean; status?: number; avgspeed?: number; files?: number; dirs?: number; country?: string };
}

/**
 * Subscribe to a user's profile data via the bridge. Sends `watch` (status +
 * stats), `interests`, and `get` (full peer UserInfoResponse) on mount and
 * unwatches on unmount. Returns the merged profile plus loading/error flags
 * and a refresh() helper.
 */
export function useUserInfo(username: string) {
  const { send, subscribe, state } = useSession();
  const [profile, setProfile] = useState<UserProfile>({ username });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (state.status !== "connected") return;
    setLoading(true);
    setError(null);
    send({ type: "userinfo", action: "watch", username });
    send({ type: "userinfo", action: "interests", username });
    send({ type: "userinfo", action: "get", username });
  }, [username, state.status, send]);

  useEffect(() => {
    if (state.status !== "connected") return;

    setProfile({ username });
    setLoading(true);
    setError(null);

    const unsub = subscribe((msg) => {
      // Direct profile response (sent by server.ts for action:"get")
      if (msg.type === "user-info-response") {
        if (msg.username !== username) return;
        setProfile((p) => ({
          ...p,
          info: {
            username: msg.username,
            descr: msg.descr,
            pic: msg.pic,
            totalupl: msg.totalupl,
            queuesize: msg.queuesize,
            slotsavail: msg.slotsavail,
            uploadallowed: msg.uploadallowed,
          },
        }));
        setLoading(false);
        return;
      }
      if (msg.type === "user-info-failed") {
        if (msg.username !== username) return;
        setError("Could not load this user's profile.");
        setLoading(false);
        return;
      }
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
        case "watch-user":
          setProfile((p) => ({ ...p, watchUser: ev.watchUser, country: ev.watchUser?.country || p.country }));
          if (ev.watchUser?.exists) {
            setProfile((p) => ({
              ...p,
              status: ev.watchUser?.status !== undefined ? { username, status: ev.watchUser!.status!, privileged: p.status?.privileged || false } : p.status,
            }));
          }
          setLoading(false);
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

  return { profile, loading, error, refresh };
}
