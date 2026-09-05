"use client";
import { useCallback } from "react";
import { useConfig } from "@/lib/config/provider";
import { useSession } from "@/lib/session";
import { isDemo } from "@/lib/demo";
import type {
  BridgeInboundMessage,
  BridgeOutboundMessage,
  ConfigUpdateRequest,
} from "@/lib/protocol";
import type { Settings } from "@/lib/config/defaults";

type Section = keyof Settings;

const msg = (section: string, key: string, value: unknown): ConfigUpdateRequest => ({
  type: "config:update",
  section,
  key,
  value,
});

/** All draft keys of a settings section as WS messages. `worker` tokens stay explicit in WorkerSection. */
export function buildSectionMessages(section: Section, s: Settings): BridgeInboundMessage[] {
  switch (section) {
    case "server": {
      // ponytail: portrange excluded — NetworkSection saves it via its bespoke hot-swap flow
      const { portrange: _port, ...rest } = s.server;
      void _port;
      return Object.entries(rest).map(([k, v]) => msg("server", k, v));
    }
    case "userinfo": {
      const rawDescr =
        s.userinfo.descr === "''"
          ? ""
          : s.userinfo.descr.replace(/^'|'$/g, "").replace(/^"|"$/g, "");
      if (rawDescr.length > 10000) throw new Error("Description too long (max 10000 chars)");
      const pic = s.userinfo.pic;
      let picB64: string | undefined;
      if (pic) {
        picB64 = pic.startsWith("data:") ? pic.slice(pic.indexOf(",") + 1) : pic;
        if (picB64.startsWith("/") || picB64.startsWith("C:") || picB64.length > 5_000_000) picB64 = undefined;
      }
      return [
        {
          type: "userinfo",
          action: "setProfile",
          profile: { descr: rawDescr, pic: picB64, totalupl: 0, queuesize: 0, slotsavail: true, uploadallowed: 1 },
        },
        msg("userinfo", "picture_visible", s.userinfo.picture_visible),
      ];
    }
    case "worker":
      return []; // tokens/webhook are save-gated inside WorkerSection (write-only, never auto-pushed)
    default: {
      const obj = s[section] as Record<string, unknown>;
      return Object.entries(obj).map(([k, v]) => msg(section, k, v));
    }
  }
}

const ACK_TIMEOUT_MS = 10_000;

/** Explicit per-section save: push drafts to the bridge, await acks, then commit. */
export function useSaveSection() {
  const { markSectionSaved } = useConfig();
  const { send, subscribe, state } = useSession();

  return useCallback(
    async (section: Section, getDraft: () => Settings): Promise<void> => {
      const draft = getDraft();
      const messages = buildSectionMessages(section, draft);
      // Demo / offline: commit locally; the connect-push delivers committed state when connected.
      if (isDemo || state.status !== "connected") {
        markSectionSaved(section);
        return;
      }
      const awaited = messages.filter((m) => m.type === "config:update");
      if (awaited.length === 0) {
        for (const m of messages) send(m);
        markSectionSaved(section);
        return;
      }
      const pending = new Map(awaited.map((m) => [`${m.section}:${m.key}`, false]));
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          unsub();
          reject(new Error("Bridge did not acknowledge (timeout)"));
        }, ACK_TIMEOUT_MS);
        const unsub = subscribe((inMsg: BridgeOutboundMessage) => {
          if (inMsg.type === "config:updated") {
            const k = `${(inMsg as { section: string }).section}:${(inMsg as { key: string }).key}`;
            if (pending.has(k)) pending.set(k, true);
          } else if (inMsg.type === "error") {
            clearTimeout(timer);
            unsub();
            reject(new Error((inMsg as { error: string }).error));
            return;
          }
          if ([...pending.values()].every(Boolean)) {
            clearTimeout(timer);
            unsub();
            resolve();
          }
        });
        for (const m of messages) send(m);
      });
      markSectionSaved(section);
    },
    [markSectionSaved, send, subscribe, state.status],
  );
}
