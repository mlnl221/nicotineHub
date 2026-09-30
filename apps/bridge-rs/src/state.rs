//! Shared shim state: env config + handles owned by main.rs.
//!
//! Wire contract (must stay compatible with apps/web):
//! WS frames are JSON objects with a `type` field, e.g.
//! `{"type":"ping","ts":123}` -> `{"type":"pong","ts":123}`.
//! See apps/bridge/src/server.ts for the full 40-in/25-out set.

use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use tokio::sync::{broadcast, mpsc};

use crate::rpc::RpcHandle;

/// All runtime configuration, read from env (see Dockerfile + compose.yaml).
#[derive(Debug, Clone)]
pub struct ShimConfig {
    /// HTTP+WS port. Default 8787.
    pub port: u16,
    /// Soulseek peer listener port. Default 2234 (adopted upstream).
    pub listen_port: u16,
    /// Autobrr-style config dir. Default /config.
    pub config_dir: PathBuf,
    /// Data dir. Default /data.
    pub data_dir: PathBuf,
    /// Edge auth token (WS subprotocol/query + HTTP Bearer). Empty = open.
    pub bridge_token: String,
    /// Daemon control bind. Loopback only (no TLS upstream).
    pub daemon_bind: String,
    /// Daemon binary. Default `soulseek-rs` on PATH.
    pub daemon_bin: String,
    /// Allowed browser origins, comma-separated. Empty = same-origin only.
    pub allowed_origins: Vec<String>,
}

impl ShimConfig {
    pub fn from_env() -> Self {
        let port = env_u16("PORT", 8787);
        // ponytail: single from_env, no builder; add fields when needed.
        Self {
            port,
            listen_port: env_u16("LISTEN_PORT", 2234),
            config_dir: PathBuf::from(env_str("CONFIG_DIR", "/config")),
            data_dir: PathBuf::from(env_str("DATA_DIR", "/data")),
            bridge_token: env_str("BRIDGE_TOKEN", ""),
            daemon_bind: env_str("DAEMON_BIND", "127.0.0.1:5030"),
            daemon_bin: env_str("DAEMON_BIN", "soulseek-rs"),
            allowed_origins: env_str("ALLOWED_ORIGINS", "")
                .split(',')
                .filter(|s| !s.trim().is_empty())
                .map(|s| s.trim().to_string())
                .collect(),
        }
    }

    pub fn state_dir(&self) -> PathBuf {
        std::env::var("SOULSEEK_STATE_DIR")
            .map(PathBuf::from)
            .unwrap_or_else(|_| self.config_dir.join("slsk-rs/state"))
    }

    pub fn daemon_token_path(&self) -> PathBuf {
        self.state_dir().join("daemon.token")
    }
}

fn env_str(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn env_u16(key: &str, default: u16) -> u16 {
    std::env::var(key)
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(default)
}

/// Commands to the daemon supervisor (owns the child process).
#[derive(Debug)]
pub enum SupervisorCmd {
    /// (Re)start daemon with these Soulseek credentials.
    Login { username: String, password: String },
    /// Stop daemon, clear credentials.
    Logout,
    /// Restart daemon (e.g. listener port change).
    Restart,
}

/// Shared handles cloned into every WS connection / HTTP handler.
#[derive(Clone)]
pub struct AppState {
    pub config: ShimConfig,
    /// None until the daemon boots (lazy: first `login` or env creds).
    /// Never auto-boot with dummy creds: the server mints an account per
    /// new username, so placeholders litter real accounts.
    pub rpc: Arc<tokio::sync::RwLock<Option<RpcHandle>>>,
    pub supervisor_tx: mpsc::UnboundedSender<SupervisorCmd>,
    /// Fan-out of daemon events (`event.room`, `event.download_status`, ...).
    pub events: broadcast::Sender<serde_json::Value>,
    /// `/files/:token` registry: token -> absolute path. 24h expiry.
    pub file_tokens: Arc<Mutex<HashMap<String, (PathBuf, std::time::Instant)>>>,
}

impl AppState {
    /// Daemon call with 10s cap. Errors when the daemon is not booted.
    pub async fn call_rpc(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> anyhow::Result<serde_json::Value> {
        let rpc = self
            .rpc
            .read()
            .await
            .clone()
            .ok_or_else(|| anyhow::anyhow!("daemon not started (login first)"))?;
        tokio::time::timeout(std::time::Duration::from_secs(10), rpc.call(method, params))
            .await
            .map_err(|_| anyhow::anyhow!("daemon {method} timed out"))?
            .map_err(|e| anyhow::anyhow!("{e:#}"))
    }

    pub fn file_token_ttl() -> std::time::Duration {
        // Matches FILE_TOKEN_MAX_AGE_MS in apps/bridge/src/server.ts.
        std::time::Duration::from_secs(24 * 3600)
    }
}
