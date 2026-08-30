"use client";
import { useEffect, useRef } from "react";
import { useConfig } from "@/lib/config/provider";
import { useSession } from "@/lib/session";

/**
 * Sync relevant config keys to bridge via WS `config:update`.
 * Mirrors nicotine config persistence but bridge only needs a subset
 * that affects server behaviour: bans, filters, upload limits, etc.
 */
export function ConfigBridgeSync() {
  const { settings } = useConfig();
  const { send, state } = useSession();
  const prev = useRef<string>("");

  useEffect(() => {
    if (state.status !== "connected") return;
    // Build a key for diffing — only sync when changed
    const relevant = {
      transfers: {
        share_filters: settings.transfers.share_filters,
        uploadslots: settings.transfers.uploadslots,
        useupslots: settings.transfers.useupslots,
        uploadlimit: settings.transfers.uploadlimit,
        uploadlimitalt: settings.transfers.uploadlimitalt,
        use_upload_speed_limit: settings.transfers.use_upload_speed_limit,
        downloadlimit: settings.transfers.downloadlimit,
        downloadlimitalt: settings.transfers.downloadlimitalt,
        use_download_speed_limit: settings.transfers.use_download_speed_limit,
        fifoqueue: settings.transfers.fifoqueue,
        limitby: settings.transfers.limitby,
        queuelimit: settings.transfers.queuelimit,
        filelimit: settings.transfers.filelimit,
        friendsnolimits: settings.transfers.friendsnolimits,
        preferfriends: settings.transfers.preferfriends,
        autoclear_downloads: settings.transfers.autoclear_downloads,
        autoclear_uploads: settings.transfers.autoclear_uploads,
        usernamesubfolders: settings.transfers.usernamesubfolders,
        downloadfilters: settings.transfers.downloadfilters,
        enablefilters: settings.transfers.enablefilters,
        banlist: settings.server.banlist, // also in server section
        geoblock: settings.transfers.geoblock,
        geoblockcc: settings.transfers.geoblockcc,
        usecustomban: settings.transfers.usecustomban,
        customban: settings.transfers.customban,
        usecustomgeoblock: settings.transfers.usecustomgeoblock,
        customgeoblock: settings.transfers.customgeoblock,
      },
      server: {
        banlist: settings.server.banlist,
        ignorelist: settings.server.ignorelist,
        ipblocklist: settings.server.ipblocklist,
        ipignorelist: settings.server.ipignorelist,
        // portrange is save-gated in NetworkSection (explicit Save → config:update + hot-swap, WS stays open)
        // to avoid auto-reconnect on every keystroke; do not auto-sync here
        upnp: settings.server.upnp,
        interface: settings.server.interface,
        autoreply: settings.server.autoreply,
        autosearch: settings.server.autosearch,
        autojoin: settings.server.autojoin,
        userlist: settings.server.userlist,
        autoaway: settings.server.autoaway,
        private_chatrooms: settings.server.private_chatrooms,
      },
      chatrooms: {
        user_list_visible: (settings as unknown as { chatrooms?: { user_list_visible?: boolean } }).chatrooms?.user_list_visible ?? true,
      },
      userbrowse: {
        expand_folders: (settings as unknown as { userbrowse?: { expand_folders?: string } }).userbrowse?.expand_folders ?? "all",
      },
    };
    const key = JSON.stringify(relevant);
    if (key === prev.current) return;
    prev.current = key;

    // Send each key individually (bridge handles config:update per key)
    for (const [k, v] of Object.entries(relevant.transfers)) {
      send({ type: "config:update", section: "transfers", key: k, value: v } as unknown as never);
    }
    for (const [k, v] of Object.entries(relevant.server)) {
      send({ type: "config:update", section: "server", key: k, value: v } as unknown as never);
    }
    // ShareDB filters
    send({ type: "config:update", section: "transfers", key: "share_filters", value: settings.transfers.share_filters } as unknown as never);
  }, [settings, state.status, send]);

  return null;
}
