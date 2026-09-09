"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
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
  onCloseSub,
}: {
  items: MenuItem[];
  onClose: () => void;
  nested?: boolean;
  onCloseSub?: () => void;
}) {
  const [openSub, setOpenSub] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const isFocusable = (it: MenuItem) => it.label !== "---" && !it.disabled;
  const [active, setActive] = useState<number>(() => items.findIndex((it) => it.label !== "---" && !it.disabled));

  useEffect(() => {
    if (nested) return;
    if (active >= 0) itemRefs.current[active]?.focus();
  }, []);

  const focusAt = (idx: number) => {
    setActive(idx);
    itemRefs.current[idx]?.focus();
  };
  const step = (dir: 1 | -1) => {
    if (!items.length) return;
    let i = active;
    for (let n = 0; n < items.length; n++) {
      i = (i + dir + items.length) % items.length;
      if (isFocusable(items[i])) {
        focusAt(i);
        return;
      }
    }
  };
  const firstIdx = items.findIndex(isFocusable);
  const lastIdx = (() => {
    for (let i = items.length - 1; i >= 0; i--) if (isFocusable(items[i])) return i;
    return -1;
  })();

  const onKeyDown = (e: React.KeyboardEvent) => {
    const cur = active >= 0 ? items[active] : undefined;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        e.stopPropagation();
        step(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        e.stopPropagation();
        step(-1);
        break;
      case "Home":
        e.preventDefault();
        e.stopPropagation();
        if (firstIdx >= 0) focusAt(firstIdx);
        break;
      case "End":
        e.preventDefault();
        e.stopPropagation();
        if (lastIdx >= 0) focusAt(lastIdx);
        break;
      case "Tab":
        e.preventDefault();
        e.stopPropagation();
        step(e.shiftKey ? -1 : 1);
        break;
      case "ArrowRight":
        if (cur?.submenu?.length) {
          e.preventDefault();
          e.stopPropagation();
          setOpenSub(cur.id);
          const parentIdx = active;
          setTimeout(() => {
            itemRefs.current[parentIdx]?.parentElement
              ?.querySelector<HTMLButtonElement>('[role="menu"] button:not([disabled])')
              ?.focus();
          }, 0);
        }
        break;
      case "ArrowLeft":
        e.preventDefault();
        e.stopPropagation();
        if (openSub) {
          setOpenSub(null);
          if (active >= 0) itemRefs.current[active]?.focus();
        } else if (nested) {
          onCloseSub?.();
        }
        break;
      case "Escape":
        e.stopPropagation();
        if (openSub) setOpenSub(null);
        else if (nested) onCloseSub?.();
        else onClose();
        break;
      default:
        break;
    }
  };

  return (
    <div
      ref={panelRef}
      className={`min-w-[220px] max-w-[320px] max-h-[60dvh] overflow-auto rounded-2xl bg-surface-container-lowest/90 dark:bg-surface-container-high/95 backdrop-blur-xl ghost-border p-1.5 shadow-[0_24px_48px_rgba(0,0,0,0.12)] border border-outline-variant/10 ${nested ? "mt-1 ml-3 border-l border-outline-variant/10 pl-2" : ""}`}
      role="menu"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
    >
      {items.map((it, idx) => {
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
              ref={(el) => {
                itemRefs.current[idx] = el;
              }}
              tabIndex={active === idx ? 0 : -1}
              onFocus={() => {
                if (isFocusable(it)) setActive(idx);
              }}
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
              <MenuPanel items={it.submenu!} onClose={onClose} nested onCloseSub={() => { setOpenSub(null); focusAt(idx); }} />
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
  const id = useId();
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const anchorRef = useRef<Element | null>(null);
  const capturedRef = useRef(false);
  if (!capturedRef.current && typeof document !== "undefined") {
    capturedRef.current = true;
    anchorRef.current = document.activeElement;
  }

  useEffect(() => setMounted(true), []);

  // One menu at a time: mounting broadcasts, other mounted menus close.
  // (Own listener attaches after dispatch, so no self-close.)
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("nicotineHub:menu-open", { detail: { id } }));
    const onOther = (e: Event) => {
      if ((e as CustomEvent<{ id?: string }>).detail?.id !== id) onCloseRef.current();
    };
    window.addEventListener("nicotineHub:menu-open", onOther);
    return () => window.removeEventListener("nicotineHub:menu-open", onOther);
  }, [id]);

  useEffect(() => () => {
    (anchorRef.current as HTMLElement | null)?.focus?.();
  }, []);

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
      if (e.key === "Escape") onCloseRef.current();
    };
    const onClick = () => onCloseRef.current();
    const onCtx = () => onCloseRef.current();
    const onScroll = () => onCloseRef.current();
    const onResize = () => onCloseRef.current();
    window.addEventListener("keydown", onKey);
    window.addEventListener("click", onClick);
    window.addEventListener("contextmenu", onCtx);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("click", onClick);
      window.removeEventListener("contextmenu", onCtx);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  if (!mounted) return null;
  return createPortal(
    <div
      ref={ref}
      data-custom-menu
      className="fixed z-[100] animate-in fade-in zoom-in-95 duration-100"
      style={{ left: pos.left, top: pos.top }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); }}
    >
      <MenuPanel items={items} onClose={onClose} />
    </div>,
    document.body
  );
}
