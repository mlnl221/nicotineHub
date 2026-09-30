//! nicotine-shim: axum edge (:8787 /ws + HTTP) over a `soulseek-rs daemon`
//! child (JSON-RPC on 127.0.0.1:5030). Same image, shim boots daemon.
//!
//! Usage: nicotine-shim [serve|healthcheck|migrate]

mod files;
mod http;
mod migrate;
mod rpc;
mod state;
mod ws;

use std::{collections::HashMap, sync::Arc};

use anyhow::{Context, Result};
use tokio::{
    net::TcpListener,
    process::Command,
    sync::{broadcast, mpsc},
};
use tracing_subscriber::EnvFilter;

use crate::state::{AppState, ShimConfig, SupervisorCmd};

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .init();
    let arg = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "serve".to_string());
    let config = ShimConfig::from_env();
    match arg.as_str() {
        "healthcheck" => healthcheck(&config).await,
        "migrate" => migrate::run(&config).await,
        _ => serve(config).await,
    }
}

/// Docker HEALTHCHECK: GET /health must be 200 within 5s.
async fn healthcheck(config: &ShimConfig) -> Result<()> {
    let body = "GET /health HTTP/1.0\r\nHost: localhost\r\nConnection: close\r\n\r\n";
    let dial = tokio::net::TcpStream::connect(("127.0.0.1", config.port));
    let mut stream = tokio::time::timeout(std::time::Duration::from_secs(3), dial)
        .await
        .context("healthcheck dial timed out")?
        .context("dial self")?;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    stream.write_all(body.as_bytes()).await?;
    let mut buf = vec![0u8; 512];
    let n = stream.read(&mut buf).await?;
    let head = String::from_utf8_lossy(&buf[..n]);
    if head.contains("200") {
        Ok(())
    } else {
        anyhow::bail!("unhealthy: {head}")
    }
}

async fn serve(config: ShimConfig) -> Result<()> {
    std::fs::create_dir_all(&config.config_dir)?;
    std::fs::create_dir_all(config.data_dir.join("downloads"))?;
    std::fs::create_dir_all(config.data_dir.join("incomplete"))?;
    std::fs::create_dir_all(config.data_dir.join("uploads"))?;

    let (sup_tx, sup_rx) = mpsc::unbounded_channel::<SupervisorCmd>();
    let (evt_tx, _) = broadcast::channel::<serde_json::Value>(1024);
    let rpc_slot: Arc<tokio::sync::RwLock<Option<rpc::RpcHandle>>> =
        Arc::new(tokio::sync::RwLock::new(None));

    // Supervisor owns the daemon child. Lazy boot: no creds persisted, so
    // the daemon starts on first web `login` (or immediately with the
    // homelab opt-in SOULSEEK_USERNAME/SOULSEEK_PASSWORD env pair).
    let sup = Supervisor {
        config: config.clone(),
        rx: sup_rx,
        rpc: rpc_slot.clone(),
        events: evt_tx.clone(),
        creds: env_creds(),
        child: Arc::new(tokio::sync::Mutex::new(None)),
    };
    if sup.creds.is_some() {
        let _ = sup.boot().await.map_err(|e| {
            tracing::warn!("{e:#}");
            e
        });
    } else {
        tracing::info!("daemon lazy: waiting for first login");
    }
    tokio::spawn(async move { sup.run().await });

    let state = AppState {
        config: config.clone(),
        rpc: rpc_slot,
        supervisor_tx: sup_tx,
        events: evt_tx,
        file_tokens: Arc::new(std::sync::Mutex::new(HashMap::new())),
    };
    // Seed daemon shares/search-window from migrated config. TODO(full).
    let app = http::router(state);
    let listener = TcpListener::bind(("0.0.0.0", config.port)).await?;
    tracing::info!(port = config.port, "shim listening");
    axum::serve(listener, app).await?;
    Ok(())
}

/// Homelab opt-in auto-login pair. Memory only, never written to disk.
fn env_creds() -> Option<(String, String)> {
    match (
        std::env::var("SOULSEEK_USERNAME").ok(),
        std::env::var("SOULSEEK_PASSWORD").ok(),
    ) {
        (Some(u), Some(p)) if !u.is_empty() && !p.is_empty() => Some((u, p)),
        _ => None,
    }
}

struct Supervisor {
    config: ShimConfig,
    rx: mpsc::UnboundedReceiver<SupervisorCmd>,
    rpc: Arc<tokio::sync::RwLock<Option<rpc::RpcHandle>>>,
    events: broadcast::Sender<serde_json::Value>,
    /// Last login pair, memory only (no password persistence).
    creds: Option<(String, String)>,
    child: Arc<tokio::sync::Mutex<Option<tokio::process::Child>>>,
}

impl Supervisor {
    /// Spawn the daemon and attach RPC. Reuses daemon.token across restarts.
    async fn boot(&self) -> Result<()> {
        let mut child = self.spawn().await?;
        // Kill child if the RPC attach fails, so no orphan daemon lingers.
        let attach = async {
            // Token file persists across restarts, so its presence does not
            // mean the NEW daemon is bound yet. Poll TCP until it answers.
            let mut attempts = 0;
            loop {
                let dial = tokio::net::TcpStream::connect(&self.config.daemon_bind);
                if tokio::time::timeout(std::time::Duration::from_secs(2), dial)
                    .await
                    .ok()
                    .is_some_and(|r| r.is_ok())
                {
                    break;
                }
                attempts += 1;
                if attempts >= 60 {
                    anyhow::bail!("timeout waiting for daemon {}", self.config.daemon_bind);
                }
                tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            }
            let token = wait_token(&self.config).await?;
            let rpc = rpc::connect(&self.config.daemon_bind, &token, self.events.clone()).await?;
            *self.rpc.write().await = Some(rpc);
            Ok::<_, anyhow::Error>(())
        };
        if let Err(e) = attach.await {
            let _ = child.kill().await;
            return Err(e);
        }
        // Track the child: it dies with the shim (kill_on_drop). Stash the
        // handle so restarts can kill it explicitly.
        *self.child.lock().await = Some(child);
        Ok(())
    }

    fn spawn(&self) -> impl std::future::Future<Output = Result<tokio::process::Child>> + '_ {
        async move {
            let mut cmd = Command::new(&self.config.daemon_bin);
            cmd.arg("daemon")
                .arg("--bind")
                .arg(&self.config.daemon_bind)
                .env(
                    "SOULSEEK_CONFIG_DIR",
                    self.config.config_dir.join("slsk-rs"),
                )
                .env("SOULSEEK_STATE_DIR", self.config.state_dir())
                .env(
                    "SOULSEEK_DOWNLOAD_DIR",
                    self.config.data_dir.join("downloads"),
                )
                .env(
                    "SOULSEEK_LISTENER_PORT",
                    self.config.listen_port.to_string(),
                )
                .kill_on_drop(true);
            if let Some((u, p)) = &self.creds {
                cmd.env("SOULSEEK_USERNAME", u).env("SOULSEEK_PASSWORD", p);
            }
            cmd.spawn().context("spawn soulseek-rs daemon")
        }
    }

    async fn run(mut self) {
        while let Some(cmd) = self.rx.recv().await {
            tracing::info!(?cmd, "supervisor cmd");
            match cmd {
                SupervisorCmd::Login { username, password } => {
                    // Web re-sends login on every WS reconnect; skip the
                    // reboot when the live session already matches (keeps
                    // searches/transfers running across socket flaps).
                    if self
                        .creds
                        .as_ref()
                        .is_some_and(|(u, p)| *u == username && *p == password)
                        && self.session_user().await.is_some_and(|u| u == username)
                    {
                        tracing::info!("daemon session already up, skip reboot");
                        continue;
                    }
                    self.creds = Some((username, password));
                    self.kill_child().await;
                    *self.rpc.write().await = None;
                    if let Err(e) = self.boot().await {
                        tracing::warn!("daemon boot failed: {e:#}");
                    }
                }
                SupervisorCmd::Logout => {
                    self.creds = None;
                    self.kill_child().await;
                    *self.rpc.write().await = None;
                    // Lazy: no respawn until next login.
                }
                SupervisorCmd::Restart => {
                    self.kill_child().await;
                    *self.rpc.write().await = None;
                    if self.creds.is_some() {
                        if let Err(e) = self.boot().await {
                            tracing::warn!("daemon reboot failed: {e:#}");
                        }
                    }
                }
            }
        }
    }

    async fn kill_child(&self) {
        if let Some(mut child) = self.child.lock().await.take() {
            let _ = child.kill().await;
        }
    }

    /// Username of the live daemon session, if any (2s cap).
    async fn session_user(&self) -> Option<String> {
        let rpc = self.rpc.read().await.clone()?;
        let res = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            rpc.call("daemon.status", serde_json::json!({})),
        )
        .await
        .ok()?
        .ok()?;
        let u = res.get("username")?.as_str()?;
        (!u.is_empty()).then(|| u.to_string())
    }
}

/// Poll for daemon.token up to 30s (daemon generates on first start).
async fn wait_token(config: &ShimConfig) -> Result<String> {
    let path = config.daemon_token_path();
    for _ in 0..60 {
        if let Ok(t) = std::fs::read_to_string(&path) {
            let t = t.trim().to_string();
            if !t.is_empty() {
                return Ok(t);
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    anyhow::bail!("timeout waiting for {}", path.display())
}
