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
}

export interface SearchEndMessage {
  type: "search:end";
  searchId: string;
  reason: "max_results" | "stopped" | "timeout" | "error";
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
    | "user-info-response"
    | "user-info-failed";
  username?: string;
  status?: UserInfoStatus;
  stats?: UserInfoStats;
  interests?: UserInfoInterests;
  recommendations?: Recommendation[];
  similarUsers?: SimilarUser[];
  info?: UserInfoProfile;
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
  | { type: "userinfo"; action: "watch" | "unwatch" | "get" | "interests"; username: string }
  | { type: "userinfo"; action: "recommendations" | "globalRecommendations" | "similarUsers" }
  | { type: "userinfo"; action: "itemRecommendations" | "itemSimilarUsers"; item: string }
  | { type: "userinfo"; action: "addLike" | "removeLike" | "addHate" | "removeHate"; thing: string }
  | { type: "userinfo"; action: "givePrivileges"; username: string; days: number }
  | { type: "userinfo"; action: "setStatus"; status: number }
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

export type BridgeOutboundMessage =
  | LoginStartMessage
  | LoginResultSuccess
  | LoginResultFailure
  | ErrorMessage
  | SearchStartMessage
  | SearchResultMessage
  | SearchEndMessage
  | TransferUpdateMessage
  | TransferRemovedMessage
  | TransferStatsMessage
  | UserInfoEventMessage
  | UserInfoResponseOutbound
  | UserInfoFailedOutbound
  | ServerReconnectMessage
  | ServerReconnectFailedMessage;

export type BridgeInboundMessage =
  | LoginRequest
  | SearchRequest
  | SearchStopRequest
  | DownloadRequest
  | DownloadControlRequest
  | UploadControlRequest
  | UserinfoRequestMessage;
