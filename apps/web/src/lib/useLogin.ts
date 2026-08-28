"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BridgeOutboundMessage, LoginRequest } from "@/lib/protocol";

export interface LoginState {
  status: "idle" | "connecting" | "succeeded" | "failed";
  error?: string;
  result?: Extract<BridgeOutboundMessage, { type: "login:result"; ok: true }>["data"];
}

function bridgeUrl(): string {
  if (typeof window === "undefined") return "";
  const override = window.localStorage.getItem("nicotine.bridgeUrl");
  if (override) return override;

  // Explicit override (NEXT_PUBLIC_BRIDGE_URL), e.g. "wss://host:8787/ws".
  const configured = process.env.NEXT_PUBLIC_BRIDGE_URL;
  if (configured) return configured;

  const scheme = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${window.location.hostname}:8787/ws`;
}

export function useLogin() {
  const [state, setState] = useState<LoginState>({ status: "idle" });
  const socketRef = useRef<WebSocket | null>(null);
  const generation = useRef(0);
  const doneRef = useRef(false);

  const teardown = useCallback(() => {
    generation.current += 1;
    socketRef.current?.close();
    socketRef.current = null;
  }, []);

  const login = useCallback(
    (req: Omit<LoginRequest, "type">) => {
      const gen = ++generation.current;
      doneRef.current = false;
      socketRef.current?.close();

      setState({ status: "connecting" });

      const ws = new WebSocket(bridgeUrl());
      socketRef.current = ws;

      ws.onopen = () => {
        if (generation.current !== gen) return;
        const msg: LoginRequest = { type: "login", ...req };
        ws.send(JSON.stringify(msg));
      };

      ws.onmessage = (event) => {
        if (generation.current !== gen) return;
        let data: BridgeOutboundMessage;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }

        if (data.type === "login:result" && data.ok) {
          doneRef.current = true;
          setState({ status: "succeeded", result: data.data });
        } else if ((data.type === "login:result" && !data.ok) || data.type === "error") {
          doneRef.current = true;
          setState({ status: "failed", error: data.error });
        }
      };

      ws.onerror = () => {
        if (generation.current !== gen) return;
        doneRef.current = true;
        setState({
          status: "failed",
          error: "Could not reach the Nicotine bridge. Is it running?",
        });
      };

      ws.onclose = () => {
        if (generation.current !== gen || doneRef.current) return;
        doneRef.current = true;
        setState({
          status: "failed",
          error: "Connection to the bridge closed before login completed.",
        });
      };
    },
    [],
  );

  const reset = useCallback(() => {
    teardown();
    setState({ status: "idle" });
  }, [teardown]);

  useEffect(() => () => teardown(), [teardown]);

  return { login, reset, teardown, state };
}
