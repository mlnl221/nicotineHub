"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Distance from bottom (px) within which the view still counts as "at bottom".
const NEAR_BOTTOM_PX = 80;

/**
 * Stick-to-bottom scrolling for chat message lists.
 * Auto-scrolls on new messages only while the user is near the bottom;
 * scrolling up pauses (shows a "jump to latest" pill), sending forces sticky.
 */
export function useStickToBottom(resetKey: string, count: number) {
  const ref = useRef<HTMLDivElement>(null);
  const [stick, setStickState] = useState(true);
  const stickRef = useRef(true);
  // Bottom edge we last pinned to. Scroll events landing at/above this are
  // stale deliveries from our own programmatic scrolls during a burst — the
  // content grew underneath before the event arrived. Only positions clearly
  // ABOVE the target mean the user scrolled up. Starts at +Inf so the first
  // real scroll away from bottom un-sticks (no pin has happened yet).
  const targetRef = useRef(Number.POSITIVE_INFINITY);

  const setStick = useCallback((v: boolean) => {
    stickRef.current = v;
    setStickState(v);
  }, []);

  const pin = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    targetRef.current = el.scrollHeight - el.clientHeight;
    el.scrollTo({ top: el.scrollHeight });
  }, []);

  const onScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    if (max - el.scrollTop <= NEAR_BOTTOM_PX) {
      if (!stickRef.current) setStick(true);
      targetRef.current = max;
      return;
    }
    // Away from bottom: stale burst event (still at/above our last pin)
    // keeps us stuck and re-pins; only an explicit move above un-sticks.
    if (el.scrollTop < targetRef.current - NEAR_BOTTOM_PX) {
      setStick(false);
    } else if (stickRef.current) {
      pin();
    }
  }, [pin, setStick]);

  const jump = useCallback(() => {
    setStick(true);
    pin();
  }, [pin, setStick]);

  // New conversation/room: re-stick and jump once content lands.
  useEffect(() => {
    setStick(true);
    const el0 = ref.current;
    targetRef.current = el0 ? el0.scrollHeight - el0.clientHeight : Number.POSITIVE_INFINITY;
    const t = requestAnimationFrame(() => {
      const el = ref.current;
      if (!el) return;
      targetRef.current = el.scrollHeight - el.clientHeight;
      el.scrollTo({ top: el.scrollHeight });
    });
    return () => cancelAnimationFrame(t);
  }, [resetKey, setStick]);

  // New messages: follow only when stuck (instant jump — smooth janks on bursts).
  useEffect(() => {
    if (!stickRef.current) return;
    const el = ref.current;
    if (!el) return;
    targetRef.current = el.scrollHeight - el.clientHeight;
    el.scrollTo({ top: el.scrollHeight });
  }, [count]);

  // Layout shifts (font load, mobile keyboard, ticker strip) must not
  // unstick the view: re-pin while stuck.
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (!stickRef.current) return;
      targetRef.current = el.scrollHeight - el.clientHeight;
      el.scrollTo({ top: el.scrollHeight });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return { ref, stick, onScroll, jump };
}
