"use client";

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type MenuItem = {
  id: string;
  label: string;
  icon?: string;
  disabled?: boolean;
  danger?: boolean;
  checked?: boolean;
  shortcut?: string;
  submenu?: MenuItem[];
  action?: () => void;
};

type Props = {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
};

function MenuPanel({
  items,
  onClose,
  nested = false,
}: {
  items: MenuItem[];
  onClose: () => void;
  nested?: boolean;
}) {
  const [openSub, setOpenSub] = useState<string | null>(null);
  return (
    <div
      className={`min-w-[220px] max-w-[320px] rounded-2xl bg-surface-container-lowest/90 dark:bg-surface-container-high/95 backdrop-blur-xl ghost-border p-1.5 shadow-[0_24px_48px_rgba(0,0,0,0.12)] border border-outline-variant/10 ${nested ? "mt-1 ml-3 border-l border-outline-variant/10 pl-2" : ""}`}
      role="menu"
      onClick={(e) => e.stopPropagation()}
    >
      {items.map((it) => {
        if (it.label === "---") {
          return <div key={it.id} className="my-1 h-px bg-outline-variant/15" />;
        }
        const hasSub = !!it.submenu?.length;
        const isOpen = openSub === it.id;
        return (
          <div key={it.id} className="relative">
            <button
              type="button"
              role="menuitem"
              disabled={it.disabled}
              aria-haspopup={hasSub ? "menu" : undefined}
              onClick={() => {
                if (it.disabled) return;
                if (hasSub) {
                  setOpenSub((v) => (v === it.id ? null : it.id));
                  return;
                }
                it.action?.();
                onClose();
              }}
              onMouseEnter={() => hasSub && setOpenSub(it.id)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 min-h-11 text-left font-body text-sm transition-colors ${
                it.disabled
                  ? "opacity-40 cursor-not-allowed text-on-surface-variant"
                  : it.danger
                    ? "text-error hover:bg-error-container/60"
                    : "text-on-surface hover:bg-surface-container-high dark:hover:bg-surface-variant/60"
              } ${it.checked ? "bg-primary-container/30" : ""}`}
            >
              {it.icon ? <span className="material-symbols-outlined text-[18px] shrink-0 opacity-80">{it.icon}</span> : <span className="w-[18px] shrink-0" />}
              <span className="flex-1 truncate">{it.label}</span>
              {it.checked ? <span className="material-symbols-outlined text-[16px] text-primary">check</span> : null}
              {it.shortcut ? <span className="font-label text-[10px] text-outline">{it.shortcut}</span> : null}
              {hasSub ? <span className="material-symbols-outlined text-[14px] opacity-60">chevron_right</span> : null}
            </button>
            {hasSub && isOpen ? (
              <MenuPanel items={it.submenu!} onClose={onClose} nested />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  useLayoutEffect(() => {
    if (!ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    const pad = 8;
    const halfH = window.innerHeight / 2;
    const halfW = window.innerWidth / 2;
    let left = x > halfW ? x - rect.width - 8 : x;
    let top = y > halfH ? y - rect.height - 8 : y;
    if (left + rect.width > window.innerWidth - pad) left = window.innerWidth - rect.width - pad;
    if (top + rect.height > window.innerHeight - pad) top = window.innerHeight - rect.height - pad;
    if (left < pad) left = pad;
    if (top < pad) top = pad;
    setPos({ left, top });
  }, [x, y]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onClick = () => onClose();
    const onScroll = () => onClose();
    window.addEventListener("keydown", onKey);
    window.addEventListener("click", onClick);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("click", onClick);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onClose);
    };
  }, [onClose]);

  if (!mounted) return null;
  return createPortal(
    <div
      ref={ref}
      className="fixed z-[100] animate-in fade-in zoom-in-95 duration-100"
      style={{ left: pos.left, top: pos.top }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <MenuPanel items={items} onClose={onClose} />
    </div>,
    document.body
  );
}
