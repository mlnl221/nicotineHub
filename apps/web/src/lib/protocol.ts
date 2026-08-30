/**
 * Shared types for the JSON protocol exchanged with the bridge over WebSocket.
 */

export interface LoginRequest {
  type: "login";
  username: string;
  password: string;
  host?: string;
  port?: number;
}

export interface LoginStartMessage {
  type: "login:start";
}

export interface LoginResultSuccess {
  type: "login:result";
  ok: true;
  data: {
    success: true;
    banner: string;
    ipAddress: string;
    checksum: string;
    isSupporter: boolean;
  };
}

export interface LoginResultFailure {
  type: "login:result";
  ok: false;
  error: string;
}

export interface ErrorMessage {
  type: "error";
  error: string;
}

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

export interface SearchRequest {
  type: "search";
  searchId: string;
  query: string;
}

/** Client-side pagination request — fetch next window of cached rows */
export interface SearchPageRequest {
  type: "search:page";
  searchId: string;
  offset: number;
  limit: number;
}

export interface SearchUserRequest {
  type: "search:user";
  searchId: string;
  username: string;
  query: string;
}

export interface SearchRoomRequest {
  type: "search:room";
  searchId: string;
  room: string;
  query: string;
}

export interface SearchWishlistRequest {
  type: "search:wishlist";
  searchId: string;
  query: string;
}

export interface SearchStopRequest {
  type: "search:stop";
  searchId: string;
}

/** Legacy SearchFile shape (used by ResultCard hybrid). */
export interface SearchFile {
  name: string;
  size: number;
  attrs: {
    bitrate?: number;
    length?: number;
    vbr?: number;
    sampleRate?: number;
    bitDepth?: number;
  };
  private?: boolean;
}

/** A single result row, transformed from a peer FileSearchResponse. */
export interface SearchRow {
  user: string;
  folder: string;
  filename: string;
  path: string;
  size: number;
  fileType: string;
  slotFree: boolean;
  speed: number;
  inQueue: number;
  /** bitrate kbps (0 if lossless/unknown) */
  quality: number;
  /** duration seconds (0 if unknown) */
  length: number;
  private: boolean;
  country?: string;
  attributes: {
    bitrate?: number;
    length?: number;
    vbr?: number;
    sampleRate?: number;
    bitDepth?: number;
  };
}

export interface SearchStartMessage {
  type: "search:start";
  searchId: string;
  token: number;
}

export interface SearchResultMessage {
  type: "search:result";
  searchId: string;
  token: number;
  rows: SearchRow[];
  /** Present when this batch came from bridge memory cache (5m TTL) */
  cached?: boolean;
}

export interface SearchEndMessage {
  type: "search:end";
  searchId: string;
  reason: "max_results" | "stopped" | "timeout" | "error";
}

export interface SearchPageMessage {
  type: "search:page";
  searchId: string;
  offset: number;
  limit: number;
  rows: SearchRow[];
  total: number;
  hasMore: boolean;
}

/** Filter state for the result filter bar (full nicotine parity). */
export interface FilterState {
  include: string;
  exclude: string;
  fileType: string;
  size: string;
  bitrate: string;
  length: string;
  country: string;
  freeSlot: boolean;
  publicOnly: boolean;
}

export function emptyFilters(): FilterState {
  return {
    include: "",
    exclude: "",
    fileType: "",
    size: "",
    bitrate: "",
    length: "",
    country: "",
    freeSlot: false,
    publicOnly: false,
  };
}

/* ------------------------------------------------------------------ *
 * Transfers
 * ------------------------------------------------------------------ */

export type TransferStatus =
  | "Queued"
  | "Getting status"
  | "Transferring"
  | "Paused"
  | "Cancelled"
  | "Filtered"
  | "Finished"
  | "User logged off"
  | "Connection closed"
  | "Connection timeout"
  | "Download folder error"
  | "Local file error"
  | "Banned"
  | "File not shared."
  | "File read error."
  | "Pending shutdown."
  | "Too many files"
  | "Too many megabytes";

export interface Transfer {
  id: string;
  username: string;
  virtualPath: string;
  fileName: string;
  size: number;
  current: number;
  speed: number;
  avgSpeed: number;
  timeLeft: number | null;
  status: TransferStatus;
  queuePosition: number | null;
  isUpload: boolean;
}

export interface TransferUpdateMessage {
  type: "transfer:update";
  transfer: Transfer;
}

export interface TransferRemovedMessage {
  type: "transfer:removed";
  id: string;
}

export interface TransferStatsMessage {
  type: "transfer:stats";
  downloadSpeed: number;
  uploadSpeed: number;
  activeDownloads: number;
  activeUploads: number;
  queuedDownloads: number;
  queuedUploads: number;
}

export interface TransferQueueMessage {
  type: "transfer:queue";
  id: string;
  place: number;
}

export interface TransferFinishedMessage {
  type: "transfer:finished";
  id: string;
  fileName: string;
  size: number;
  downloadUrl: string; // GET /files/:token
}

export interface DownloadRequest {
  type: "download:request";
  username: string;
  virtualPath: string;
  size: number;
  fileName?: string;
}

export interface DownloadControlRequest {
  type: "download:control";
  id: string;
  action: "cancel" | "pause" | "resume" | "retry" | "clear";
}

export interface UploadControlRequest {
  type: "upload:control";
  id: string;
  action: "cancel" | "clear";
}

/* ------------------------------------------------------------------ *
 * Chat — private + rooms
 * ------------------------------------------------------------------ */

export interface ChatEvent {
  type: "say-chatroom" | "private-message" | "private-message-acked" | "global-room-message";
  room?: string;
  username?: string;
  message?: string;
  msgId?: number;
  timestamp?: number;
}

export interface RoomEvent {
  type:
    | "join-room"
    | "leave-room"
    | "user-joined-room"
    | "user-left-room"
    | "room-list"
    | "room-members"
    | "room-tickers"
    | "ticker-added"
    | "ticker-removed"
    | "room-member-added"
    | "room-member-removed"
    | "cancel-membership"
    | "cancel-ownership"
    | "membership-granted"
    | "membership-revoked"
    | "operator-added"
    | "operator-removed"
    | "operatorship-granted"
    | "operatorship-revoked"
    | "room-operators"
    | "enable-room-invitations"
    | "privileged-users"
    | "cant-create-room"
    | "admin-message";
  room?: string;
  username?: string;
  data?: unknown;
}

export interface ChatEventMessage {
  type: "chat:event";
  event: ChatEvent;
}

export interface RoomEventMessage {
  type: "room:event";
  event: RoomEvent;
}

export interface ChatRoomRequest {
  type: "chat:room";
  action: "join" | "leave" | "say" | "ticker" | "setTicker" | "addOperator" | "removeOperator" | "cancelMembership" | "cancelOwnership";
  room: string;
  message?: string;
  username?: string;
}

export interface ChatPrivateRequest {
  type: "chat:private";
  action: "send" | "ack";
  username: string;
  message?: string;
  msgId?: number;
}

export interface ChatGlobalRequest {
  type: "chat:global";
  action: "join" | "leave";
}

/* ------------------------------------------------------------------ *
 * Browse shares
 * ------------------------------------------------------------------ */

export interface BrowseFile {
  name: string;
  size: number;
  ext: string;
  attrs: Array<[number, number]>;
}

export interface BrowseFolder {
  name: string;
  files: BrowseFile[];
}

export interface BrowseSharesMessage {
  type: "browse:shares";
  username: string;
  folders: BrowseFolder[];
  error?: string;
  /** Pagination metadata — when present, client should page with browse:page */
  total?: number;
  hasMore?: boolean;
  offset?: number;
}

export interface BrowseFolderMessage {
  type: "browse:folder";
  token: number;
  username: string;
  folder: string;
  files: BrowseFile[];
  error?: string;
  total?: number;
  hasMore?: boolean;
  offset?: number;
}

export interface BrowsePageRequest {
  type: "browse:page";
  username: string;
  offset: number;
  limit: number;
}

export interface BrowseSharesRequest {
  type: "browse";
  action: "shares";
  username: string;
}

export interface BrowseFolderRequest {
  type: "browse";
  action: "folder";
  username: string;
  folder: string;
  token?: number;
}

/* ------------------------------------------------------------------ *
 * User info / profiles
 * ------------------------------------------------------------------ */

export interface UserInfoStatus {
  username: string;
  /** 0 offline, 1 away, 2 online */
  status: number;
  privileged: boolean;
}

export interface UserInfoStats {
  username: string;
  /** average upload speed, bytes/sec */
  avgspeed: number;
  uploadnum: number;
  files: number;
  dirs: number;
}

export interface UserInfoInterests {
  username: string;
  likes: string[];
  hates: string[];
}

export interface UserInfoProfile {
  username: string;
  descr: string;
  /** base64-encoded picture, or null when the user has none */
  pic: string | null;
  totalupl: number;
  queuesize: number;
  slotsavail: boolean;
  uploadallowed: number;
}

export interface Recommendation {
  thing: string;
  rating: number;
}

export interface SimilarUser {
  username: string;
  rating: number;
}

export interface UserInfoEvent {
  type:
    | "user-status"
    | "user-stats"
    | "user-interests"
    | "recommendations"
    | "global-recommendations"
    | "similar-users"
    | "item-recommendations"
    | "item-similar-users"
    | "peer-address"
    | "watch-user"
    | "privileged-users"
    | "check-privileges"
    | "user-info-response"
    | "user-info-failed";
  username?: string;
  status?: UserInfoStatus;
  stats?: UserInfoStats;
  interests?: UserInfoInterests;
  recommendations?: Recommendation[];
  similarUsers?: SimilarUser[];
  info?: UserInfoProfile;
  watchUser?: {
    exists: boolean;
    status?: number;
    avgspeed?: number;
    files?: number;
    dirs?: number;
    country?: string;
  };
  privilegedUsers?: string[];
  checkPrivileges?: number;
  peerAddress?: { ip?: string; port?: number };
}

export interface UserInfoEventMessage {
  type: "userinfo:event";
  event: UserInfoEvent;
}

export interface UserInfoResponseOutbound {
  type: "user-info-response";
  username: string;
  descr: string;
  pic: string | null;
  totalupl: number;
  queuesize: number;
  slotsavail: boolean;
  uploadallowed: number;
}

export interface UserInfoFailedOutbound {
  type: "user-info-failed";
  username: string;
}

export type UserinfoRequestMessage =
  | { type: "userinfo"; action: "watch" | "unwatch" | "get" | "interests" | "peerAddress"; username: string }
  | { type: "userinfo"; action: "recommendations" | "globalRecommendations" | "similarUsers" | "checkPrivileges" }
  | { type: "userinfo"; action: "itemRecommendations" | "itemSimilarUsers"; item: string }
  | { type: "userinfo"; action: "addLike" | "removeLike" | "addHate" | "removeHate"; thing: string }
  | { type: "userinfo"; action: "givePrivileges"; username: string; days: number }
  | { type: "userinfo"; action: "setStatus"; status: number }
  | { type: "userinfo"; action: "changePassword"; password: string }
  | { type: "userinfo"; action: "reportShares"; dirs: number; files: number }
  | {
      type: "userinfo";
      action: "setProfile";
      profile: {
        descr: string;
        pic?: string | null;
        totalupl: number;
        queuesize: number;
        slotsavail: boolean;
        uploadallowed: number;
      };
    };


export interface ServerReconnectMessage {
  type: "server:reconnect";
  attempt: number;
  delay: number;
}
export interface ServerReconnectFailedMessage {
  type: "server:reconnect";
  error: string;
}
export interface ServerReconnectedMessage {
  type: "server:reconnect";
  ok: true;
  listenPort: number;
}

/* ------------------------------------------------------------------ *
 * Heartbeat (bridge <-> web keepalive, 25s)
 * ------------------------------------------------------------------ */

export interface PingRequest {
  type: "ping";
  ts: number;
}

export interface PongMessage {
  type: "pong";
  ts: number;
}

/* ------------------------------------------------------------------ *
 * Diagnostics
 * ------------------------------------------------------------------ */

export type DiagLevel = "debug" | "info" | "warn" | "error";
export type DiagScope = "bridge" | "server" | "peer" | "transfer" | "search" | "chat" | "system" | "auth";

export interface DiagEntry {
  ts: string;
  level: DiagLevel;
  scope: DiagScope;
  msg: string;
  meta?: Record<string, unknown>;
}

export interface DiagnosticsHealth {
  ts: string;
  uptime: number;
  port: number;
  listenPort: number;
  dataDir: string;
  tokenAuth: boolean;
  version?: string;
  commitSha?: string;
  buildDate?: string;
}

export interface DiagnosticsInitMessage {
  type: "diagnostics:init";
  entries: DiagEntry[];
}
export interface DiagnosticsLogMessage {
  type: "diagnostics:log";
  entry: DiagEntry;
}
export interface DiagnosticsHealthMessage {
  type: "diagnostics:health";
  health: DiagnosticsHealth;
}
export interface DiagnosticsClearedMessage {
  type: "diagnostics:cleared";
}
export interface DiagnosticsClearRequest {
  type: "diagnostics:clear";
}
export interface DiagnosticsSubscribeRequest {
  type: "diagnostics:subscribe";
  level?: DiagLevel;
}
export interface DiagnosticsBrowserLogRequest {
  type: "diagnostics:browser-log";
  level?: DiagLevel;
  scope?: DiagScope;
  msg: string;
  meta?: Record<string, unknown>;
}

/* ------------------------------------------------------------------ *
 * Plugins
 * ------------------------------------------------------------------ */

export interface PluginInfo {
  name: string;
  humanName: string;
  enabled: boolean;
  isInternal: boolean;
  info: Record<string, unknown>;
  settings?: Record<string, unknown> | null;
  metasettings?: Record<string, unknown> | null;
}

export interface PluginListRequest {
  type: "plugin:list";
}
export interface PluginToggleRequest {
  type: "plugin:toggle";
  name: string;
}
export interface PluginReloadRequest {
  type: "plugin:reload";
  name: string;
}
export interface PluginUninstallRequest {
  type: "plugin:uninstall";
  name: string;
}
export interface PluginSettingsRequest {
  type: "plugin:settings";
  name: string;
  settings: Record<string, unknown>;
}
export interface PluginResetSettingsRequest {
  type: "plugin:resetSettings";
  name: string;
}
export interface PluginInstallRequest {
  type: "plugin:install";
  fileName?: string;
  data: string; // base64 zip
}
export interface PluginInstallUrlRequest {
  type: "plugin:installUrl";
  url: string;
}
export interface PluginInstallGithubTsRequest {
  type: "plugin:installGithubTs";
  url: string;
}

export interface PluginListMessage {
  type: "plugin:list";
  plugins: PluginInfo[];
}
export interface PluginInstalledMessage {
  type: "plugin:installed";
  name: string;
  ok: boolean;
}
export interface PluginToggledMessage {
  type: "plugin:toggled";
  name: string;
  enabled: boolean;
}
export interface PluginReloadedMessage {
  type: "plugin:reloaded";
  name: string;
}
export interface PluginUninstalledMessage {
  type: "plugin:uninstalled";
  name: string;
  ok: boolean;
}
export interface PluginOutputMessage {
  type: "plugin:output";
  plugin: string;
  text: string;
}

export type BridgeOutboundMessage =
  | LoginStartMessage
  | LoginResultSuccess
  | LoginResultFailure
  | ErrorMessage
  | SearchStartMessage
  | SearchResultMessage
  | SearchEndMessage
  | SearchPageMessage
  | TransferUpdateMessage
  | TransferRemovedMessage
  | TransferStatsMessage
  | TransferQueueMessage
  | TransferFinishedMessage
  | UserInfoEventMessage
  | UserInfoResponseOutbound
  | UserInfoFailedOutbound
  | ChatEventMessage
  | RoomEventMessage
  | BrowseSharesMessage
  | BrowseFolderMessage
  | ServerReconnectMessage
  | ServerReconnectFailedMessage
  | ServerReconnectedMessage
  | DiagnosticsInitMessage
  | DiagnosticsLogMessage
  | DiagnosticsHealthMessage
  | DiagnosticsClearedMessage
  | PluginListMessage
  | PluginInstalledMessage
  | PluginToggledMessage
  | PluginReloadedMessage
  | PluginUninstalledMessage
  | PluginOutputMessage
  | PongMessage;

export type BridgeInboundMessage =
  | LoginRequest
  | SearchRequest
  | SearchUserRequest
  | SearchRoomRequest
  | SearchWishlistRequest
  | SearchStopRequest
  | SearchPageRequest
  | DownloadRequest
  | DownloadControlRequest
  | UploadControlRequest
  | ChatRoomRequest
  | ChatPrivateRequest
  | ChatGlobalRequest
  | BrowseSharesRequest
  | BrowseFolderRequest
  | BrowsePageRequest
  | UserinfoRequestMessage
  | DiagnosticsClearRequest
  | DiagnosticsSubscribeRequest
  | DiagnosticsBrowserLogRequest
  | PluginListRequest
  | PluginToggleRequest
  | PluginReloadRequest
  | PluginUninstallRequest
  | PluginSettingsRequest
  | PluginResetSettingsRequest
  | PluginInstallRequest
  | PluginInstallUrlRequest
  | PluginInstallGithubTsRequest
  | PingRequest;
