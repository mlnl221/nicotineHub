"use client";

import type { MenuItem } from "@/components/ui/ContextMenu";

function toast(msg: string) {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("nicotineHub:toast", { detail: { title: "Unavailable", body: msg } }));
  }
}

function copy(text: string, ok = "Copied") {
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => toast(ok)).catch(() => toast(text));
  } else toast(text);
}

function navigate(path: string) {
  if (typeof window === "undefined") return;
  try {
    // Use history.pushState + popstate to avoid full reload which loses in-memory WebSocket session.
    // Next.js App Router handles popstate; fallback to href if that fails.
    window.history.pushState(null, "", path);
    window.dispatchEvent(new PopStateEvent("popstate"));
  } catch {
    window.location.href = path;
  }
}

// Standard UserPopupMenu per nicotine-plus pynicotine/gtkgui/widgets/popupmenu.py
export function userMenu(username: string, tabName: string, opts?: { onBrowse?: () => void; onProfile?: () => void; onMessage?: () => void }): MenuItem[] {
  const items: MenuItem[] = [
    { id: "user-label", label: username, icon: "person", disabled: true },
    { id: "sep1", label: "---", icon: "" },
  ];
  if (tabName !== "userinfo") items.push({ id: "view-profile", label: "View User Profile", icon: "account_circle", action: () => (opts?.onProfile ? opts.onProfile() : navigate(`/profile/${encodeURIComponent(username)}`)) });
  if (tabName !== "privatechat") items.push({ id: "send-message", label: "Send Message", icon: "chat_bubble", action: () => (opts?.onMessage ? opts.onMessage() : navigate(`/private-chat?user=${encodeURIComponent(username)}`)) });
  if (tabName !== "userbrowse") items.push({ id: "browse-files", label: "Browse Files", icon: "folder_managed", action: () => (opts?.onBrowse ? opts.onBrowse() : navigate(`/browse/${encodeURIComponent(username)}`)) });
  if (tabName !== "userlist") items.push({ id: "add-buddy", label: "Add Buddy", icon: "person_add", action: () => toast("Add buddy: use Buddies page") });
  items.push({ id: "sep2", label: "---", icon: "" });
  // Ban/Ignore are exact labels — toast as unavailable until bridge implements
  items.push({ id: "ban-user", label: "Ban User", icon: "block", action: () => toast("Ban user — bridge not yet implements server banlist") });
  items.push({ id: "ignore-user", label: "Ignore User", icon: "person_off", action: () => toast("Ignore user — bridge not yet implements ignorelist") });
  items.push({ id: "sep3", label: "---", icon: "" });
  items.push({ id: "ban-ip", label: "Ban IP Address", icon: "block", action: () => toast("Ban IP — unavailable") });
  items.push({ id: "ignore-ip", label: "Ignore IP Address", icon: "person_off", action: () => toast("Ignore IP — unavailable") });
  items.push({ id: "show-ip", label: "Show IP Address", icon: "info", action: () => copy(username, `IP lookup for ${username} unavailable`) });
  items.push({ id: "sep4", label: "---", icon: "" });
  items.push({
    id: "private-rooms",
    label: "Private Rooms",
    icon: "lock",
    submenu: [
      { id: "pr-empty", label: "No private rooms", icon: "info", disabled: true },
    ],
  });
  return items;
}

export function searchResultMenu(row: { user: string; path: string; filename: string; folder: string }, opts: { onDownload: () => void }) : MenuItem[] {
  const fileUrl = `slsk://${encodeURIComponent(row.user)}/${row.path.replace(/\\/g, "/")}`;
  const folderPath = row.path.replace(/[^\\]*$/, "").replace(/\\$/, "");
  const folderUrl = `slsk://${encodeURIComponent(row.user)}/${folderPath.replace(/\\/g, "/")}`;
  return [
    { id: "hdr", label: "1 File Selected", icon: "description", disabled: true },
    { id: "sep", label: "---", icon: "" },
    { id: "download", label: "Download File", icon: "download", action: opts.onDownload },
    { id: "download-to", label: "Download File To…", icon: "download", action: () => toast("Download To — folder picker unavailable") },
    { id: "download-folder", label: "Download Folder…", icon: "folder", action: () => toast("Download folder — use Download File") },
    { id: "sep2", label: "---", icon: "" },
    { id: "props", label: "File Properties", icon: "info", action: () => toast(`${row.filename} • ${row.path}`) },
    { id: "sep3", label: "---", icon: "" },
    { id: "view-profile", label: "View User Profile", icon: "account_circle", action: () => navigate(`/profile/${encodeURIComponent(row.user)}`) },
    { id: "browse-folder", label: "Browse Folder", icon: "folder_managed", action: () => navigate(`/browse/${encodeURIComponent(row.user)}`) },
    { id: "sep4", label: "---", icon: "" },
    {
      id: "copy", label: "Copy", icon: "content_copy", submenu: [
        { id: "copy-path", label: "Copy File Path", icon: "content_copy", action: () => copy(row.path) },
        { id: "copy-file-url", label: "Copy File URL", icon: "link", action: () => copy(fileUrl) },
        { id: "copy-folder-url", label: "Copy Folder URL", icon: "folder", action: () => copy(folderUrl) },
      ]
    },
    {
      id: "user-actions", label: "User Actions", icon: "person", submenu: [
        ...userMenu(row.user, "search"),
        { id: "select-results", label: "Select User's Results", icon: "filter_alt", action: () => toast(`Filter to ${row.user}`) },
      ]
    },
  ];
}

export function searchTabMenu(tab: { query: string; id: string }, actions: { onCopy: () => void; onSearchAgain: () => void; onEdit: () => void; onClose: () => void; onCloseAll: () => void }): MenuItem[] {
  return [
    { id: "edit", label: "Edit…", icon: "edit", action: actions.onEdit },
    { id: "search-again", label: "Search Again", icon: "search", action: actions.onSearchAgain },
    { id: "copy-term", label: "Copy Search Term", icon: "content_copy", action: actions.onCopy },
    { id: "sep", label: "---", icon: "" },
    { id: "close-all", label: "Close All Tabs…", icon: "close", action: actions.onCloseAll },
    { id: "close", label: "Close Tab", icon: "close", action: actions.onClose },
  ];
}

export function transferMenu(t: { user: string; fileName: string; path?: string; virtualPath?: string }, isUpload: boolean, acts: { onResume?: () => void; onPause?: () => void; onRemove: () => void; onRetry?: () => void; onClear?: () => void }): MenuItem[] {
  const display = t.fileName;
  return [
    { id: "hdr", label: "1 File Selected", icon: "description", disabled: true },
    { id: "sep", label: "---", icon: "" },
    ...(isUpload ? [] : [
      { id: "open", label: "Open File", icon: "open_in_new", disabled: true, action: () => toast("Open — browser cannot open local files") } as MenuItem,
      { id: "open-folder", label: "Open in File Manager", icon: "folder_open", disabled: true } as MenuItem,
    ]),
    { id: "props", label: "File Properties", icon: "info", action: () => toast(display) },
    { id: "sep2", label: "---", icon: "" },
    { id: "resume", label: isUpload ? "Retry" : "Resume", icon: "play_arrow", action: acts.onResume ?? acts.onRetry ?? (() => toast("Resume unavailable")) },
    { id: "pause", label: isUpload ? "Abort" : "Pause", icon: "pause", action: acts.onPause ?? acts.onRemove },
    { id: "remove", label: "Remove", icon: "delete", danger: true, action: acts.onRemove },
    { id: "sep3", label: "---", icon: "" },
    { id: "view-profile", label: "View User Profile", icon: "account_circle", action: () => navigate(`/profile/${encodeURIComponent(t.user)}`) },
    { id: "browse-folder", label: "Browse Folder", icon: "folder_managed", action: () => navigate(`/browse/${encodeURIComponent(t.user)}`) },
    { id: "sep4", label: "---", icon: "" },
    {
      id: "copy-search", label: "Copy & Search", icon: "search", submenu: [
        { id: "copy-path", label: "Copy File Path", icon: "content_copy", action: () => copy(t.virtualPath ?? t.path ?? display) },
        { id: "copy-url", label: "Copy File URL", icon: "link", action: () => copy(`slsk://${encodeURIComponent(t.user)}/${(t.virtualPath ?? t.path ?? "").replace(/\\/g, "/")}`) },
        { id: "copy-folder", label: "Copy Folder URL", icon: "folder", action: () => copy(`slsk://${encodeURIComponent(t.user)}/`) },
        { id: "sep", label: "---", icon: "" },
        { id: "search-folder", label: "Search for Folder Name", icon: "search", action: () => toast("Search folder name") },
        { id: "search-file", label: "Search for File Name", icon: "search", action: () => toast("Search file name") },
      ]
    },
    {
      id: "clear-all", label: "Clear All", icon: "clear_all", submenu: isUpload ? [
        { id: "c-finished", label: "Finished / Cancelled / Failed", icon: "done_all", action: () => toast("Clear finished") },
        { id: "c-fin2", label: "Finished / Cancelled", icon: "done", action: () => acts.onClear?.() },
        { id: "sep", label: "---", icon: "" },
        { id: "c-f", label: "Finished", icon: "check", action: () => acts.onClear?.() },
        { id: "c-c", label: "Cancelled", icon: "close", action: () => acts.onClear?.() },
        { id: "c-fail", label: "Failed", icon: "error", action: () => acts.onClear?.() },
        { id: "c-off", label: "User Logged Off", icon: "person_off", action: () => acts.onClear?.() },
        { id: "c-q", label: "Queued…", icon: "hourglass_empty", action: () => { if (confirm("Clear queued uploads?")) acts.onClear?.(); } },
        { id: "sep2", label: "---", icon: "" },
        { id: "c-all", label: "Everything…", icon: "delete_forever", danger: true, action: () => { if (confirm("Clear all uploads?")) acts.onClear?.(); } },
      ] : [
        { id: "c-fin", label: "Finished / Filtered", icon: "done_all", action: () => toast("Clear filtered") },
        { id: "sep", label: "---", icon: "" },
        { id: "c-f", label: "Finished", icon: "check", action: () => acts.onClear?.() },
        { id: "c-p", label: "Paused", icon: "pause", action: () => acts.onClear?.() },
        { id: "c-fil", label: "Filtered", icon: "filter_alt", action: () => acts.onClear?.() },
        { id: "c-d", label: "Deleted", icon: "delete", action: () => acts.onClear?.() },
        { id: "c-q", label: "Queued…", icon: "hourglass_empty", action: () => { if (confirm("Clear queued?")) acts.onClear?.(); } },
        { id: "sep2", label: "---", icon: "" },
        { id: "c-all", label: "Everything…", icon: "delete_forever", danger: true, action: () => { if (confirm("Clear all?")) acts.onClear?.(); } },
      ]
    },
    {
      id: "user-actions",
      label: "User Actions",
      icon: "person",
      submenu: [
        ...userMenu(t.user, "transfers"),
        { id: "select-transfers", label: "Select User's Transfers", icon: "filter_alt", action: () => toast(`Select ${t.user}`) },
      ],
    },
  ];
}

export function browseFolderMenu(username: string, folder: string, isSelf: boolean): MenuItem[] {
  if (isSelf) {
    return [
      { id: "upload", label: "Upload Folder…", icon: "upload", action: () => toast("Upload folder — file picker") },
      { id: "upload-rec", label: "Upload Folder & Subfolders…", icon: "upload", action: () => toast("Upload recursive") },
      { id: "sep", label: "---", icon: "" },
      { id: "props", label: "File Properties", icon: "info", action: () => toast(folder) },
      { id: "sep2", label: "---", icon: "" },
      { id: "copy-path", label: "Copy Folder Path", icon: "content_copy", action: () => copy(folder) },
      { id: "copy-url", label: "Copy Folder URL", icon: "link", action: () => copy(`slsk://${encodeURIComponent(username)}/${folder.replace(/\\/g, "/")}`) },
      { id: "sep3", label: "---", icon: "" },
      { id: "user-actions", label: "User Actions", icon: "person", submenu: userMenu(username, "userbrowse") },
    ];
  }
  return [
    { id: "download", label: "Download Folder", icon: "download", action: () => toast(`Download ${folder}`) },
    { id: "download-rec", label: "Download Folder & Subfolders…", icon: "download", action: () => toast(`Download recursive ${folder}`) },
    { id: "sep", label: "---", icon: "" },
    { id: "props", label: "File Properties", icon: "info", action: () => toast(folder) },
    { id: "sep2", label: "---", icon: "" },
    { id: "copy-path", label: "Copy Folder Path", icon: "content_copy", action: () => copy(folder) },
    { id: "copy-url", label: "Copy Folder URL", icon: "link", action: () => copy(`slsk://${encodeURIComponent(username)}/${folder.replace(/\\/g, "/")}`) },
    { id: "sep3", label: "---", icon: "" },
    { id: "user-actions", label: "User Actions", icon: "person", submenu: userMenu(username, "userbrowse") },
  ];
}

export function browseFileMenu(username: string, file: { path: string; filename: string }, isSelf: boolean): MenuItem[] {
  if (isSelf) {
    return [
      { id: "hdr", label: "1 File Selected", icon: "description", disabled: true },
      { id: "sep", label: "---", icon: "" },
      { id: "upload", label: "Upload File…", icon: "upload", action: () => toast("Upload file") },
      { id: "sep2", label: "---", icon: "" },
      { id: "open", label: "Open File", icon: "open_in_new", disabled: true },
      { id: "sep3", label: "---", icon: "" },
      { id: "props", label: "File Properties", icon: "info", action: () => toast(file.filename) },
      { id: "sep4", label: "---", icon: "" },
      { id: "copy-path", label: "Copy File Path", icon: "content_copy", action: () => copy(file.path) },
      { id: "copy-url", label: "Copy File URL", icon: "link", action: () => copy(`slsk://${encodeURIComponent(username)}/${file.path.replace(/\\/g, "/")}`) },
      { id: "sep5", label: "---", icon: "" },
      { id: "user-actions", label: "User Actions", icon: "person", submenu: userMenu(username, "userbrowse") },
    ];
  }
  return [
    { id: "hdr", label: "1 File Selected", icon: "description", disabled: true },
    { id: "sep", label: "---", icon: "" },
    { id: "download", label: "Download File", icon: "download", action: () => toast(`Download ${file.filename}`) },
    { id: "download-to", label: "Download File To…", icon: "download", action: () => toast("Download To…") },
    { id: "sep2", label: "---", icon: "" },
    { id: "props", label: "File Properties", icon: "info", action: () => toast(file.filename) },
    { id: "sep3", label: "---", icon: "" },
    { id: "copy-path", label: "Copy File Path", icon: "content_copy", action: () => copy(file.path) },
    { id: "copy-url", label: "Copy File URL", icon: "link", action: () => copy(`slsk://${encodeURIComponent(username)}/${file.path.replace(/\\/g, "/")}`) },
    { id: "sep4", label: "---", icon: "" },
    { id: "user-actions", label: "User Actions", icon: "person", submenu: userMenu(username, "userbrowse") },
  ];
}

export function privateChatMenu(username: string | null, msgs: {username:string;message:string}[] | undefined, actions: { onFind: () => void; onCopyAll: () => void; onClear: () => void }): MenuItem[] {
  const userPart: MenuItem[] = username ? userMenu(username, "privatechat") : [];
  return [
    { id: "find", label: "Find…", icon: "search", action: actions.onFind },
    { id: "sep", label: "---", icon: "" },
    { id: "copy", label: "Copy", icon: "content_copy", action: () => copy(msgs?.map(m=>`${m.username}: ${m.message}`).join("\n") ?? "") },
    { id: "copy-all", label: "Copy All", icon: "content_copy", action: actions.onCopyAll },
    { id: "sep2", label: "---", icon: "" },
    { id: "clear", label: "Clear Message View", icon: "clear_all", action: actions.onClear },
    { id: "sep3", label: "---", icon: "" },
    { id: "user-actions", label: "User Actions", icon: "person", submenu: userPart.length ? userPart : [{ id:"none", label:"No user", icon:"person", disabled:true}] },
  ];
}

export function chatRoomMenu(room: string | null, view: "activity"|"chat", actions: { onFind: () => void; onCopyAll: () => void; onClear: () => void; onLeave: () => void }): MenuItem[] {
  if (view === "activity") {
    return [
      { id: "find", label: "Find…", icon: "search", action: actions.onFind },
      { id: "sep", label: "---", icon: "" },
      { id: "copy", label: "Copy", icon: "content_copy", action: () => toast("Copy") },
      { id: "copy-all", label: "Copy All", icon: "content_copy", action: actions.onCopyAll },
      { id: "sep2", label: "---", icon: "" },
      { id: "clear", label: "Clear Activity View", icon: "clear_all", action: actions.onClear },
      { id: "sep3", label: "---", icon: "" },
      { id: "leave", label: "Leave Room", icon: "logout", danger: true, action: actions.onLeave },
    ];
  }
  return [
    { id: "find", label: "Find…", icon: "search", action: actions.onFind },
    { id: "sep", label: "---", icon: "" },
    { id: "copy", label: "Copy", icon: "content_copy", action: () => toast("Copy") },
    { id: "copy-link", label: "Copy Link", icon: "link", action: () => toast("Copy Link") },
    { id: "copy-all", label: "Copy All", icon: "content_copy", action: actions.onCopyAll },
    { id: "sep2", label: "---", icon: "" },
    { id: "clear", label: "Clear Message View", icon: "clear_all", action: actions.onClear },
    { id: "leave", label: "Leave Room", icon: "logout", danger: true, action: actions.onLeave },
  ];
}

export function userInfoLikesMenu(thing: string, isLike: boolean, actions: { onToggleLike: () => void; onToggleDislike: () => void; onRecommend: () => void; onSearch: () => void }): MenuItem[] {
  return [
    { id: "like", label: "I Like This", icon: "favorite", checked: isLike, action: actions.onToggleLike },
    { id: "dislike", label: "I Dislike This", icon: "heart_broken", checked: !isLike, action: actions.onToggleDislike },
    { id: "sep", label: "---", icon: "" },
    { id: "rec", label: "Recommendations for Item", icon: "auto_awesome", action: actions.onRecommend },
    { id: "search", label: "Search for Item", icon: "search", action: actions.onSearch },
  ];
}

export function interestsMenu(thing: string, actions: { onRecommend: () => void; onSearch: () => void; onRemove: () => void; onWishlist?: () => void }): MenuItem[] {
  return [
    { id: "rec", label: "Recommendations for Item", icon: "auto_awesome", action: actions.onRecommend },
    { id: "search", label: "Search for Item", icon: "search", action: actions.onSearch },
    ...(actions.onWishlist ? [{ id: "wishlist", label: "Add to Wishlist", icon: "favorite", action: actions.onWishlist } as MenuItem] : []),
    { id: "sep", label: "---", icon: "" },
    { id: "remove", label: "Remove", icon: "delete", danger: true, action: actions.onRemove },
  ];
}

export function interestsRecMenu(thing: string, isLiked: boolean, isDisliked: boolean, actions: { onLike: () => void; onDislike: () => void; onRecommend: () => void; onSearch: () => void; onWishlist?: () => void }): MenuItem[] {
  return [
    { id: "like", label: "I Like This", icon: "favorite", checked: isLiked, action: actions.onLike },
    { id: "dislike", label: "I Dislike This", icon: "heart_broken", checked: isDisliked, action: actions.onDislike },
    { id: "sep", label: "---", icon: "" },
    { id: "rec", label: "Recommendations for Item", icon: "auto_awesome", action: actions.onRecommend },
    { id: "search", label: "Search for Item", icon: "search", action: actions.onSearch },
    ...(actions.onWishlist ? [{ id: "wishlist", label: "Add to Wishlist", icon: "favorite", action: actions.onWishlist } as MenuItem] : []),
  ];
}

export function buddyMenu(buddy: string, opts?: { onNote?: () => void; onRemove?: () => void }): MenuItem[] {
  return [
    ...userMenu(buddy, "userlist"),
    { id: "sep-note", label: "---", icon: "" },
    { id: "note", label: "Add User Note…", icon: "edit_note", action: () => (opts?.onNote ? opts.onNote() : toast(`Note for ${buddy}`)) },
    { id: "sep2", label: "---", icon: "" },
    { id: "remove", label: "Remove", icon: "person_remove", danger: true, action: () => (opts?.onRemove ? opts.onRemove() : toast(`Remove ${buddy}`)) },
  ];
}

export function genericPageMenu(): MenuItem[] {
  return [
    { id: "copy-link", label: "Copy Link", icon: "link", action: () => copy(window.location.href) },
    { id: "refresh", label: "Refresh", icon: "refresh", action: () => window.location.reload() },
  ];
}
