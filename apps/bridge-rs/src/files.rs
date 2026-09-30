//! File egress: /files/:token (24h, finished-only) + /api/files[/raw].
//! Daemon never returns bytes (FS only); serve from shared DATA_DIR.
//! Reference: apps/bridge/src/server.ts:1078,1112,1222 + files.ts:132.
//! Owner: http-agent.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

use axum::{
    extract::{Path as AxPath, Query, State},
    http::{header, HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde::Serialize;
use tokio::io::{AsyncReadExt, AsyncSeekExt};

use crate::{http::extract_token, state::AppState};

pub const RAW_MAX_BYTES: u64 = 500 * 1024 * 1024;
pub const PREVIEW_MAX_BYTES: u64 = 25 * 1024 * 1024;
const PATH_MAX_LEN: usize = 1024;
const LIST_CAP: usize = 5000;

/// GET /files/:token — finished-download token, 24h expiry, Range support.
/// Registry holds finished entries only; containment under DATA_DIR; auth-gated.
pub async fn serve_token(
    AxPath(token): AxPath<String>,
    Query(q): Query<HashMap<String, String>>,
    headers: HeaderMap,
    State(state): State<AppState>,
) -> Response {
    if token.is_empty() {
        return StatusCode::NOT_FOUND.into_response();
    }
    if !authed(&state, &q, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let path = {
        let mut reg = state.file_tokens.lock().unwrap();
        match reg.get(&token) {
            Some((p, at)) if at.elapsed() < AppState::file_token_ttl() => p.clone(),
            _ => {
                reg.remove(&token);
                return StatusCode::NOT_FOUND.into_response();
            }
        }
    };
    if !path.is_absolute() {
        return StatusCode::NOT_FOUND.into_response();
    }
    // Containment under DATA_DIR (lexical first, then realpath when present).
    let root = canonical_root(&state.config.data_dir).await;
    if !under_root(&path, &root) {
        return StatusCode::NOT_FOUND.into_response();
    }
    if let Ok(real) = tokio::fs::canonicalize(&path).await {
        if !under_root(&real, &root) {
            return StatusCode::NOT_FOUND.into_response();
        }
    }
    let name = sanitize_filename(
        path.file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("download"),
    );
    serve_path(&path, &headers, Some(&name)).await
}

/// GET /api/files?path= — listDirectory under host root, traversal guarded.
pub async fn browse(
    Query(q): Query<HashMap<String, String>>,
    headers: HeaderMap,
    State(state): State<AppState>,
) -> Response {
    if !authed(&state, &q, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let raw = q.get("path").map(|s| s.as_str()).unwrap_or("/");
    if raw.len() > PATH_MAX_LEN || raw.contains('\0') {
        return (
            StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({"error": "invalid path"})),
        )
            .into_response();
    }
    match list_directory(raw, Path::new("/")).await {
        Ok(r) => axum::Json(serde_json::json!({
            "path": r.path,
            "parent": r.parent,
            "entries": r.entries,
        }))
        .into_response(),
        Err(ListErr::Traversal) => (
            StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({"error": "path traversal blocked"})),
        )
            .into_response(),
        Err(ListErr::NotFound) => (
            StatusCode::NOT_FOUND,
            axum::Json(serde_json::json!({"error": "not found"})),
        )
            .into_response(),
        Err(ListErr::NotDir(msg)) => (
            StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({"error": msg})),
        )
            .into_response(),
        Err(ListErr::Io) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            axum::Json(serde_json::json!({"error": "internal error"})),
        )
            .into_response(),
    }
}

/// GET /api/files/raw?path= — range-served bytes, 500MB cap, preview 25MB cap.
pub async fn serve_raw(
    Query(q): Query<HashMap<String, String>>,
    headers: HeaderMap,
    State(state): State<AppState>,
) -> Response {
    if !authed(&state, &q, &headers) {
        return StatusCode::UNAUTHORIZED.into_response();
    }
    let raw = q.get("path").map(|s| s.as_str()).unwrap_or("");
    if raw.is_empty() || raw.len() > PATH_MAX_LEN || raw.contains('\0') {
        return (
            StatusCode::BAD_REQUEST,
            axum::Json(serde_json::json!({"error": "invalid path"})),
        )
            .into_response();
    }
    let root = Path::new("/");
    let abs = match resolve_safe_path(raw, root).await {
        Ok(p) => p,
        Err(_) => {
            return (
                StatusCode::BAD_REQUEST,
                axum::Json(serde_json::json!({"error": "path traversal blocked"})),
            )
                .into_response();
        }
    };
    let meta = match tokio::fs::metadata(&abs).await {
        Ok(m) => m,
        Err(_) => return StatusCode::NOT_FOUND.into_response(),
    };
    if !meta.is_file() {
        return StatusCode::NOT_FOUND.into_response();
    }
    // Serve the symlink target, containment re-checked (mirrors files.ts realpath).
    let mut real = abs;
    if let Ok(canon) = tokio::fs::canonicalize(&real).await {
        if !under_root(&canon, root) {
            return (
                StatusCode::BAD_REQUEST,
                axum::Json(serde_json::json!({"error": "path traversal blocked"})),
            )
                .into_response();
        }
        real = canon;
    }
    let size = meta.len();
    if size > RAW_MAX_BYTES {
        return (
            StatusCode::PAYLOAD_TOO_LARGE,
            axum::Json(serde_json::json!({"error": "file too large to stream"})),
        )
            .into_response();
    }
    if q.get("preview").map(|s| s.as_str()) == Some("1") && size > PREVIEW_MAX_BYTES {
        return (
            StatusCode::PAYLOAD_TOO_LARGE,
            axum::Json(serde_json::json!({"error": "too large to preview"})),
        )
            .into_response();
    }
    let name = sanitize_filename(
        real.file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("download"),
    );
    serve_path(&real, &headers, Some(&name)).await
}

fn authed(state: &AppState, q: &HashMap<String, String>, h: &HeaderMap) -> bool {
    state.config.bridge_token.is_empty()
        || extract_token(q, h).is_some_and(|t| t == state.config.bridge_token)
}

fn under_root(path: &Path, root: &Path) -> bool {
    path == root || path.starts_with(root)
}

async fn canonical_root(dir: &Path) -> PathBuf {
    tokio::fs::canonicalize(dir)
        .await
        .unwrap_or_else(|_| dir.to_path_buf())
}

/// Whole-file serve with single Range support + Content-Disposition/MIME.
/// Kept helper (was whole-file only); range reads slice via seek, no full load.
async fn serve_path(path: &Path, headers: &HeaderMap, file_name: Option<&str>) -> Response {
    // ponytail: full/read-slice via File (no Body streaming yet); stream when >100MB TTFB matters.
    let meta = match tokio::fs::metadata(path).await {
        Ok(m) if m.is_file() => m,
        _ => return StatusCode::NOT_FOUND.into_response(),
    };
    let size = meta.len();
    let name = file_name
        .map(sanitize_filename)
        .unwrap_or_else(|| "download".to_string());
    let mime = mime_for(&name);
    let encoded = encode_rfc5987(&name);
    let disposition = format!(
        "{}; filename=\"{name}\"; filename*=UTF-8''{encoded}",
        if mime.is_some() {
            "inline"
        } else {
            "attachment"
        }
    );
    let mut h = HeaderMap::new();
    h.insert("accept-ranges", "bytes".parse().unwrap());
    h.insert("x-content-type-options", "nosniff".parse().unwrap());
    h.insert("cache-control", "private, no-store".parse().unwrap());
    h.insert(
        "content-security-policy",
        "default-src 'none'".parse().unwrap(),
    );
    h.insert(
        header::CONTENT_DISPOSITION,
        disposition
            .parse()
            .unwrap_or_else(|_| "attachment".parse().unwrap()),
    );
    if let Some(m) = mime {
        if let Ok(v) = m.parse() {
            h.insert(header::CONTENT_TYPE, v);
        }
    }
    let range_hdr = headers
        .get(header::RANGE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    match parse_range(range_hdr, size) {
        RangeParse::Unsatisfiable => {
            h.insert(
                header::CONTENT_RANGE,
                format!("bytes */{size}").parse().unwrap(),
            );
            (StatusCode::RANGE_NOT_SATISFIABLE, h, "bad range").into_response()
        }
        RangeParse::Range(start, end) => {
            let len = end - start + 1;
            let mut f = match tokio::fs::File::open(path).await {
                Ok(f) => f,
                Err(_) => return StatusCode::NOT_FOUND.into_response(),
            };
            if f.seek(std::io::SeekFrom::Start(start)).await.is_err() {
                return StatusCode::NOT_FOUND.into_response();
            }
            let mut buf = Vec::with_capacity(len.min(8 * 1024 * 1024) as usize);
            if f.take(len).read_to_end(&mut buf).await.is_err() {
                return StatusCode::NOT_FOUND.into_response();
            }
            h.insert(
                header::CONTENT_RANGE,
                format!("bytes {start}-{end}/{size}").parse().unwrap(),
            );
            h.insert(
                header::CONTENT_LENGTH,
                buf.len().to_string().parse().unwrap(),
            );
            (StatusCode::PARTIAL_CONTENT, h, buf).into_response()
        }
        RangeParse::Ignore => match tokio::fs::read(path).await {
            Ok(data) => {
                h.insert(
                    header::CONTENT_LENGTH,
                    data.len().to_string().parse().unwrap(),
                );
                (StatusCode::OK, h, data).into_response()
            }
            Err(_) => StatusCode::NOT_FOUND.into_response(),
        },
    }
}

/// files.ts parseRange: single `bytes=start-end`, suffix `bytes=-N` ok,
/// multi-range (comma) ignored; start>=size is unsatisfiable.
enum RangeParse {
    Ignore,
    Range(u64, u64),
    Unsatisfiable,
}

fn parse_range(s: &str, size: u64) -> RangeParse {
    let spec = match s.strip_prefix("bytes=") {
        Some(r) => r.trim(),
        None => return RangeParse::Ignore,
    };
    if spec.contains(',') {
        return RangeParse::Ignore;
    }
    let (a, b) = match spec.split_once('-') {
        Some(p) => p,
        None => return RangeParse::Ignore,
    };
    if a.trim().is_empty() {
        // Suffix: last N bytes.
        let n: u64 = match b.trim().parse() {
            Ok(n) if n > 0 => n,
            _ => return RangeParse::Ignore,
        };
        if size == 0 {
            return RangeParse::Unsatisfiable;
        }
        let start = size.saturating_sub(n);
        return RangeParse::Range(start, size - 1);
    }
    let start: u64 = match a.trim().parse() {
        Ok(n) => n,
        _ => return RangeParse::Ignore,
    };
    let end: u64 = if b.trim().is_empty() {
        if size == 0 {
            return RangeParse::Unsatisfiable;
        }
        size - 1
    } else {
        match b.trim().parse() {
            Ok(n) => n,
            _ => return RangeParse::Ignore,
        }
    };
    if end < start {
        return RangeParse::Ignore;
    }
    if start >= size {
        return RangeParse::Unsatisfiable;
    }
    RangeParse::Range(start, end.min(size - 1))
}

// ---- safe-path logic (mirrors apps/bridge/src/files.ts) ----

fn normalize_requested_path(raw: Option<&str>) -> String {
    let mut p = raw.unwrap_or("").trim().replace('\0', "");
    if p.is_empty() {
        return "/".to_string();
    }
    if p.len() > PATH_MAX_LEN {
        p.truncate(PATH_MAX_LEN);
    }
    if !p.starts_with('/') {
        p.insert(0, '/');
    }
    let mut out = String::with_capacity(p.len());
    let mut prev_slash = false;
    for c in p.chars() {
        if c == '/' {
            if !prev_slash {
                out.push(c);
            }
            prev_slash = true;
        } else {
            out.push(c);
            prev_slash = false;
        }
    }
    if out.len() > 1 && out.ends_with('/') {
        out.pop();
    }
    if out.is_empty() {
        "/".to_string()
    } else {
        out
    }
}

fn clean_join(root: &Path, rel: &str) -> PathBuf {
    let mut p = root.to_path_buf();
    for comp in rel.split('/') {
        match comp {
            "" | "." => {}
            // ponytail: lexical pop clamped at root; realpath re-check covers symlink escapes.
            ".." => {
                if p.as_path() != root {
                    p.pop();
                }
            }
            c => p.push(c),
        }
    }
    p
}

async fn resolve_safe_path(requested: &str, root: &Path) -> Result<PathBuf, ()> {
    let normalized = normalize_requested_path(Some(requested));
    let rel = normalized.strip_prefix('/').unwrap_or(&normalized);
    let joined = clean_join(root, rel);
    if !under_root(&joined, root) {
        return Err(());
    }
    if let Ok(meta) = tokio::fs::symlink_metadata(&joined).await {
        if meta.file_type().is_symlink() {
            if let Ok(real) = tokio::fs::canonicalize(&joined).await {
                if !under_root(&real, root) {
                    return Err(());
                }
            }
        }
    }
    Ok(joined)
}

fn get_parent_path(normalized: &str) -> Option<String> {
    let n = normalize_requested_path(Some(normalized));
    if n == "/" {
        return None;
    }
    match n.rfind('/') {
        Some(0) => Some("/".to_string()),
        Some(i) => Some(n[..i].to_string()),
        None => None,
    }
}

/// Strict filename whitelist for Content-Disposition (mirrors files.ts).
fn sanitize_filename(name: &str) -> String {
    let mut s: String = name
        .chars()
        .filter(|c| *c != '\r' && *c != '\n' && *c != '"')
        .collect();
    s = s.replace(['/', '\\'], "_");
    s = s.trim().to_string();
    s = s.chars().filter(|c| !c.is_control()).collect();
    if s.is_empty() || s.len() > 255 {
        return "download".to_string();
    }
    const OK: &str =
        "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789._- ()[]{}!@#$%^&+=,;~`'";
    let safe: String = s
        .chars()
        .map(|c| if OK.contains(c) { c } else { '_' })
        .collect();
    if safe.is_empty() {
        "download".to_string()
    } else {
        safe
    }
}

fn ext_of(name: &str) -> String {
    match name.rfind('.') {
        Some(i) => name[i + 1..].to_lowercase(),
        None => String::new(),
    }
}

fn mime_for(name: &str) -> Option<&'static str> {
    match ext_of(name).as_str() {
        "mp3" => Some("audio/mpeg"),
        "flac" => Some("audio/flac"),
        "ogg" | "oga" | "opus" => Some("audio/ogg"),
        "wav" => Some("audio/wav"),
        "m4a" => Some("audio/mp4"),
        "aac" => Some("audio/aac"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "png" => Some("image/png"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "bmp" => Some("image/bmp"),
        "ico" => Some("image/x-icon"),
        _ => None,
    }
}

fn encode_rfc5987(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for b in s.bytes() {
        if matches!(b, b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'.' | b'_' | b'~' | b'!' | b'\'' | b'(' | b')' | b'*')
        {
            o.push(b as char);
        } else {
            o.push_str(&format!("%{b:02X}"));
        }
    }
    o
}

#[derive(Debug, Serialize)]
struct FileEntry {
    name: String,
    #[serde(rename = "type")]
    entry_type: String,
    size: u64,
    mtime: u64,
    path: String,
}

struct BrowseResult {
    path: String,
    parent: Option<String>,
    entries: Vec<FileEntry>,
}

enum ListErr {
    Traversal,
    NotFound,
    NotDir(String),
    Io,
}

async fn list_directory(requested: &str, root: &Path) -> Result<BrowseResult, ListErr> {
    let normalized = normalize_requested_path(Some(requested));
    let abs = resolve_safe_path(&normalized, root)
        .await
        .map_err(|_| ListErr::Traversal)?;
    let meta = tokio::fs::metadata(&abs)
        .await
        .map_err(|_| ListErr::NotFound)?;
    if !meta.is_dir() {
        return Err(ListErr::NotDir(format!("Not a directory: {normalized}")));
    }
    let mut rd = tokio::fs::read_dir(&abs).await.map_err(|_| ListErr::Io)?;
    let mut entries = Vec::new();
    while let Ok(Some(e)) = rd.next_entry().await {
        let name = e.file_name().to_string_lossy().into_owned();
        if name == "." || name == ".." {
            continue;
        }
        if name.chars().any(|c| c.is_control()) {
            continue;
        }
        let full = e.path();
        let lst = match tokio::fs::symlink_metadata(&full).await {
            Ok(m) => m,
            Err(_) => continue,
        };
        let (entry_type, size, mtime) = if lst.file_type().is_symlink() {
            match tokio::fs::metadata(&full).await {
                Ok(t) => (
                    "symlink".to_string(),
                    if t.is_dir() { 0 } else { t.len() },
                    mtime_ms(&t),
                ),
                Err(_) => ("symlink".to_string(), 0, mtime_ms(&lst)),
            }
        } else if lst.is_dir() {
            ("directory".to_string(), 0, mtime_ms(&lst))
        } else {
            ("file".to_string(), lst.len(), mtime_ms(&lst))
        };
        let rel = if normalized == "/" {
            format!("/{name}")
        } else {
            format!("{normalized}/{name}")
        };
        entries.push(FileEntry {
            name,
            entry_type,
            size,
            mtime,
            path: rel,
        });
    }
    entries.sort_by(|a, b| {
        let rank = |t: &str| match t {
            "directory" => 0,
            "symlink" => 1,
            _ => 2,
        };
        let (ra, rb) = (rank(&a.entry_type), rank(&b.entry_type));
        if ra != rb {
            return ra.cmp(&rb);
        }
        a.name.to_lowercase().cmp(&b.name.to_lowercase())
    });
    entries.truncate(LIST_CAP);
    Ok(BrowseResult {
        parent: get_parent_path(&normalized),
        path: normalized,
        entries,
    })
}

fn mtime_ms(m: &std::fs::Metadata) -> u64 {
    m.modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}
