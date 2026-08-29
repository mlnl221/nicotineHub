"use client";

import { useMemo, useState, useCallback } from "react";
import { useConfig } from "@/lib/config/provider";

/**
 * Browser completion mirroring nicotine-plus chatrooms.py + privatechat.py
 * completions = {login} + roomnames? + buddies? + commands? + roomusers?
 * Controlled by words.* toggles, trigger Tab + dropdown if words.dropdown and chars >= words.characters
 */
export function useCompletion(opts: {
  login?: string;
  roomUsers?: string[];
  roomList?: Array<{ name: string } | string>;
  buddies?: Array<{ username: string } | string>;
  commands?: string[];
}) {
  const { settings } = useConfig();
  const words = settings.words;
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);

  const candidates = useMemo(() => {
    const set = new Set<string>();
    if (opts.login) set.add(opts.login);
    if (words.roomnames && opts.roomList) {
      for (const r of opts.roomList) {
        const name = typeof r === "string" ? r : r.name;
        if (name) set.add(name);
      }
    }
    if (words.buddies && opts.buddies) {
      for (const b of opts.buddies) {
        const name = typeof b === "string" ? b : b.username;
        if (name) set.add(name);
      }
    }
    if (words.commands && opts.commands) {
      for (const c of opts.commands) set.add(c);
    }
    if (words.roomusers && opts.roomUsers) {
      for (const u of opts.roomUsers) set.add(u);
    }
    return Array.from(set);
  }, [opts.login, opts.roomList, opts.buddies, opts.commands, opts.roomUsers, words.roomnames, words.buddies, words.commands, words.roomusers]);

  const matches = useMemo(() => {
    if (!query) return [];
    const lower = query.toLowerCase();
    return candidates.filter((c) => c.toLowerCase().startsWith(lower)).slice(0, 8);
  }, [candidates, query]);

  const shouldShow = useMemo(() => {
    if (!words.tab) return false;
    if (query.length < (words.characters ?? 3)) return false;
    if (!words.dropdown) return false;
    return matches.length > 0 && open;
  }, [words.tab, words.dropdown, words.characters, query, matches.length, open]);

  const onInput = useCallback((value: string) => {
    // extract last word
    const parts = value.split(/\s+/);
    const last = parts[parts.length - 1] || "";
    setQuery(last);
    setOpen(!!last && last.length >= (words.characters ?? 3));
    setIndex(0);
  }, [words.characters]);

  const apply = useCallback((value: string, completion: string) => {
    const parts = value.split(/\s+/);
    parts[parts.length - 1] = completion;
    const next = parts.join(" ") + " ";
    setOpen(false);
    setQuery("");
    return next;
  }, []);

  const cycle = useCallback((value: string, dir: 1 | -1 = 1) => {
    if (!matches.length) return value;
    const nextIdx = (index + dir + matches.length) % matches.length;
    setIndex(nextIdx);
    return apply(value, matches[nextIdx]);
  }, [matches, index, apply]);

  return { candidates, matches, shouldShow, query, open, index, setOpen, onInput, apply, cycle, setIndex };
}
