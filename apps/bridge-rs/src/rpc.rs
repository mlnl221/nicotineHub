//! JSON-RPC 2.0 NDJSON client for `soulseek-rs daemon --bind ADDR`.
//!
//! Framing: one JSON value per line, UTF-8, 1 MiB cap. First request must be
//! `auth{"protocol":2}` (+ `token` on TCP). Replies match by `id`; daemon
//! pushes are id-less notifications (`event.*`). Read continuously: per-conn
//! queue is 1024, stalled readers get disconnected.
//! See third_party/soulseek-rs/docs/daemon-protocol.md.

use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc,
    },
};

use anyhow::{anyhow, Context, Result};
use futures::{SinkExt, StreamExt};
use tokio::{
    net::TcpStream,
    sync::{broadcast, mpsc, oneshot},
};
use tokio_util::codec::{Framed, LinesCodec};

/// Negotiated by `auth`. Bump = break. Fail loudly on mismatch.
pub const RPC_PROTOCOL: u64 = 2;

type Pending = Arc<tokio::sync::Mutex<HashMap<u64, oneshot::Sender<serde_json::Value>>>>;

#[derive(Clone)]
pub struct RpcHandle {
    tx: mpsc::UnboundedSender<serde_json::Value>,
    pending: Pending,
    next_id: Arc<AtomicU64>,
}

impl RpcHandle {
    /// Call a daemon method with named (object) params. Notifications
    /// (no id) are never used here: every call awaits its reply.
    pub async fn call(&self, method: &str, params: serde_json::Value) -> Result<serde_json::Value> {
        let id = self.next_id.fetch_add(1, Ordering::SeqCst);
        let (tx, rx) = oneshot::channel();
        self.pending.lock().await.insert(id, tx);
        let req = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params,
        });
        self.tx.send(req).map_err(|_| anyhow!("rpc writer gone"))?;
        let reply = rx.await.map_err(|_| anyhow!("rpc reply dropped"))?;
        if let Some(err) = reply.get("error") {
            return Err(anyhow!("daemon {}: {}", method, err));
        }
        Ok(reply
            .get("result")
            .cloned()
            .unwrap_or(serde_json::Value::Null))
    }
}

/// Connect to the daemon TCP bind, run the handshake, spawn pump tasks.
/// `events` is the broadcast fan-out for `event.*` notifications.
pub async fn connect(
    bind: &str,
    token: &str,
    events: broadcast::Sender<serde_json::Value>,
) -> Result<RpcHandle> {
    let stream = TcpStream::connect(bind)
        .await
        .with_context(|| format!("dial daemon {bind}"))?;
    let framed = Framed::new(stream, LinesCodec::new_with_max_length(1024 * 1024));
    let (mut sink, mut source) = framed.split();
    let (tx, mut rx) = mpsc::unbounded_channel::<serde_json::Value>();
    let pending: Pending = Arc::new(tokio::sync::Mutex::new(HashMap::new()));

    // Writer pump.
    tokio::spawn(async move {
        while let Some(msg) = rx.recv().await {
            let line = serde_json::to_string(&msg).unwrap_or_default();
            if sink.send(line).await.is_err() {
                break;
            }
        }
    });

    // Reader pump: replies by id, events to broadcast. Never stop reading.
    let pending_r = pending.clone();
    tokio::spawn(async move {
        while let Some(line) = source.next().await {
            let line = match line {
                Ok(l) => l,
                Err(_) => break,
            };
            let msg: serde_json::Value = match serde_json::from_str(&line) {
                Ok(m) => m,
                Err(_) => continue, // -32700 territory; daemon stays open, ignore
            };
            if let Some(id) = msg.get("id").and_then(serde_json::Value::as_u64) {
                if let Some(tx) = pending_r.lock().await.remove(&id) {
                    let _ = tx.send(msg);
                }
            } else if msg.get("method").is_some() {
                let _ = events.send(msg);
            }
        }
    });

    let handle = RpcHandle {
        tx,
        pending,
        next_id: Arc::new(AtomicU64::new(1)),
    };

    // Handshake must be first. Token always checked when offered.
    let mut params = serde_json::json!({ "protocol": RPC_PROTOCOL });
    if !token.is_empty() {
        params["token"] = serde_json::Value::String(token.to_string());
    }
    let auth = handle.call("auth", params).await?;
    let proto = auth.get("protocol").and_then(serde_json::Value::as_u64);
    if proto != Some(RPC_PROTOCOL) {
        anyhow::bail!(
            "daemon protocol mismatch: got {:?}, want {}",
            proto,
            RPC_PROTOCOL
        );
    }
    tracing::info!(username = ?auth.get("username"), "daemon auth ok");
    Ok(handle)
}
