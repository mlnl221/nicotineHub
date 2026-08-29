/**
 * Client-side default settings, mirroring the Nicotine+ `config.defaults` shape
 * (section → key → value). Only the settings relevant to the browser client are
 * included; desktop-only keys are omitted (see docs/settings-mapping.md and
 * docs/settings-plan.md Phase A).
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

export type SharedFolder = [string, string]; // [virtualName, path]

export interface Settings {
  server: {
    server: NetworkServer;
    login: string;
    auto_connect_startup: boolean;
    autoaway: number;
    private_chatrooms: boolean;
    banlist: string[];
    ignorelist: string[];
    ipblocklist: Record<string, string>;
    ipignorelist: Record<string, string>;
  };
  ui: {
    dark_mode: boolean;
    language: string;
    reverse_file_paths: boolean;
    file_size_unit: "B" | "";
    usernamehotspots: boolean;
    usernamestyle: "bold" | "italic" | "underline" | "normal" | "hyperlinks" | "none";
    spellcheck: boolean;
    header_bar: boolean;
    tabclosers: boolean;
    tab_select_previous: boolean;
    buddylistinchatrooms: "tab" | "chatrooms" | "always";
    exitdialog: number;
  };
  notifications: {
    notification_window_title: boolean;
    notification_tab_colors: boolean;
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
    filters_visible: boolean;
    expand_results: string;
    group_searches: string;
  };
  transfers: {
    shared: SharedFolder[];
    buddyshared: SharedFolder[];
    trustedshared: SharedFolder[];
    share_filters: string[];
    rescanonstartup: boolean;
    rescan_shares_daily: boolean;
    rescan_shares_hour: number;
    reveal_buddy_shares: boolean;
    reveal_trusted_shares: boolean;
    incompletedir: string;
    downloaddir: string;
    uploaddir: string;
    uploadbandwidth: number;
    useupslots: boolean;
    uploadslots: number;
    uploadlimit: number;
    uploadlimitalt: number;
    use_upload_speed_limit: "unlimited" | "primary" | "alternative";
    use_download_speed_limit: "unlimited" | "primary" | "alternative";
    downloadlimit: number;
    downloadlimitalt: number;
    fifoqueue: boolean;
    limitby: boolean;
    queuelimit: number;
    filelimit: number;
    friendsnolimits: boolean;
    preferfriends: boolean;
    autoclear_downloads: boolean;
    autoclear_uploads: boolean;
    remotedownloads: boolean;
    uploadallowed: 0 | 2 | 3;
    enablefilters: boolean;
    downloadfilters: [string, number][];
    download_doubleclick: number;
    upload_doubleclick: number;
    usernamesubfolders: boolean;
    groupdownloads: string;
    groupuploads: string;
    expand_downloads: string;
    expand_uploads: string;
    usecustomban: boolean;
    customban: string;
    usecustomgeoblock: boolean;
    customgeoblock: string;
    geoblock: boolean;
    geoblockcc: string[];
  };
  userinfo: {
    descr: string;
    pic: string;
    picture_visible: boolean;
  };
  words: {
    censored: string[];
    autoreplaced: Record<string, string>;
    keywords: string[];
    censorwords: boolean;
    replacewords: boolean;
    watch_keywords: boolean;
    tab: boolean;
    dropdown: boolean;
    characters: number;
    roomnames: boolean;
    buddies: boolean;
    roomusers: boolean;
    commands: boolean;
  };
  logging: {
    privatechat: boolean;
    privatelogsdir: string;
    chatrooms: boolean;
    roomlogsdir: string;
    transfers: boolean;
    transferslogsdir: string;
    debug_file_output: boolean;
    debuglogsdir: string;
    log_timestamp: string;
    rooms_timestamp: string;
    private_timestamp: string;
    readroomlines: number;
    readprivatelines: number;
    logcollapsed: boolean;
    debug: boolean;
  };
  privatechat: {
    store: boolean;
  };
  players: {
    npplayer: string;
    npformat: string;
    npothercommand: string;
    npformatlist: string[];
  };
  urls: {
    protocols: Record<string, string>;
  };
  plugins: {
    enable: boolean;
    enabled: string[];
  };
  ctcp: {
    enable: boolean;
  };
}

export const DEFAULT_SERVER_HOST = "server.slsknet.org";
export const DEFAULT_SERVER_PORT = 2242;

// Mirrors pynicotine/config.py defaults (browser-relevant subset)
export const defaults: Settings = {
  server: {
    server: { host: DEFAULT_SERVER_HOST, port: DEFAULT_SERVER_PORT },
    login: "",
    auto_connect_startup: true,
    autoaway: 15,
    private_chatrooms: false,
    banlist: [],
    ignorelist: [],
    ipblocklist: {},
    ipignorelist: {},
  },
  ui: {
    dark_mode: false,
    language: "",
    reverse_file_paths: true,
    file_size_unit: "",
    usernamehotspots: true,
    usernamestyle: "bold",
    spellcheck: true,
    header_bar: true,
    tabclosers: true,
    tab_select_previous: true,
    buddylistinchatrooms: "tab",
    exitdialog: 1,
  },
  notifications: {
    notification_window_title: true,
    notification_tab_colors: false,
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
    filters_visible: false,
    expand_results: "all",
    group_searches: "folder_grouping",
  },
  transfers: {
    shared: [],
    buddyshared: [],
    trustedshared: [],
    share_filters: [".*", ".*\\", "@eaDir\\", "#recycle\\", "#snapshot\\", "desktop.ini", "Thumbs.db"],
    rescanonstartup: true,
    rescan_shares_daily: true,
    rescan_shares_hour: 0,
    reveal_buddy_shares: false,
    reveal_trusted_shares: false,
    incompletedir: "${NICOTINE_DATA_HOME}/incomplete",
    downloaddir: "${NICOTINE_DATA_HOME}/downloads",
    uploaddir: "${NICOTINE_DATA_HOME}/received",
    uploadbandwidth: 50,
    useupslots: true,
    uploadslots: 3,
    uploadlimit: 1000,
    uploadlimitalt: 100,
    use_upload_speed_limit: "unlimited",
    use_download_speed_limit: "unlimited",
    downloadlimit: 1000,
    downloadlimitalt: 100,
    fifoqueue: false,
    limitby: true,
    queuelimit: 10000,
    filelimit: 100,
    friendsnolimits: false,
    preferfriends: false,
    autoclear_downloads: false,
    autoclear_uploads: false,
    remotedownloads: false,
    uploadallowed: 3,
    enablefilters: false,
    downloadfilters: [
      ["*.DS_Store", 1],
      ["*.exe", 1],
      ["*.msi", 1],
      ["desktop.ini", 1],
      ["Thumbs.db", 1],
    ],
    download_doubleclick: 2,
    upload_doubleclick: 2,
    usernamesubfolders: false,
    groupdownloads: "folder_grouping",
    groupuploads: "folder_grouping",
    expand_downloads: "all",
    expand_uploads: "all",
    usecustomban: false,
    customban: "Banned, don't bother retrying",
    usecustomgeoblock: false,
    customgeoblock: "Sorry, your country is blocked",
    geoblock: false,
    geoblockcc: [""],
  },
  userinfo: {
    descr: "''",
    pic: "",
    picture_visible: true,
  },
  words: {
    censored: [],
    autoreplaced: {
      "teh ": "the ",
      "taht ": "that ",
      "tihng": "thing",
      "youre": "you're",
      "jsut": "just",
      "thier": "their",
      "tihs": "this",
    },
    keywords: [],
    censorwords: false,
    replacewords: false,
    watch_keywords: false,
    tab: true,
    dropdown: false,
    characters: 3,
    roomnames: false,
    buddies: true,
    roomusers: true,
    commands: true,
  },
  logging: {
    privatechat: true,
    privatelogsdir: "${NICOTINE_DATA_HOME}/logs/private",
    chatrooms: true,
    roomlogsdir: "${NICOTINE_DATA_HOME}/logs/rooms",
    transfers: false,
    transferslogsdir: "${NICOTINE_DATA_HOME}/logs/transfers",
    debug_file_output: false,
    debuglogsdir: "${NICOTINE_DATA_HOME}/logs/debug",
    log_timestamp: "%x %X",
    rooms_timestamp: "%X",
    private_timestamp: "%x %X",
    readroomlines: 200,
    readprivatelines: 200,
    logcollapsed: true,
    debug: false,
  },
  privatechat: {
    store: true,
  },
  players: {
    npplayer: "mpris",
    npformat: "",
    npothercommand: "",
    npformatlist: [],
  },
  urls: {
    protocols: {},
  },
  plugins: {
    enable: true,
    enabled: [],
  },
  ctcp: {
    enable: true,
  },
};
