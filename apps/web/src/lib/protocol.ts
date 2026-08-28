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

export type BridgeOutboundMessage = LoginStartMessage | LoginResultSuccess | LoginResultFailure | ErrorMessage;
