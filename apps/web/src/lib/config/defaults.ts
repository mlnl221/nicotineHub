/**
 * Client-side default settings, mirroring the Nicotine+ `config.defaults` shape
 * (section → key → value). Only the settings relevant to the browser client are
 * included; desktop-only keys are omitted (see docs/settings-mapping.md).
 */

export type NetworkServer = {
  host: string;
  port: number;
};

export type Filters = {
  include: string;
  exclude: string;
  fileSize: string;
  bitrate: string;
  freeSlots: boolean;
  country: string;
  fileType: string;
  length: string;
  publicFiles: boolean;
};

export interface Settings {
  server: {
    server: NetworkServer;
    login: string;
    auto_connect_startup: boolean;
    autoaway: number;
    private_chatrooms: boolean;
  };
  ui: {
    dark_mode: boolean;
    language: string;
    reverse_file_paths: boolean;
    file_size_unit: "B" | "";
    usernamehotspots: boolean;
    usernamestyle: "bold" | "italic" | "hyperlinks" | "none";
  };
  notifications: {
    notification_window_title: boolean;
    notification_popup_sound: boolean;
    notification_popup_file: boolean;
    notification_popup_folder: boolean;
    notification_popup_queued_upload: boolean;
    notification_popup_private_message: boolean;
    notification_popup_private_mention: boolean;
    notification_popup_chatroom: boolean;
    notification_popup_chatroom_mention: boolean;
    notification_popup_wish: boolean;
  };
  searches: {
    maxresults: number;
    max_displayed_results: number;
    min_search_chars: number;
    enablefilters: boolean;
    defilter: Filters;
    enable_history: boolean;
    history: string[];
    search_results: boolean;
    private_search_results: boolean;
  };
}

export const DEFAULT_SERVER_HOST = "server.slsknet.org";
export const DEFAULT_SERVER_PORT = 2242;

// TODO(Phase 5): transfers section — uploadslots, queuelimit, filelimit, fifoqueue, friendsnolimits, preferfriends, autoclear, enablefilters, etc. (see docs/TRANSFERS.md §1.6 / docs/settings-mapping.md:127)
export const defaults: Settings = {
  server: {
    server: { host: DEFAULT_SERVER_HOST, port: DEFAULT_SERVER_PORT },
    login: "",
    auto_connect_startup: true,
    autoaway: 15,
    private_chatrooms: false,
  },
  ui: {
    dark_mode: false,
    language: "",
    reverse_file_paths: true,
    file_size_unit: "",
    usernamehotspots: true,
    usernamestyle: "bold",
  },
  notifications: {
    notification_window_title: true,
    notification_popup_sound: false,
    notification_popup_file: true,
    notification_popup_folder: true,
    notification_popup_queued_upload: true,
    notification_popup_private_message: true,
    notification_popup_private_mention: true,
    notification_popup_chatroom: false,
    notification_popup_chatroom_mention: true,
    notification_popup_wish: true,
  },
  searches: {
    maxresults: 300,
    max_displayed_results: 2500,
    min_search_chars: 3,
    enablefilters: false,
    defilter: {
      include: "",
      exclude: "",
      fileSize: "",
      bitrate: "",
      freeSlots: false,
      country: "",
      fileType: "",
      length: "",
      publicFiles: false,
    },
    enable_history: true,
    history: [],
    search_results: true,
    private_search_results: false,
  },
};
