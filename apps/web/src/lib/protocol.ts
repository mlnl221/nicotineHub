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

export type BridgeOutboundMessage =
  | LoginStartMessage
  | LoginResultSuccess
  | LoginResultFailure
  | ErrorMessage
  | SearchStartMessage
  | SearchResultMessage
  | SearchEndMessage;

export type BridgeInboundMessage = LoginRequest | SearchRequest | SearchStopRequest;
