"use client";

import { useCallback, useState } from "react";

type Anchor = { x: number; y: number } | null;

export function useContextMenu() {
  const [anchor, setAnchor] = useState<Anchor>(null);

  const open = useCallback((e: React.MouseEvent | MouseEvent | { clientX: number; clientY: number }) => {
    const x = (e as { clientX: number }).clientX;
    const y = (e as { clientY: number }).clientY;
    setAnchor({ x, y });
  }, []);

  const openAt = useCallback((x: number, y: number) => setAnchor({ x, y }), []);
  const close = useCallback(() => setAnchor(null), []);

  const bind = {
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      setAnchor({ x: e.clientX, y: e.clientY });
    },
  };

  return { anchor, open, openAt, close, bind, isOpen: !!anchor };
}
