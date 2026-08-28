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

export interface SearchRequest {
  type: "search";
  query: string;
}

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
}

export interface SearchStartMessage {
  type: "search:start";
  token: number;
}

export interface SearchResultMessage {
  type: "search:result";
  token: number;
  username: string;
  freeUploadSlots: boolean;
  uploadSpeed: number;
  inQueue: number;
  results: SearchFile[];
}

export interface SearchDoneMessage {
  type: "search:done";
  token: number;
}

export type BridgeOutboundMessage =
  | LoginStartMessage
  | LoginResultSuccess
  | LoginResultFailure
  | ErrorMessage
  | SearchStartMessage
  | SearchResultMessage
  | SearchDoneMessage;

export type BridgeInboundMessage = LoginRequest | SearchRequest;
