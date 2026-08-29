"use client";

import { useEffect, useState } from "react";
import { ContextMenu, type MenuItem } from "./ContextMenu";
import {
  genericPageMenu,
} from "@/lib/context-menu/menus";

export function GlobalContextMenu() {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null);
  const [items, setItems] = useState<MenuItem[]>([]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      // Only handle if no other context menu claimed it and target is not an input/context-menu area
      const target = e.target as HTMLElement;
      // Allow custom menus to stop propagation; if we get here it's unclaimed
      if (target.closest("[data-custom-menu]")) return;
      // Don't hijack inputs/contenteditable
      if (target.closest("input, textarea, [contenteditable]")) return;
      e.preventDefault();
      setAnchor({ x: e.clientX, y: e.clientY });
      setItems(genericPageMenu());
    };
    // Attach to main container only? For site-wide we attach to document but check unclaimed.
    // We add listener in capture? Use bubble so specific handlers can stopPropagation.
    document.addEventListener("contextmenu", handler);
    return () => document.removeEventListener("contextmenu", handler);
  }, []);

  if (!anchor) return null;
  return <ContextMenu x={anchor.x} y={anchor.y} items={items} onClose={() => setAnchor(null)} />;
}
