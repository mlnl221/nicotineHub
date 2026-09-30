//! HTTP routes: /health, /ws, /files/:token, /api/files[/raw],
//! /upnp/status, /portchecker, /interfaces, /logs, /diagnostics, /plugins*,
//! /container, /restart, /spectrum/ stub.
//! Owner: http-agent. Reference: apps/bridge/src/server.ts:893-1330.

use std::{collections::HashMap, sync::OnceLock};

use axum::{
    body::Bytes,
    extract::{Query, State, WebSocketUpgrade},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Json, Response},
    routing::{get, post},
    Router,
};
use tower_http::cors::CorsLayer;

use crate::{
    files,
    state::{AppState, ShimConfig, SupervisorCmd},
    ws,
};

pub fn router(state: AppState) -> Router {
    let cors = CorsLayer::permissive(); // keep as-is: no invented origin logic
    Router::new()
        .route("/health", get(health))
        .route("/ws", get(ws_upgrade))
        .route("/files/:token", get(files::serve_token))
        .route("/api/files", get(files::browse))
        .route("/api/files/raw", get(files::serve_raw))
        .route("/upnp/status", get(upnp_status))
        .route("/api/upnp/status", get(upnp_status))
        .route("/portchecker", get(portchecker))
        .route("/api/portchecker", get(portchecker))
        .route("/interfaces", get(interfaces))
        .route("/api/interfaces", get(interfaces))
        .route("/logs", get(logs))
        .route("/diagnostics", get(diagnostics))
        .route("/plugins", get(plugins))
        .route("/plugins/install", post(plugins_install))
        .route("/container", get(container))
        .route("/restart", post(restart))
        .route("/spectrum/", get(spectrum_gone))
        .route("/spectrum/*rest", get(spectrum_gone))
        .route("/api/spectrum/", get(spectrum_gone))
        .route("/api/spectrum/*rest", get(spectrum_gone))
        .layer(cors)
        .with_state(state)
}

/// Token sources mirror server.ts extractToken: ?token=, Bearer, ws subprotocol.
pub fn extract_token(query: &HashMap<String, String>, headers: &HeaderMap) -> Option<String> {
    if let Some(t) = query.get("token") {
        if !t.is_empty() {
            return Some(t.clone());
        }
    }
    if let Some(a) = headers
        .get(header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
    {
        if let Some(tok) = a.strip_prefix("Bearer ") {
            if !tok.is_empty() {
                return Some(tok.to_string());
            }
        }
    }
    if let Some(p) = headers
        .get("sec-websocket-protocol")
        .and_then(|v| v.to_str().ok())
    {
        for part in p.split(',').map(|s| s.trim()) {
            if !part.is_empty() && part != "bearer" {
                return Some(part.to_string());
            }
        }
    }
    None
}

fn require_auth(
    state: &AppState,
    query: &HashMap<String, String>,
    headers: &HeaderMap,
) -> Option<Response> {
    if state.config.bridge_token.is_empty() {
        return None;
    }
    let ok = extract_token(query, headers).map_or(false, |t| t == state.config.bridge_token);
    if ok {
        None
    } else {
        Some((StatusCode::UNAUTHORIZED, "Unauthorized").into_response())
    }
}

static START: OnceLock<std::time::Instant> = OnceLock::new();

fn uptime_secs() -> u64 {
    START
        .get_or_init(std::time::Instant::now)
        .elapsed()
        .as_secs()
}

fn now_iso() -> String {
    // ponytail: hand-rolled RFC3339 (std only), use chrono when a date dep lands.
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let days = secs.div_euclid(86400);
    let rem = secs.rem_euclid(86400);
    let (y, m, d) = civil_from_days(days);
    format!(
        "{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.000Z",
        y,
        m,
        d,
        rem / 3600,
        (rem % 3600) / 60,
        rem % 60
    )
}

fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let z = days + 719468;
    let era = z.div_euclid(146097);
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn app_version() -> String {
    for k in ["APP_VERSION", "BUILD_TAG", "TAG"] {
        if let Ok(v) = std::env::var(k) {
            if !v.trim().is_empty() {
                return v;
            }
        }
    }
    env!("CARGO_PKG_VERSION").to_string()
}

fn commit_sha() -> String {
    let raw = std::env::var("COMMIT_SHA")
        .or_else(|_| std::env::var("VERCEL_GIT_COMMIT_SHA"))
        .unwrap_or_default();
    raw.chars().take(7).collect()
}

fn build_date() -> String {
    std::env::var("BUILD_DATE")
        .or_else(|_| std::env::var("NEXT_PUBLIC_BUILD_DATE"))
        .unwrap_or_default()
}

fn upnp_stub(config: &ShimConfig) -> serde_json::Value {
    // ponytail: daemon owns listener, no UPnP mapping yet; report disabled when daemon exposes it.
    serde_json::json!({
        "enabled": false,
        "active": null,
        "port": config.listen_port,
        "ip": null,
        "error": "upnp not managed by shim v1",
        "lastSuccessAt": null,
        "hasPort": true,
    })
}

async fn daemon_status(state: &AppState) -> Option<serde_json::Value> {
    tokio::time::timeout(
        std::time::Duration::from_secs(2),
        state.call_rpc("daemon.status", serde_json::json!({})),
    )
    .await
    .ok()?
    .ok()
}

async fn full_health(state: &AppState) -> serde_json::Value {
    let mut h = serde_json::json!({
        "ok": true,
        "ts": now_iso(),
        "uptime": uptime_secs(),
        "port": state.config.port,
        "listenPort": state.config.listen_port,
        "configDir": state.config.config_dir.to_string_lossy(),
        "dataDir": state.config.data_dir.to_string_lossy(),
        "tokenAuth": !state.config.bridge_token.is_empty(),
        "version": app_version(),
        "commitSha": commit_sha(),
        "buildDate": build_date(),
        "upnp": upnp_stub(&state.config),
    });
    if let Some(st) = daemon_status(state).await {
        if let Some(u) = st.get("username") {
            h["username"] = u.clone();
            h["loggedIn"] = serde_json::Value::Bool(u.as_str().is_some_and(|s| !s.is_empty()));
        }
        if let Some(v) = st.get("daemon_version") {
            h["daemonVersion"] = v.clone();
        }
    }
    h
}

async fn health(
    State(state): State<AppState>,
    Query(q): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    let accept_json = headers
        .get(header::ACCEPT)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|a| a.contains("application/json"));
    if !(q.contains_key("json") || accept_json) {
        return ([("cache-control", "no-store")], "ok").into_response();
    }
    // Gated detail: token set + bad token sees redacted dump (server.ts:911).
    if require_auth(&state, &q, &headers).is_some() {
        return Json(serde_json::json!({
            "ok": true,
            "ts": now_iso(),
            "uptime": uptime_secs(),
            "port": state.config.port,
            "tokenAuth": true,
            "version": app_version(),
            "commitSha": commit_sha(),
        }))
        .into_response();
    }
    Json(full_health(&state).await).into_response()
}

async fn ws_upgrade(
    ws: WebSocketUpgrade,
    Query(q): Query<HashMap<String, String>>,
    headers: HeaderMap,
    State(state): State<AppState>,
) -> impl IntoResponse {
    if !state.config.bridge_token.is_empty() {
        let ok = extract_token(&q, &headers).is_some_and(|t| t == state.config.bridge_token);
        if !ok {
            return StatusCode::UNAUTHORIZED.into_response();
        }
    }
    ws.on_upgrade(|socket| ws::handle(socket, state))
}

async fn upnp_status(
    State(state): State<AppState>,
    Query(q): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Some(r) = require_auth(&state, &q, &headers) {
        return r;
    }
    Json(serde_json::json!({
        "enabled": false,
        "active": null,
        "port": state.config.listen_port,
        "ip": null,
        "error": "upnp not managed by shim v1",
        "lastSuccessAt": null,
        "hasPort": true,
        "listenPort": state.config.listen_port,
        "ts": now_iso(),
    }))
    .into_response()
}

async fn portchecker(
    State(state): State<AppState>,
    Query(q): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Some(r) = require_auth(&state, &q, &headers) {
        return r;
    }
    let port = q
        .get("port")
        .and_then(|p| p.parse::<i64>().ok())
        .filter(|p| (1..=65535).contains(p))
        .map(|p| p as u16)
        .unwrap_or(state.config.listen_port);
    // ponytail: no external probe in v1 (needs slsknet.org checker), add when daemon exposes one.
    Json(serde_json::json!({
        "port": port,
        "open": null,
        "error": "portchecker not implemented in shim v1",
        "upnp": upnp_stub(&state.config),
        "listenPort": port,
        "ts": now_iso(),
    }))
    .into_response()
}

async fn interfaces(
    State(state): State<AppState>,
    Query(q): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Some(r) = require_auth(&state, &q, &headers) {
        return r;
    }
    // ponytail: std has no ifaddrs; outbound IP only, add getifaddrs dep when full list needed.
    let mut out = Vec::new();
    if let Ok(sock) = tokio::net::UdpSocket::bind("0.0.0.0:0").await {
        if sock.connect("8.8.8.8:80").await.is_ok() {
            if let Ok(local) = sock.local_addr() {
                if let std::net::IpAddr::V4(v4) = local.ip() {
                    out.push(serde_json::json!({
                        "name": "outbound",
                        "address": v4.to_string(),
                        "netmask": null,
                        "family": "IPv4",
                        "internal": false,
                        "mac": null,
                        "cidr": null,
                    }));
                }
            }
        }
    }
    Json(serde_json::Value::Array(out)).into_response()
}

async fn logs(
    State(state): State<AppState>,
    Query(q): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Some(r) = require_auth(&state, &q, &headers) {
        return r;
    }
    let _tail: usize = q
        .get("tail")
        .and_then(|t| t.parse().ok())
        .map(|t: i64| t.clamp(1, 2000) as usize)
        .unwrap_or(500);
    let _level = q.get("level").cloned().unwrap_or_default();
    let _scope = q.get("scope").cloned().unwrap_or_default();
    // ponytail: no persisted diag buffer in v1 (daemon events not replayable), add ring buffer when web needs history.
    Json(serde_json::json!({"entries": [], "total": 0})).into_response()
}

async fn diagnostics(
    State(state): State<AppState>,
    Query(q): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Some(r) = require_auth(&state, &q, &headers) {
        return r;
    }
    let health = full_health(&state).await;
    // ponytail: logs empty (see /logs), fill when diag buffer lands.
    Json(serde_json::json!({"health": health, "logs": []})).into_response()
}

async fn plugins(
    State(state): State<AppState>,
    Query(q): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Some(r) = require_auth(&state, &q, &headers) {
        return r;
    }
    // ponytail: no plugin runtime in shim v1 (daemon has none), report empty when one lands.
    Json(serde_json::json!({"plugins": [], "globalEnable": true})).into_response()
}

async fn plugins_install(
    State(state): State<AppState>,
    Query(q): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Some(r) = require_auth(&state, &q, &headers) {
        return r;
    }
    if let Some(len) = headers
        .get(header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.parse::<u64>().ok())
    {
        if len > 20_000_000 {
            return (
                StatusCode::PAYLOAD_TOO_LARGE,
                Json(serde_json::json!({"error": "payload too large (max 20MB)"})),
            )
                .into_response();
        }
    }
    // ponytail: honest 501, no plugin runtime in v1; implement zip install when runtime lands.
    (
        StatusCode::NOT_IMPLEMENTED,
        Json(serde_json::json!({"error": "plugin install not available in shim v1"})),
    )
        .into_response()
}

async fn container(
    State(state): State<AppState>,
    Query(q): Query<HashMap<String, String>>,
    headers: HeaderMap,
) -> impl IntoResponse {
    if let Some(r) = require_auth(&state, &q, &headers) {
        return r;
    }
    // ponytail: no docker socket in shim v1, recreate never; add when ALLOW_CONTAINER_RESTART needed.
    Json(serde_json::json!({
        "enabled": false,
        "socket": false,
        "socketPath": "/var/run/docker.sock",
        "inProgress": false,
        "last": null,
        "selfId": null,
        "name": null,
        "mapping": [],
        "envPort": null,
        "wantPort": state.config.listen_port,
        "mappingMatches": false,
        "ts": now_iso(),
    }))
    .into_response()
}

async fn restart(
    State(state): State<AppState>,
    Query(q): Query<HashMap<String, String>>,
    headers: HeaderMap,
    body: Bytes,
) -> impl IntoResponse {
    if let Some(r) = require_auth(&state, &q, &headers) {
        return r;
    }
    // Optional {"port": N}; empty/unparseable body keeps current (server.ts:1207).
    let mut port = state.config.listen_port;
    if !body.is_empty() {
        if let Ok(v) = serde_json::from_slice::<serde_json::Value>(&body) {
            if let Some(pv) = v.get("port") {
                match pv.as_u64() {
                    Some(p) if (1024..=65535).contains(&p) => port = p as u16,
                    _ => {
                        return (
                            StatusCode::BAD_REQUEST,
                            Json(serde_json::json!({
                                "error": format!("Invalid listen port {pv} (must be 1024-65535)")
                            })),
                        )
                            .into_response();
                    }
                }
            }
        }
    }
    // ponytail: daemon restart via supervisor only, no container recreate in v1.
    let _ = state.supervisor_tx.send(SupervisorCmd::Restart);
    (
        StatusCode::ACCEPTED,
        Json(serde_json::json!({
            "ok": true,
            "restarting": true,
            "port": port,
            "ts": now_iso(),
        })),
    )
        .into_response()
}

async fn spectrum_gone() -> impl IntoResponse {
    (
        StatusCode::GONE,
        Json(serde_json::json!({
            "error": "moved to worker: POST /spectrum/request on :8789"
        })),
    )
}
