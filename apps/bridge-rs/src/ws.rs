//! WS `/ws` contract: 40-in/25-out JSON `{type,...}` frames.
//! Must stay compatible with apps/web (session.tsx, search.tsx,
//! transfers.tsx, rooms.tsx, ...). Reference: apps/bridge/src/server.ts.
//! Daemon surface: third_party/soulseek-rs/soulseek-rs/docs/openrpc.json.

use std::{
    collections::{HashMap, HashSet},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::Duration,
};

use axum::extract::ws::{Message, WebSocket};
use futures::{SinkExt, StreamExt};
use tokio::sync::mpsc;

use crate::state::{AppState, SupervisorCmd};

type OutTx = mpsc::UnboundedSender<serde_json::Value>;

/// Active search poll tasks keyed by web `searchId` (abort on stop/forget).
fn searches() -> &'static Mutex<HashMap<String, tokio::task::JoinHandle<()>>> {
    static M: OnceLock<Mutex<HashMap<String, tokio::task::JoinHandle<()>>>> = OnceLock::new();
    M.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Last `event.browse` directories keyed by lowercase username (for `browse:page`).
fn browse_stash() -> &'static Mutex<HashMap<String, serde_json::Value>> {
    static M: OnceLock<Mutex<HashMap<String, serde_json::Value>>> = OnceLock::new();
    M.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Known download sizes keyed by `username\x00filename` (completed events carry no size).
fn dl_sizes() -> &'static Mutex<HashMap<String, u64>> {
    static M: OnceLock<Mutex<HashMap<String, u64>>> = OnceLock::new();
    M.get_or_init(|| Mutex::new(HashMap::new()))
}

pub async fn handle(socket: WebSocket, state: AppState) {
    let (mut sink, mut source) = socket.split();
    // ponytail: single writer task via outbox channel; dispatch spawns per
    // frame so a 10s search window never blocks the read loop. Split into
    // per-direction tasks when backpressure observed.
    let (out_tx, mut out_rx) = mpsc::unbounded_channel::<serde_json::Value>();
    let mut events = state.events.subscribe();
    // Session frames already pushed on this connection. A slow attach
    // snapshot must not clobber a newer login:result/session:status.
    let settled = Arc::new(std::sync::atomic::AtomicBool::new(false));

    // Attach snapshot: best-effort live status, fallback logged-out.
    // Dropped when stale (login beat it) or slow (>3s).
    {
        let st = state.clone();
        let tx = out_tx.clone();
        let settled = settled.clone();
        tokio::spawn(async move {
            let status = tokio::time::timeout(Duration::from_secs(3), session_status(&st))
                .await
                .unwrap_or_else(|_| serde_json::json!({"type":"session:status","loggedIn":false}));
            if !settled.swap(true, Ordering::SeqCst) {
                send(&tx, status);
            }
        });
    }

    loop {
        tokio::select! {
            msg = source.next() => {
                let Some(msg) = msg else { break };
                let Ok(msg) = msg else { break };
                let text = match msg {
                    Message::Text(t) => t.to_string(),
                    Message::Close(_) => break,
                    _ => continue,
                };
                if text.len() > 1_000_000 {
                    break; // homelab guard, mirrors server.ts:1361
                }
                let req: serde_json::Value = match serde_json::from_str(&text) {
                    Ok(v) => v,
                    Err(_) => {
                        send(&out_tx, serde_json::json!({"type":"error","message":"Invalid JSON payload."}));
                        continue;
                    }
                };
                let st = state.clone();
                let tx = out_tx.clone();
                let settled = settled.clone();
                tokio::spawn(async move { dispatch(&st, req, &tx, &settled).await });
            }
            evt = events.recv() => {
                let Ok(evt) = evt else { break };
                // ponytail: push fan-out is fire-and-forget; translate drops
                // unknown daemon methods silently, add mapping when daemon grows.
                if let Some(out) = translate_event(evt) {
                    if sink.send(Message::Text(out.to_string().into())).await.is_err() {
                        break;
                    }
                }
            }
            out = out_rx.recv() => {
                let Some(out) = out else { break };
                if sink.send(Message::Text(out.to_string().into())).await.is_err() {
                    break;
                }
            }
        }
    }
}

fn send(tx: &OutTx, v: serde_json::Value) {
    let _ = tx.send(v);
}

fn err(tx: &OutTx, message: impl Into<String>) {
    send(
        tx,
        serde_json::json!({"type":"error","message":message.into()}),
    );
}

fn s(v: &serde_json::Value, k: &str) -> String {
    v.get(k).and_then(|x| x.as_str()).unwrap_or("").to_string()
}

fn u64f(v: &serde_json::Value, k: &str) -> u64 {
    v.get(k).and_then(|x| x.as_u64()).unwrap_or(0)
}

/// Stable web `token` for a query (daemon tokens are per-peer; web wants one per search).
fn query_token(query: &str) -> u32 {
    let mut h: u32 = 2166136261;
    for b in query.bytes() {
        h ^= b as u32;
        h = h.wrapping_mul(16777619);
    }
    h
}

async fn rpc_call(
    state: &AppState,
    method: &str,
    params: serde_json::Value,
) -> anyhow::Result<serde_json::Value> {
    tokio::time::timeout(Duration::from_secs(10), state.call_rpc(method, params))
        .await
        .map_err(|_| anyhow::anyhow!("daemon {method} timed out"))?
        .map_err(|e| anyhow::anyhow!("{e:#}"))
}

async fn daemon_status(state: &AppState) -> serde_json::Value {
    rpc_call(state, "daemon.status", serde_json::json!({}))
        .await
        .unwrap_or(serde_json::Value::Null)
}

async fn session_status(state: &AppState) -> serde_json::Value {
    let st = daemon_status(state).await;
    let user = st.get("username").and_then(|u| u.as_str()).unwrap_or("");
    if !user.is_empty() {
        serde_json::json!({"type":"session:status","loggedIn":true,"username":user})
    } else {
        serde_json::json!({"type":"session:status","loggedIn":false})
    }
}

/// Route one incoming `{type,...}` frame. Multi-frame replies (search window,
/// browse, logs) are pushed via `out`; errors are single `{type:error}` frames.
async fn dispatch(
    state: &AppState,
    req: serde_json::Value,
    out: &OutTx,
    settled: &Arc<AtomicBool>,
) {
    // Any explicit session frame settles the connection (see attach snapshot).
    let settle = || settled.store(true, Ordering::SeqCst);
    let t = req.get("type").and_then(|v| v.as_str()).unwrap_or("");
    match t {
        // ---- session ----
        "login" => {
            let username = s(&req, "username");
            let password = s(&req, "password");
            if username.is_empty() || password.is_empty() {
                err(out, "Invalid login message.");
                return;
            }
            send(out, serde_json::json!({"type":"login:start"}));
            let _ = state.supervisor_tx.send(SupervisorCmd::Login {
                username: username.clone(),
                password,
            });
            // Poll daemon.status until the new session reports our username.
            for _ in 0..30 {
                tokio::time::sleep(Duration::from_secs(1)).await;
                let st = daemon_status(state).await;
                if st.get("username").and_then(|u| u.as_str()) == Some(username.as_str()) {
                    settle();
                    send(
                        out,
                        serde_json::json!({"type":"login:result","ok":true,"data":{"success":true,"username":username}}),
                    );
                    send(out, session_status(state).await);
                    return;
                }
            }
            err(out, "Login timed out waiting for daemon session.");
        }
        "logout" => {
            let _ = state.supervisor_tx.send(SupervisorCmd::Logout);
            settle();
            send(
                out,
                serde_json::json!({"type":"session:ended","reason":"logout"}),
            );
            send(
                out,
                serde_json::json!({"type":"session:status","loggedIn":false}),
            );
        }
        "session:status" => {
            settle();
            send(out, session_status(state).await);
        }
        "ping" => {
            send(
                out,
                serde_json::json!({"type":"pong","ts":req.get("ts").cloned().unwrap_or(serde_json::json!(0))}),
            );
        }

        // ---- search ----
        // Daemon only has global search.start/query-keyed search.results; the
        // :user/:room/:buddies modes are emulated with a global search and the
        // client filters rows by `user` (web already re-filters per tab).
        // Upgrade path: daemon-side directed search when soulseek-rs adds it.
        "search" | "search:user" | "search:room" | "search:wishlist" | "search:buddies" => {
            let search_id = s(&req, "searchId");
            let query = s(&req, "query");
            if search_id.is_empty() || query.is_empty() {
                err(out, "Invalid search message.");
                return;
            }
            let method = if t == "search:wishlist" {
                "search.wishlist"
            } else {
                "search.start"
            };
            if let Err(e) = rpc_call(state, method, serde_json::json!({"query": query})).await {
                send(
                    out,
                    serde_json::json!({"type":"search:end","searchId":search_id,"reason":"error"}),
                );
                err(out, format!("search failed: {e:#}"));
                return;
            }
            let token = query_token(&query);
            let mut start =
                serde_json::json!({"type":"search:start","searchId":search_id,"token":token});
            if t != "search" {
                // ponytail: extra `emulated` hint is ignored by current web;
                // drop it if a strict client ever validates frames.
                start["emulated"] = serde_json::json!("global-search");
                if t == "search:user" {
                    start["username"] = serde_json::Value::String(s(&req, "username"));
                } else if t == "search:room" {
                    start["room"] = serde_json::Value::String(s(&req, "room"));
                } else if t == "search:buddies" {
                    start["usernames"] = req
                        .get("usernames")
                        .cloned()
                        .unwrap_or(serde_json::Value::Null);
                } else if t == "search:wishlist" {
                    start["wishlist"] = serde_json::json!(true);
                }
            }
            send(out, start);
            spawn_search_window(state.clone(), out.clone(), search_id, query, token);
        }
        "search:stop" | "search:forget" => {
            // ponytail: daemon has no per-search cancel; abort our poll and
            // forget the query. Daemon keeps the shared result set (harmless).
            let search_id = s(&req, "searchId");
            if let Some(h) = searches()
                .lock()
                .ok()
                .and_then(|mut m| m.remove(&search_id))
            {
                h.abort();
            }
            if t == "search:stop" {
                let _ = rpc_call(state, "search.forget", serde_json::json!({"query": ""})).await;
                send(
                    out,
                    serde_json::json!({"type":"search:end","searchId":search_id,"reason":"stopped"}),
                );
            }
        }
        "search:page" => {
            // Client pagination is local; server just acks (server.ts:1533).
            send(
                out,
                serde_json::json!({"type":"search:page",
                "searchId":s(&req,"searchId"),"offset":req.get("offset").cloned().unwrap_or(0.into()),
                "limit":req.get("limit").cloned().unwrap_or(0.into()),"rows":[],"total":0,"hasMore":false}),
            );
        }

        // ---- browse ----
        "browse" => {
            let username = s(&req, "username");
            let action = s(&req, "action");
            if username.is_empty() {
                err(out, "Invalid browse message.");
                return;
            }
            if action == "folder" {
                // ponytail: daemon answers whole-share via event.browse only;
                // serve folder slices from the stash, no per-folder RPC exists.
                let folder = s(&req, "folder");
                let stash = browse_stash()
                    .lock()
                    .ok()
                    .and_then(|m| m.get(&username.to_lowercase()).cloned());
                match stash {
                    Some(v) => {
                        let dirs = v
                            .get("directories")
                            .and_then(|d| d.as_array())
                            .cloned()
                            .unwrap_or_default();
                        let hit = dirs.iter().find(|d| {
                            d.get("name").and_then(|n| n.as_str()) == Some(folder.as_str())
                        });
                        match hit {
                            Some(d) => send(
                                out,
                                serde_json::json!({"type":"browse:folder","username":username,
                                "folder":folder,"token":req.get("token").cloned().unwrap_or(0.into()),"files":d.get("files").cloned().unwrap_or(serde_json::json!([]))}),
                            ),
                            None => err(out, "No such folder in cached browse."),
                        }
                    }
                    None => err(out, "No cached browse for that user."),
                }
                return;
            }
            if let Err(e) = rpc_call(
                state,
                "browse.user",
                serde_json::json!({"username": username}),
            )
            .await
            {
                send(
                    out,
                    serde_json::json!({"type":"browse:shares","username":username,
                    "folders":[],"total":0,"hasMore":false,"offset":0,"error":format!("{e:#}")}),
                );
            }
            // Result arrives via event.browse push -> browse:shares.
        }
        "browse:page" => {
            let username = s(&req, "username");
            let offset = req.get("offset").and_then(|o| o.as_u64()).unwrap_or(0) as usize;
            let limit =
                (req.get("limit").and_then(|o| o.as_u64()).unwrap_or(100) as usize).clamp(1, 1000);
            let stash = browse_stash()
                .lock()
                .ok()
                .and_then(|m| m.get(&username.to_lowercase()).cloned());
            match stash {
                Some(v) => {
                    let dirs = v
                        .get("directories")
                        .and_then(|d| d.as_array())
                        .cloned()
                        .unwrap_or_default();
                    let total = dirs.len();
                    let slice: Vec<_> = dirs.into_iter().skip(offset).take(limit).collect();
                    let has_more = offset + limit < total;
                    send(
                        out,
                        serde_json::json!({"type":"browse:shares","username":username,
                        "folders":browse_dirs_to_web(&slice),"total":total,"hasMore":has_more,"offset":offset}),
                    );
                }
                None => err(out, "No cached browse for that user."),
            }
        }

        // ---- transfers ----
        "download:request" => {
            let username = s(&req, "username");
            let path = s(&req, "virtualPath");
            let size = u64f(&req, "size");
            if username.is_empty() || path.is_empty() {
                err(out, "Invalid download request.");
                return;
            }
            let params = serde_json::json!({"filename": path, "username": username, "size": size,
                "metadata": {"bitrate": null, "length_seconds": null, "peer_free_slots": null, "peer_upload_speed": null}});
            match rpc_call(state, "download.start", params).await {
                Ok(r) => {
                    if let Some(d) = r.get("download") {
                        remember_dl_size(&d.to_string(), &username, &path, size);
                        send(out, download_to_update(&username, &path, d));
                    }
                }
                Err(e) => err(out, format!("download failed: {e:#}")),
            }
        }
        "download:control" => {
            let id = s(&req, "id");
            let action = s(&req, "action");
            let Some((username, filename)) = split_transfer_id(&id) else {
                err(out, "Invalid download control.");
                return;
            };
            let method = match action.as_str() {
                "pause" => "download.pause",
                "resume" | "retry" => {
                    // ponytail: daemon has no retry; resume restarts a stalled
                    // queue entry. True retry-from-scratch needs download.cancel
                    // + download.start with remembered size.
                    if action == "retry" {
                        if let Ok(list) =
                            rpc_call(state, "download.list", serde_json::json!({})).await
                        {
                            if let Some(d) = find_download(&list, &username, &filename) {
                                let size = d.get("size").and_then(|x| x.as_u64()).unwrap_or(0);
                                let _ = rpc_call(
                                    state,
                                    "download.cancel",
                                    dl_params(&username, &filename),
                                )
                                .await;
                                let p = serde_json::json!({"filename": filename, "username": username, "size": size,
                                    "metadata": {"bitrate": null, "length_seconds": null, "peer_free_slots": null, "peer_upload_speed": null}});
                                match rpc_call(state, "download.start", p).await {
                                    Ok(r) => {
                                        if let Some(dd) = r.get("download") {
                                            send(out, download_to_update(&username, &filename, dd));
                                        }
                                    }
                                    Err(e) => err(out, format!("download retry failed: {e:#}")),
                                }
                                return;
                            }
                        }
                    }
                    "download.resume"
                }
                "cancel" => "download.cancel",
                "clear" => "download.remove",
                _ => {
                    err(out, "Invalid download control.");
                    return;
                }
            };
            if action == "clear" {
                // Also drop queued entries (daemon splits remove/remove_queued).
                let _ = rpc_call(
                    state,
                    "download.remove_queued",
                    dl_params(&username, &filename),
                )
                .await;
            }
            match rpc_call(state, method, dl_params(&username, &filename)).await {
                Ok(_) => {
                    if action == "clear" || action == "cancel" {
                        send(out, serde_json::json!({"type":"transfer:removed","id":id}));
                    }
                }
                Err(e) => err(out, format!("download {action} failed: {e:#}")),
            }
        }
        "upload:control" => {
            let id = s(&req, "id");
            let action = s(&req, "action");
            let Some((username, filename)) = split_transfer_id(&id) else {
                err(out, "Invalid upload control.");
                return;
            };
            match action.as_str() {
                "cancel" | "deny" => {
                    // ponytail: daemon has no deny; cancel is equivalent from
                    // the sharer's side. Split when daemon adds deny.
                    match rpc_call(state, "upload.cancel", dl_params(&username, &filename)).await {
                        Ok(_) => send(out, serde_json::json!({"type":"transfer:removed","id":id})),
                        Err(e) => err(out, format!("upload {action} failed: {e:#}")),
                    }
                }
                // Clear is local-only: daemon upload.list is read-only, no
                // remove endpoint. Ack removal so the UI list stays in sync.
                "clear" => send(out, serde_json::json!({"type":"transfer:removed","id":id})),
                _ => err(out, "Invalid upload control."),
            }
        }
        "transfer:clear-many" => {
            let is_upload = req
                .get("isUpload")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);
            let statuses: Option<Vec<String>> = req.get("statuses").and_then(|v| {
                if v.is_null() {
                    None
                } else {
                    v.as_array().map(|a| {
                        a.iter()
                            .filter_map(|x| x.as_str().map(|x| x.to_string()))
                            .collect()
                    })
                }
            });
            if req.get("statuses").is_none() {
                err(out, "statuses is required (array or null for everything).");
                return;
            }
            if is_upload {
                // ponytail: daemon has no upload remove; UI clear is local.
                // Re-list when daemon adds removal.
                for id in upload_ids_for_clear(state, statuses.as_deref()).await {
                    send(out, serde_json::json!({"type":"transfer:removed","id":id}));
                }
                return;
            }
            // Downloads: remove terminal entries (or all when statuses null).
            let list = rpc_call(state, "download.list", serde_json::json!({}))
                .await
                .unwrap_or(serde_json::Value::Null);
            let downloads = list
                .get("downloads")
                .and_then(|d| d.as_array())
                .cloned()
                .unwrap_or_default();
            for d in downloads {
                let st = d
                    .get("status")
                    .and_then(|x| x.get("state"))
                    .and_then(|x| x.as_str())
                    .unwrap_or("");
                let terminal = matches!(st, "completed" | "cancelled" | "failed" | "timed_out");
                let want = match &statuses {
                    None => terminal, // null = everything finished-ish, never nuke active
                    Some(s) => s.iter().any(|x| x.eq_ignore_ascii_case(st)),
                };
                if !want {
                    continue;
                }
                let u = d.get("username").and_then(|x| x.as_str()).unwrap_or("");
                let f = d.get("filename").and_then(|x| x.as_str()).unwrap_or("");
                let _ = rpc_call(state, "download.remove", dl_params(u, f)).await;
                let _ = rpc_call(state, "download.remove_queued", dl_params(u, f)).await;
                send(
                    out,
                    serde_json::json!({"type":"transfer:removed","id":transfer_id("dl", u, f)}),
                );
            }
        }

        // ---- userinfo ----
        "userinfo" => {
            userinfo_dispatch(state, &req, out).await;
        }

        // ---- chat ----
        "chat:room" => {
            let action = s(&req, "action");
            let room = s(&req, "room");
            match action.as_str() {
                "refreshList" | "" if room.is_empty() => {
                    let _ = rpc_call(state, "room.list_request", serde_json::json!({})).await;
                }
                "join" => {
                    if room.is_empty() {
                        err(out, "room is required.");
                        return;
                    }
                    if let Err(e) =
                        rpc_call(state, "room.join", serde_json::json!({"room": room})).await
                    {
                        err(out, format!("join failed: {e:#}"));
                    }
                }
                "leave" => {
                    if room.is_empty() {
                        err(out, "room is required.");
                        return;
                    }
                    if let Err(e) =
                        rpc_call(state, "room.leave", serde_json::json!({"room": room})).await
                    {
                        err(out, format!("leave failed: {e:#}"));
                    }
                }
                "say" => {
                    let message = s(&req, "message");
                    if room.is_empty() || message.is_empty() {
                        err(out, "room and message required.");
                        return;
                    }
                    if let Err(e) = rpc_call(
                        state,
                        "room.say",
                        serde_json::json!({"room": room, "message": message}),
                    )
                    .await
                    {
                        err(out, format!("say failed: {e:#}"));
                    }
                }
                "ticker" => {} // server pushes tickers; no client send needed
                "setTicker" | "addMember" | "addOperator" | "removeOperator"
                | "cancelMembership" | "cancelOwnership" => {
                    // ponytail: daemon exposes no room-admin RPC; honest error.
                    // Add mapping when soulseek-rs gains room admin methods.
                    err(out, format!("chat:room {action} unsupported by daemon v1."));
                }
                _ => err(out, "Invalid chat:room message."),
            }
        }
        "chat:private" => {
            let action = s(&req, "action");
            let username = s(&req, "username");
            if username.is_empty() {
                err(out, "Invalid chat:private message.");
                return;
            }
            if action == "send" {
                let message = s(&req, "message");
                if message.is_empty() {
                    return;
                }
                if message == "\u{0001}TYPING\u{0001}" {
                    return; // no typing-indicator protocol on the wire
                }
                if let Err(e) = rpc_call(
                    state,
                    "message.send",
                    serde_json::json!({"username": username, "message": message}),
                )
                .await
                {
                    err(out, format!("send failed: {e:#}"));
                }
            }
            // "ack" is a client-side read receipt; nothing to forward.
        }
        "chat:logs" => {
            let scope = s(&req, "scope");
            let key = s(&req, "key");
            let lines = req
                .get("lines")
                .and_then(|l| l.as_u64())
                .unwrap_or(100)
                .clamp(1, 10000) as usize;
            if scope == "private" && !key.is_empty() {
                // Daemon keeps private history; filter to this peer, tail N.
                match rpc_call(state, "message.history", serde_json::json!({})).await {
                    Ok(h) => {
                        let self_name = daemon_status(state)
                            .await
                            .get("username")
                            .and_then(|u| u.as_str())
                            .unwrap_or("")
                            .to_string();
                        let mut rows: Vec<serde_json::Value> = h
                            .get("messages")
                            .and_then(|m| m.as_array())
                            .cloned()
                            .unwrap_or_default()
                            .into_iter()
                            .filter(|m| m.get("peer").and_then(|p| p.as_str()) == Some(key.as_str()))
                            .map(|m| {
                                let outgoing = m.get("outgoing").and_then(|o| o.as_bool()).unwrap_or(false);
                                serde_json::json!({
                                    "username": if outgoing { serde_json::Value::String(self_name.clone()) } else { m.get("peer").cloned().unwrap_or(serde_json::Value::Null) },
                                    "message": m.get("text").cloned().unwrap_or(serde_json::Value::Null),
                                    "timestamp": m.get("at").and_then(|a| a.as_i64()).unwrap_or(0) * 1000,
                                    "isAction": false,
                                    "isSelf": outgoing,
                                })
                            })
                            .collect();
                        if rows.len() > lines {
                            rows = rows.split_off(rows.len() - lines);
                        }
                        send(
                            out,
                            serde_json::json!({"type":"chat:logs","scope":"private","key":key,"rows":rows}),
                        );
                    }
                    Err(e) => err(out, format!("chat history failed: {e:#}")),
                }
            } else if scope == "rooms" {
                // ponytail: daemon keeps no room history; empty rows keep the
                // UI consistent. Serve from local logs when shim persists them.
                send(
                    out,
                    serde_json::json!({"type":"chat:logs","scope":"rooms","key":key,"rows":[]}),
                );
            } else {
                err(out, "Invalid chat:logs message.");
            }
        }
        "chat:global" => {
            // ponytail: daemon has no global-room feed; list_request refreshes
            // the room list so the UI can find it. Split when daemon adds it.
            let _ = rpc_call(state, "room.list_request", serde_json::json!({})).await;
        }

        // ---- peers / shares ----
        "peer:connect" => {
            // ponytail: daemon exposes no peer-connect RPC; user.request is
            // the closest nudge (asks server for the peer). Honest error kept.
            let username = s(&req, "username");
            if username.is_empty() {
                err(out, "username required");
                return;
            }
            let _ = rpc_call(
                state,
                "user.request",
                serde_json::json!({"username": username}),
            )
            .await;
            err(
                out,
                "peer:connect unsupported by daemon v1 (peer requested server-side instead).",
            );
        }
        "shares:rescan" => match rpc_call(state, "shares.reindex", serde_json::json!({})).await {
            Ok(st) => send(
                out,
                serde_json::json!({"type":"shares:rescanned",
                    "folders": st.get("directories").cloned().unwrap_or(serde_json::json!([])),
                    "counts": {"dirs": st.get("folders").cloned().unwrap_or(0.into()), "files": st.get("files").cloned().unwrap_or(0.into())},
                    "unavailable": [], "secretHits": []}),
            ),
            Err(e) => err(out, format!("rescan failed: {e:#}")),
        },
        "shares:preview" => {
            // ponytail: daemon has no dry-run scan; preview = current index
            // sample. True preview needs a daemon-side scan-preview method.
            match rpc_call(state, "shares.files", serde_json::json!({})).await {
                Ok(l) => {
                    let dirs = l
                        .get("directories")
                        .and_then(|d| d.as_array())
                        .cloned()
                        .unwrap_or_default();
                    let mut count = 0;
                    let sample: Vec<String> = dirs
                        .iter()
                        .flat_map(|d| {
                            let dir = d.get("name").and_then(|n| n.as_str()).unwrap_or("");
                            d.get("files")
                                .and_then(|f| f.as_array())
                                .cloned()
                                .unwrap_or_default()
                                .into_iter()
                                .map(move |f| {
                                    format!(
                                        "{dir}/{}",
                                        f.get("name").and_then(|n| n.as_str()).unwrap_or("")
                                    )
                                })
                        })
                        .take(20)
                        .inspect(|_| count += 1)
                        .collect();
                    let files_total: usize = dirs
                        .iter()
                        .map(|d| {
                            d.get("files")
                                .and_then(|f| f.as_array())
                                .map(|a| a.len())
                                .unwrap_or(0)
                        })
                        .sum();
                    send(
                        out,
                        serde_json::json!({"type":"shares:preview:result",
                        "counts": {"dirs": dirs.len(), "files": files_total}, "sample": sample, "excludedCount": 0, "secretHits": []}),
                    );
                }
                Err(e) => err(out, format!("preview failed: {e:#}")),
            }
        }

        // ---- config ----
        "config:update" => {
            let section = s(&req, "section");
            let key = s(&req, "key");
            let value = req.get("value").cloned().unwrap_or(serde_json::Value::Null);
            if section.is_empty() || key.is_empty() {
                err(out, "Invalid config:update");
                return;
            }
            // ponytail: shim is stateless (no settings.json); only live
            // daemon-affecting keys are applied, rest are acked. Persist in
            // the daemon when it gains a config surface.
            if section == "server"
                && (key == "portrange" || key == "listen_port" || key == "listenPort")
            {
                let port = if let Some(a) = value.as_array() {
                    a.first().and_then(|v| v.as_u64()).unwrap_or(0)
                } else {
                    value
                        .as_u64()
                        .unwrap_or(value.as_str().and_then(|x| x.parse().ok()).unwrap_or(0))
                };
                if !(1024..=65535).contains(&port) {
                    err(
                        out,
                        format!("Invalid listen port {value} (must be 1024-65535)"),
                    );
                    return;
                }
                let _ = state.supervisor_tx.send(SupervisorCmd::Restart);
                send(
                    out,
                    serde_json::json!({"type":"config:updated","section":section,"key":key,"value":port}),
                );
                return;
            }
            if section == "transfers" && key == "uploadslots" {
                if let Some(slots) = value.as_u64() {
                    if let Err(e) =
                        rpc_call(state, "upload.slots", serde_json::json!({"slots": slots})).await
                    {
                        err(out, format!("uploadslots failed: {e:#}"));
                        return;
                    }
                }
            }
            if section == "transfers"
                && (key == "downloaddir" || key == "download_dir" || key == "downloadDir")
            {
                if let Some(dir) = value.as_str() {
                    if let Err(e) = rpc_call(
                        state,
                        "download.set_dir",
                        serde_json::json!({"directory": dir}),
                    )
                    .await
                    {
                        err(out, format!("download dir failed: {e:#}"));
                        return;
                    }
                }
            }
            send(
                out,
                serde_json::json!({"type":"config:updated","section":section,"key":key}),
            );
        }
        "config:get" => {
            // ponytail: shim holds no durable settings; daemon is the source
            // of truth via daemon.status. Web reconciles with local defaults.
            let st = daemon_status(state).await;
            let mut settings = serde_json::Map::new();
            settings.insert("server".to_string(), serde_json::json!({
                "listen_port": st.get("listen_port").cloned().unwrap_or(serde_json::Value::Null),
            }));
            settings.insert("transfers".to_string(), serde_json::json!({
                "download_dir": st.get("download_dir").cloned().unwrap_or(serde_json::Value::Null),
            }));
            send(
                out,
                serde_json::json!({"type":"config:state","settings":settings}),
            );
        }

        // ---- bans / wishlist / stats ----
        "ban:add" | "ban:remove" | "ignore:add" | "ignore:remove" => {
            // ponytail: daemon has no ban/ignore RPC; honest error. Add
            // mapping when soulseek-rs gains user.block/ignore methods.
            err(
                out,
                format!("{t} unsupported by daemon v1 (no ban/ignore RPC)."),
            );
        }
        "wishlist:update" => {
            let terms: Vec<String> = req
                .get("entries")
                .and_then(|e| e.as_array())
                .map(|a| {
                    a.iter()
                        .filter_map(|x| {
                            x.get("term")
                                .and_then(|x| x.as_str())
                                .map(|x| x.to_string())
                        })
                        .collect()
                })
                .or_else(|| {
                    req.get("terms").and_then(|x| x.as_array()).map(|a| {
                        a.iter()
                            .filter_map(|x| x.as_str().map(|x| x.to_string()))
                            .collect()
                    })
                })
                .unwrap_or_default();
            let mut count = 0;
            for term in terms.iter().take(100) {
                if rpc_call(state, "search.wishlist", serde_json::json!({"query": term}))
                    .await
                    .is_ok()
                {
                    count += 1;
                }
            }
            send(
                out,
                serde_json::json!({"type":"wishlist:updated","count":count}),
            );
            if let Ok(iv) = rpc_call(state, "search.wishlist_interval", serde_json::json!({})).await
            {
                send(
                    out,
                    serde_json::json!({"type":"wishlist:interval",
                    "wishlistInterval": iv.get("seconds").cloned().unwrap_or(0.into())}),
                );
            }
        }
        "statistics:request" => {
            // ponytail: daemon exposes no transfer stats; shares come from
            // shares.status best-effort. Wire real stats when daemon adds them.
            let shares = rpc_call(state, "shares.status", serde_json::json!({}))
                .await
                .ok();
            send(
                out,
                serde_json::json!({"type":"statistics:response","total":null,"session":null,
                "shares": shares.map(|v| serde_json::json!({"dirs": v.get("folders"), "files": v.get("files")})).unwrap_or(serde_json::Value::Null)}),
            );
        }
        "statistics:reset" => {
            send(
                out,
                serde_json::json!({"type":"statistics:response","total":null,"session":null}),
            );
            send(out, serde_json::json!({"type":"statistics:reset:ok"}));
        }

        // ---- spectrum / diagnostics (stubs) ----
        "spectrum:request" | "spectrum:status" => {
            send(
                out,
                serde_json::json!({"type":"spectrum:error",
                "id": req.get("id").cloned().unwrap_or("".into()),
                "error":"Spectrum moved to worker :8789 — update the web app."}),
            );
        }
        "diagnostics:clear" => {
            send(out, serde_json::json!({"type":"diagnostics:cleared"}));
        }
        "diagnostics:subscribe" => {
            // ponytail: shim keeps no ring buffer; empty init keeps the
            // diagnostics page consistent. Stream daemon logs when available.
            send(
                out,
                serde_json::json!({"type":"diagnostics:init","entries":[]}),
            );
        }
        "diagnostics:browser-log" => {} // ingest-only; nothing to relay

        // ---- plugins (unsupported in v1) ----
        "plugin:list"
        | "plugin:toggle"
        | "plugin:reload"
        | "plugin:uninstall"
        | "plugin:settings"
        | "plugin:resetSettings"
        | "plugin:install"
        | "plugin:installUrl"
        | "plugin:installGithubTs" => {
            err(out, "plugins unsupported in v1");
        }

        _ => err(out, "Unknown message type."),
    }
}

async fn userinfo_dispatch(state: &AppState, req: &serde_json::Value, out: &OutTx) {
    let action = s(req, "action");
    let username = s(req, "username");
    match action.as_str() {
        "watch" => {
            if username.is_empty() {
                err(out, "Invalid userinfo message.");
                return;
            }
            if let Err(e) = rpc_call(
                state,
                "user.watch",
                serde_json::json!({"username": username}),
            )
            .await
            {
                err(out, format!("watch failed: {e:#}"));
                return;
            }
            push_user_state(state, &username, out).await;
        }
        "unwatch" => {
            if username.is_empty() {
                err(out, "Invalid userinfo message.");
                return;
            }
            if let Err(e) = rpc_call(
                state,
                "user.unwatch",
                serde_json::json!({"username": username}),
            )
            .await
            {
                err(out, format!("unwatch failed: {e:#}"));
            }
        }
        "get" => {
            if username.is_empty() {
                err(out, "Invalid userinfo message.");
                return;
            }
            match rpc_call(
                state,
                "user.info",
                serde_json::json!({"username": username}),
            )
            .await
            {
                Ok(r) => send(out, user_info_response(&username, r.get("user"))),
                Err(_) => send(
                    out,
                    serde_json::json!({"type":"user-info-failed","username":username}),
                ),
            }
        }
        "interests" => {
            // ponytail: daemon UserInfoDto carries no interests; empty lists
            // keep profile tabs consistent. Fill when daemon adds interests.
            send(
                out,
                serde_json::json!({"type":"userinfo:event",
                "event":{"type":"user-interests","username":username,"likes":[],"hates":[]}}),
            );
        }
        "peerAddress" => {
            // ponytail: daemon has no peer-address RPC and the web fires
            // this per result row; stay silent instead of spamming errors.
        }
        "checkPrivileges" => match rpc_call(state, "privileges.check", serde_json::json!({})).await
        {
            Ok(_) => send(
                out,
                serde_json::json!({"type":"userinfo:event",
                "event":{"type":"check-privileges","privileged":true}}),
            ),
            Err(e) => err(out, format!("checkPrivileges failed: {e:#}")),
        },
        "givePrivileges" => {
            err(
                out,
                "givePrivileges unsupported by daemon v1 (no grant RPC).",
            );
        }
        "setStatus" => {
            err(out, "setStatus unsupported by daemon v1 (no presence RPC).");
        }
        "changePassword" => {
            let password = s(req, "password");
            match rpc_call(
                state,
                "account.password",
                serde_json::json!({"password": password}),
            )
            .await
            {
                Ok(_) => send(
                    out,
                    serde_json::json!({"type":"userinfo:event","event":{"type":"password-changed"}}),
                ),
                Err(e) => err(out, format!("changePassword failed: {e:#}")),
            }
        }
        "reportShares" => {
            // Informational in the old bridge; daemon owns the index now.
            let _ = rpc_call(state, "shares.status", serde_json::json!({})).await;
        }
        "setProfile" => {
            err(out, "setProfile unsupported by daemon v1 (no profile RPC).");
        }
        _ => err(out, "Invalid userinfo message."),
    }
}

/// After (un)watch, push presence + info so buddies/profile stay live.
async fn push_user_state(state: &AppState, username: &str, out: &OutTx) {
    if let Ok(r) = rpc_call(
        state,
        "user.info",
        serde_json::json!({"username": username}),
    )
    .await
    {
        let user = r.get("user");
        let (status, privileged) = presence_of(user);
        send(
            out,
            serde_json::json!({"type":"userinfo:event",
            "event":{"type":"user-status","username":username,
                "status":{"username":username,"status":status,"privileged":privileged}}}),
        );
        send(out, user_info_response(username, user));
    }
}

fn presence_of(user: Option<&serde_json::Value>) -> (i64, bool) {
    let p = user.and_then(|u| u.get("presence"));
    let status = match p
        .and_then(|x| x.get("status"))
        .and_then(|x| x.as_str())
        .unwrap_or("offline")
    {
        "online" => 1,
        "away" => 2,
        _ => 0,
    };
    let privileged = p
        .and_then(|x| x.get("privileged"))
        .and_then(|x| x.as_bool())
        .unwrap_or(false);
    (status, privileged)
}

/// Map daemon `UserResult.user` onto the web `user-info-response` shape.
/// Daemon has no descr/pic/counters; defaults keep profile pages consistent.
fn user_info_response(username: &str, user: Option<&serde_json::Value>) -> serde_json::Value {
    let stats = user.and_then(|u| u.get("stats"));
    serde_json::json!({"type":"user-info-response","username":username,
        "descr":"","pic":null,"totalupl":0,"queuesize":0,"slotsavail":true,"uploadallowed":1,
        "presence": user.and_then(|u| u.get("presence")).cloned().unwrap_or(serde_json::Value::Null),
        "stats": stats.cloned().unwrap_or(serde_json::Value::Null)})
}

/// Poll `search.results` for a 10s window, emitting incremental `search:result`
/// batches and a final `search:end`. Aborted by `search:stop`/`forget`.
fn spawn_search_window(state: AppState, out: OutTx, search_id: String, query: String, token: u32) {
    if let Some(old) = searches()
        .lock()
        .ok()
        .and_then(|mut m| m.remove(&search_id))
    {
        old.abort();
    }
    let handle = tokio::spawn({
        let search_id = search_id.clone();
        async move {
            let mut seen: HashSet<String> = HashSet::new();
            // ponytail: 10s default window, 1s poll; per-search window config
            // when web sends it (server searches.* maxresults keys).
            for _ in 0..10 {
                tokio::time::sleep(Duration::from_secs(1)).await;
                let res = rpc_call(
                    &state,
                    "search.results",
                    serde_json::json!({"query": query}),
                )
                .await;
                let Ok(res) = res else { continue };
                let results = res
                    .get("results")
                    .and_then(|r| r.as_array())
                    .cloned()
                    .unwrap_or_default();
                let mut rows = Vec::new();
                for r in &results {
                    let username = r.get("username").and_then(|u| u.as_str()).unwrap_or("");
                    let slots = r.get("slots").and_then(|x| x.as_u64()).unwrap_or(0);
                    let speed = r.get("speed").and_then(|x| x.as_u64()).unwrap_or(0);
                    let rtoken = r
                        .get("token")
                        .and_then(|x| x.as_u64())
                        .unwrap_or(token as u64);
                    for f in r
                        .get("files")
                        .and_then(|x| x.as_array())
                        .cloned()
                        .unwrap_or_default()
                    {
                        let name = f.get("name").and_then(|n| n.as_str()).unwrap_or("");
                        let key = format!("{username}\x00{name}");
                        if !seen.insert(key) {
                            continue;
                        }
                        rows.push(search_row(
                            username,
                            name,
                            f.get("size").and_then(|x| x.as_u64()).unwrap_or(0),
                            f.get("attribs"),
                            slots,
                            speed,
                            rtoken,
                        ));
                    }
                }
                if !rows.is_empty() {
                    send(
                        &out,
                        serde_json::json!({"type":"search:result","searchId":search_id,"token":token,"rows":rows}),
                    );
                }
            }
            send(
                &out,
                serde_json::json!({"type":"search:end","searchId":search_id,"reason":"timeout"}),
            );
            searches().lock().ok().map(|mut m| m.remove(&search_id));
        }
    });
    searches()
        .lock()
        .ok()
        .map(|mut m| m.insert(search_id, handle));
}

/// Map daemon `FileDto` onto the web `SearchRow` (apps/bridge/src/session.ts:135).
fn search_row(
    username: &str,
    name: &str,
    size: u64,
    attribs: Option<&serde_json::Value>,
    slots: u64,
    speed: u64,
    _peer_token: u64,
) -> serde_json::Value {
    let (folder, filename) = match name.rsplit_once(['/', '\\']) {
        Some((d, b)) => (d.to_string(), b.to_string()),
        None => (String::new(), name.to_string()),
    };
    let file_type = filename
        .rsplit_once('.')
        .map(|(_, e)| e.to_lowercase())
        .unwrap_or_default();
    let bitrate = attribs
        .and_then(|a| a.get("0"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    let length = attribs
        .and_then(|a| a.get("1"))
        .and_then(|v| v.as_u64())
        .unwrap_or(0);
    serde_json::json!({
        "user": username, "folder": folder, "filename": filename, "path": name, "size": size,
        "fileType": file_type, "slotFree": slots > 0, "speed": speed, "inQueue": 0,
        "quality": bitrate, "length": length, "private": false,
        "attributes": {"bitrate": bitrate, "length": length},
    })
}

/// Daemon `SharedDirectoryDto` -> web `BrowseFolderEntry` ({name, files:[{name,size,ext,attrs}]}).
fn browse_dirs_to_web(dirs: &[serde_json::Value]) -> Vec<serde_json::Value> {
    dirs.iter()
        .map(|d| {
            let files: Vec<serde_json::Value> = d
                .get("files")
                .and_then(|f| f.as_array())
                .cloned()
                .unwrap_or_default()
                .into_iter()
                .map(|f| {
                    let name = f
                        .get("name")
                        .and_then(|n| n.as_str())
                        .unwrap_or("")
                        .to_string();
                    let ext = name
                        .rsplit_once('.')
                        .map(|(_, e)| e.to_lowercase())
                        .unwrap_or_default();
                    serde_json::json!({"name": name,
                        "size": f.get("size").cloned().unwrap_or(0.into()), "ext": ext,
                        "attrs": f.get("attributes").cloned().unwrap_or(serde_json::json!([]))})
                })
                .collect();
            serde_json::json!({"name": d.get("name").cloned().unwrap_or("".into()), "files": files})
        })
        .collect()
}

fn dl_params(username: &str, filename: &str) -> serde_json::Value {
    serde_json::json!({"username": username, "filename": filename})
}

fn transfer_id(prefix: &str, username: &str, filename: &str) -> String {
    format!("{prefix}::{username}::{filename}")
}

/// Transfer ids are `dl::<user>::<file>` / `ul::<user>::<file>` (see
/// download_to_update/upload_to_update); split back for control frames.
fn split_transfer_id(id: &str) -> Option<(String, String)> {
    let rest = id
        .strip_prefix("dl::")
        .or_else(|| id.strip_prefix("ul::"))?;
    let (user, file) = rest.split_once("::")?;
    if user.is_empty() || file.is_empty() {
        return None;
    }
    Some((user.to_string(), file.to_string()))
}

fn dl_key(username: &str, filename: &str) -> String {
    format!("{username}\x00{filename}")
}

fn remember_dl_size(_raw: &str, username: &str, filename: &str, size: u64) {
    if size > 0 {
        dl_sizes()
            .lock()
            .ok()
            .map(|mut m| m.insert(dl_key(username, filename), size));
    }
}

fn known_dl_size(username: &str, filename: &str) -> u64 {
    dl_sizes()
        .lock()
        .ok()
        .and_then(|m| m.get(&dl_key(username, filename)).copied())
        .unwrap_or(0)
}

fn basename_of(path: &str) -> &str {
    path.rsplit(['/', '\\']).next().unwrap_or(path)
}

fn find_download<'a>(
    list: &'a serde_json::Value,
    username: &str,
    filename: &str,
) -> Option<&'a serde_json::Value> {
    list.get("downloads")
        .and_then(|d| d.as_array())
        .and_then(|a| {
            a.iter().find(|d| {
                d.get("username").and_then(|u| u.as_str()) == Some(username)
                    && d.get("filename").and_then(|f| f.as_str()) == Some(filename)
            })
        })
}

/// Daemon `DownloadDto` -> web `transfer:update` frame.
fn download_to_update(username: &str, filename: &str, d: &serde_json::Value) -> serde_json::Value {
    let status = d
        .get("status")
        .and_then(|x| x.get("state"))
        .and_then(|x| x.as_str())
        .unwrap_or("queued");
    let size = d
        .get("size")
        .and_then(|x| x.as_u64())
        .unwrap_or_else(|| known_dl_size(username, filename));
    remember_dl_size("", username, filename, size);
    let downloaded = d
        .get("status")
        .and_then(|x| x.get("bytes_downloaded"))
        .and_then(|x| x.as_u64())
        .unwrap_or(0);
    let speed = d
        .get("status")
        .and_then(|x| x.get("speed_bytes_per_sec"))
        .and_then(|x| x.as_f64())
        .unwrap_or(0.0) as u64;
    let web_status = match status {
        "in_progress" => "Downloading",
        "paused" => "Paused",
        "completed" => "Finished",
        "cancelled" => "Cancelled",
        "failed" | "timed_out" => "Failed",
        _ => "Queued",
    };
    serde_json::json!({"type":"transfer:update","transfer":{
        "id": transfer_id("dl", username, filename), "username": username,
        "virtualPath": filename, "fileName": basename_of(filename),
        "isUpload": false, "status": web_status, "size": size,
        "downloaded": downloaded, "progress": if size > 0 { downloaded as f64 / size as f64 } else { 0.0 },
        "speed": speed,
        "place": d.get("queue_position").cloned().unwrap_or(serde_json::Value::Null),
    }})
}

async fn upload_ids_for_clear(state: &AppState, statuses: Option<&[String]>) -> Vec<String> {
    // ponytail: daemon upload.list is read-only; clear only affects the UI
    // list. Filter by status when given, else clear terminal only.
    let list = rpc_call(state, "upload.list", serde_json::json!({}))
        .await
        .unwrap_or(serde_json::Value::Null);
    list.get("uploads")
        .and_then(|u| u.as_array())
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|u| {
            let st = u
                .get("status")
                .and_then(|x| x.get("state"))
                .and_then(|x| x.as_str())
                .unwrap_or("");
            match statuses {
                None => matches!(st, "completed" | "cancelled" | "failed"),
                Some(s) => s.iter().any(|x| x.eq_ignore_ascii_case(st)),
            }
        })
        .map(|u| {
            let name = u.get("username").and_then(|x| x.as_str()).unwrap_or("");
            let file = u.get("filename").and_then(|x| x.as_str()).unwrap_or("");
            transfer_id("ul", name, file)
        })
        .collect()
}

/// Map daemon `event.*` push to web `{type,...}` frame.
fn translate_event(evt: serde_json::Value) -> Option<serde_json::Value> {
    let method = evt.get("method").and_then(|m| m.as_str()).unwrap_or("");
    let payload = evt
        .get("params")
        .and_then(|p| p.get("payload"))
        .or_else(|| evt.get("params"))
        .cloned()
        .unwrap_or(serde_json::Value::Null);
    match method {
        "event.room" => {
            let kind = payload.get("event").and_then(|e| e.as_str()).unwrap_or("");
            let room = payload
                .get("room")
                .and_then(|r| r.as_str())
                .unwrap_or("")
                .to_string();
            match kind {
                // Room chat lines ride chat:event (server.ts onChatEvent), not room:event.
                "message" => Some(serde_json::json!({"type":"chat:event","event":{
                    "type":"say-chatroom","room":room,
                    "username": payload.get("username").cloned().unwrap_or(serde_json::Value::Null),
                    "message": payload.get("message").cloned().unwrap_or(serde_json::Value::Null)}})),
                "global" | "global_message" => {
                    Some(serde_json::json!({"type":"chat:event","event":{
                    "type":"global-room-message","room":room,
                    "username": payload.get("username").cloned().unwrap_or(serde_json::Value::Null),
                    "message": payload.get("message").cloned().unwrap_or(serde_json::Value::Null)}}))
                }
                "list" => Some(serde_json::json!({"type":"room:event","event":{
                    "type":"room-list",
                    "rooms": payload.get("rooms").cloned().unwrap_or(serde_json::json!([]))}})),
                "joined" => Some(serde_json::json!({"type":"room:event","event":{
                    "type":"join-room","room":room,
                    "users": payload.get("users").cloned().unwrap_or(serde_json::json!([])),
                    "tickers": payload.get("tickers").cloned().unwrap_or(serde_json::json!([]))}})),
                "left" => Some(
                    serde_json::json!({"type":"room:event","event":{"type":"leave-room","room":room}}),
                ),
                "user_joined" => Some(serde_json::json!({"type":"room:event","event":{
                    "type":"user-joined-room","room":room,
                    "username": payload.get("username").cloned().unwrap_or(serde_json::Value::Null)}})),
                "user_left" => Some(serde_json::json!({"type":"room:event","event":{
                    "type":"user-left-room","room":room,
                    "username": payload.get("username").cloned().unwrap_or(serde_json::Value::Null)}})),
                "tickers" => Some(serde_json::json!({"type":"room:event","event":{
                    "type":"room-tickers","room":room,
                    "tickers": payload.get("tickers").cloned().unwrap_or(serde_json::json!([]))}})),
                "ticker_added" | "ticker_removed" => {
                    Some(serde_json::json!({"type":"room:event","event":{
                    "type": if kind == "ticker_added" { "ticker-added" } else { "ticker-removed" },
                    "room":room,
                    "username": payload.get("username").cloned().unwrap_or(serde_json::Value::Null),
                    "ticker": payload.get("ticker").cloned().unwrap_or(serde_json::Value::Null)}}))
                }
                "members" => Some(serde_json::json!({"type":"room:event","event":{
                    "type":"room-members","room":room,
                    "users": payload.get("users").cloned().unwrap_or(serde_json::json!([]))}})),
                _ => None,
            }
        }
        "event.message" => Some(serde_json::json!({"type":"chat:event","event":{
            "type":"private-message",
            "username": payload.get("username").cloned().unwrap_or(serde_json::Value::Null),
            "message": payload.get("message").cloned().unwrap_or(serde_json::Value::Null),
            "msgId": payload.get("id").cloned().unwrap_or(serde_json::Value::Null),
            "timestamp": payload.get("timestamp").cloned().unwrap_or(serde_json::Value::Null)}})),
        "event.upload" => {
            let username = payload
                .get("username")
                .and_then(|u| u.as_str())
                .unwrap_or("")
                .to_string();
            let filename = payload
                .get("filename")
                .and_then(|f| f.as_str())
                .unwrap_or("")
                .to_string();
            let state_s = payload
                .get("status")
                .and_then(|x| x.get("state"))
                .and_then(|x| x.as_str())
                .unwrap_or("");
            let size = payload.get("size").and_then(|x| x.as_u64()).unwrap_or(0);
            let id = transfer_id("ul", &username, &filename);
            match state_s {
                "completed" => Some(serde_json::json!({"type":"transfer:finished",
                    "id": id, "fileName": basename_of(&filename), "size": size})),
                "cancelled" | "failed" => {
                    Some(serde_json::json!({"type":"transfer:update","transfer":{
                    "id": id, "username": username, "virtualPath": filename,
                    "fileName": basename_of(&filename), "isUpload": true,
                    "status": if state_s == "failed" { "Failed" } else { "Cancelled" },
                    "size": size, "downloaded": payload.get("bytes_sent").cloned().unwrap_or(0.into()),
                    "speed": payload.get("speed_bytes_per_sec").cloned().unwrap_or(0.into())}}))
                }
                _ => {
                    let (web_status, place) = match state_s {
                        "in_progress" => ("Uploading", serde_json::Value::Null),
                        _ => (
                            "Queued",
                            payload
                                .get("status")
                                .and_then(|x| x.get("place"))
                                .cloned()
                                .unwrap_or(serde_json::Value::Null),
                        ),
                    };
                    let upd = serde_json::json!({"type":"transfer:update","transfer":{
                        "id": id, "username": username, "virtualPath": filename,
                        "fileName": basename_of(&filename), "isUpload": true, "status": web_status,
                        "size": size, "downloaded": payload.get("bytes_sent").cloned().unwrap_or(0.into()),
                        "speed": payload.get("speed_bytes_per_sec").cloned().unwrap_or(0.into()),
                        "place": place}});
                    if state_s == "queued" {
                        if let Some(p) = payload
                            .get("status")
                            .and_then(|x| x.get("place"))
                            .and_then(|x| x.as_u64())
                        {
                            // ponytail: queue-place side channel folded into
                            // transfer:update.place; separate transfer:queue
                            // frame when web needs it.
                            let _ = p;
                        }
                    }
                    Some(upd)
                }
            }
        }
        "event.download_status" => {
            let username = payload
                .get("username")
                .and_then(|u| u.as_str())
                .unwrap_or("")
                .to_string();
            let filename = payload
                .get("filename")
                .and_then(|f| f.as_str())
                .unwrap_or("")
                .to_string();
            let st = payload
                .get("status")
                .cloned()
                .unwrap_or(serde_json::Value::Null);
            let state_s = st.get("state").and_then(|x| x.as_str()).unwrap_or("");
            if state_s == "in_progress" {
                if let Some(total) = st.get("total_bytes").and_then(|x| x.as_u64()) {
                    remember_dl_size("", &username, &filename, total);
                }
            }
            let size = st
                .get("total_bytes")
                .and_then(|x| x.as_u64())
                .unwrap_or_else(|| known_dl_size(&username, &filename));
            let id = transfer_id("dl", &username, &filename);
            match state_s {
                "completed" => Some(serde_json::json!({"type":"transfer:finished",
                    "id": id, "fileName": basename_of(&filename), "size": size})),
                _ => {
                    let downloaded = st
                        .get("bytes_downloaded")
                        .and_then(|x| x.as_u64())
                        .unwrap_or(0);
                    let speed = st
                        .get("speed_bytes_per_sec")
                        .and_then(|x| x.as_f64())
                        .unwrap_or(0.0) as u64;
                    let web_status = match state_s {
                        "in_progress" => "Downloading",
                        "paused" => "Paused",
                        "cancelled" => "Cancelled",
                        "failed" | "timed_out" => "Failed",
                        _ => "Queued",
                    };
                    Some(serde_json::json!({"type":"transfer:update","transfer":{
                        "id": id, "username": username, "virtualPath": filename,
                        "fileName": basename_of(&filename), "isUpload": false, "status": web_status,
                        "size": size, "downloaded": downloaded,
                        "progress": if size > 0 { downloaded as f64 / size as f64 } else { 0.0 },
                        "speed": speed}}))
                }
            }
        }
        "event.browse" => {
            let username = payload
                .get("username")
                .and_then(|u| u.as_str())
                .unwrap_or("")
                .to_string();
            // Stash whole result for browse:page (server.ts BROWSE_PAGE_SIZE=1000).
            browse_stash()
                .lock()
                .ok()
                .map(|mut m| m.insert(username.to_lowercase(), payload.clone()));
            let dirs = payload
                .get("directories")
                .and_then(|d| d.as_array())
                .cloned()
                .unwrap_or_default();
            let total = dirs.len();
            let page: Vec<_> = dirs.into_iter().take(1000).collect();
            Some(
                serde_json::json!({"type":"browse:shares","username":username,
                "folders": browse_dirs_to_web(&page), "total": total,
                "hasMore": total > 1000, "offset": 0}),
            )
        }
        "event.session_loss" => {
            let loss = payload.get("loss").and_then(|l| l.as_str()).unwrap_or("");
            if loss == "displaced" {
                Some(serde_json::json!({"type":"session:ended","reason":"displaced"}))
            } else {
                // ponytail: daemon auto-reconnects a disconnected session;
                // surface as reconnecting, live state follows via daemon.status.
                Some(
                    serde_json::json!({"type":"server:reconnect","attempt":1,"delay":5000,"error":"disconnected"}),
                )
            }
        }
        _ => None,
    }
}
