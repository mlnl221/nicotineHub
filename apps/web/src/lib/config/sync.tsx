"use client";
import { useEffect, useRef } from "react";
import { useConfig } from "@/lib/config/provider";
import { useSession } from "@/lib/session";
import { buildSectionMessages } from "@/lib/config/save";
import type { Settings } from "@/lib/config/defaults";

/**
 * Bridge sync for the explicit-save model. Nothing pushes on keystroke.
 * On every (re)connect: pull durable bridge state (config:get → config:state),
 * adopt values for keys still at defaults locally, then push the full
 * committed state so live session/TransferManager match last-saved.
 * `server.portrange` stays save-gated (hot-swap + reconnect in NetworkSection);
 * `worker` tokens stay explicit in WorkerSection (write-only).
 */
export function ConfigBridgeSync() {
  const { saved, applyBridgedState } = useConfig();
  const { send, subscribe, state } = useSession();
  const savedRef = useRef(saved);
  savedRef.current = saved;
  const lastStatus = useRef(state.status);
  const pending = useRef(false);

  useEffect(() => {
    const was = lastStatus.current;
    lastStatus.current = state.status;
    if (state.status !== "connected" || was === "connected" || pending.current) return;
    pending.current = true;
    let done = false;
    const finish = (remote?: Record<string, Record<string, unknown>>) => {
      if (done) return;
      done = true;
      try {
        if (remote) applyBridgedState(remote);
        const current = savedRef.current;
        for (const section of Object.keys(current) as (keyof Settings)[]) {
          if (section === "worker") continue;
          for (const m of buildSectionMessages(section, current)) send(m);
        }
      } finally {
        pending.current = false;
      }
    };
    const timer = setTimeout(() => {
      unsub();
      finish();
    }, 4000);
    const unsub = subscribe((inMsg) => {
      if (inMsg.type === "config:state") {
        clearTimeout(timer);
        unsub();
        finish(inMsg.settings);
      }
    });
    send({ type: "config:get" });
    return () => {
      clearTimeout(timer);
      unsub();
    };
  }, [state.status, send, subscribe, applyBridgedState]);

  return null;
}
