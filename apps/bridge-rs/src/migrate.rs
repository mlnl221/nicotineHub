//! One-shot `CONFIG_DIR` migration: settings.json -> slsk-rs/config.toml,
//! shares flatten, downloads envelope, listen_port 2234, wishlist array.
//! worker.json untouched. Vault + logs/ carried as-is. browse.cache bytes
//! preserved verbatim. Idempotent via slsk-rs/.migrated marker.

use std::path::{Path, PathBuf};

use anyhow::Result;
use serde_json::Value;

use crate::state::ShimConfig;

/// Bridge default peer port; soulseek-rs uses 2234 instead.
const LEGACY_LISTEN_PORT: u16 = 60754;
const RS_LISTEN_PORT: u16 = 2234;

/// Run the migration and print a summary. Idempotent: skips done markers.
pub async fn run(config: &ShimConfig) -> Result<()> {
    let src = config.config_dir.clone();
    let dst = src.join("slsk-rs");
    let marker = dst.join(".migrated");
    if marker.exists() {
        println!("migrate: already done ({})", marker.display());
        return Ok(());
    }
    std::fs::create_dir_all(&dst)?;
    let state_dir = config.state_dir();
    std::fs::create_dir_all(&state_dir)?;

    let data = config.data_dir.clone();
    let settings = load_first(&[src.join("settings.json"), data.join("settings.json")]);

    // ---- config.toml values ----
    let username = settings
        .as_ref()
        .and_then(|s| s.get("server"))
        .and_then(|s| s.get("login"))
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .map(|s| s.trim().to_string());
    let server = settings
        .as_ref()
        .and_then(|s| s.get("server"))
        .and_then(|s| s.get("server"))
        .and_then(|v| server_string(v));
    let (listener_port, port_notice) = migrate_port(&src, &data, settings.as_ref());
    let download_dir = settings
        .as_ref()
        .and_then(|s| s.get("transfers"))
        .and_then(|t| t.get("downloaddir"))
        .and_then(Value::as_str)
        .filter(|s| !s.trim().is_empty())
        .map(|s| expand(s, &src, &data));
    let search_timeout = settings.as_ref().and_then(search_timeout_of);
    let (shared_dirs, dropped_shares) = shared_dirs_of(&src, &data, settings.as_ref(), &src, &data);
    let wishes = wishlist_of(&load_first(&[
        src.join("wishlist.json"),
        data.join("wishlist.json"),
    ]));

    // ponytail: hand-rolled TOML (no toml crate for 7 known keys); add serde emit when keys grow.
    let mut toml =
        String::from("# Migrated from CONFIG_DIR/settings.json by nicotine-shim migrate.\n");
    let mut toml_keys = 0;
    if let Some(ref u) = username {
        toml.push_str(&format!("username = {}\n", toml_str(u)));
        toml_keys += 1;
    }
    if let Some(ref s) = server {
        toml.push_str(&format!("server = {}\n", toml_str(s)));
        toml_keys += 1;
    }
    if let Some(p) = listener_port {
        toml.push_str(&format!("listener_port = {p}\n"));
        toml_keys += 1;
    }
    if let Some(ref d) = download_dir {
        toml.push_str(&format!("download_dir = {}\n", toml_str(d)));
        toml_keys += 1;
    }
    if !shared_dirs.is_empty() {
        toml.push_str(&format!("shared_dirs = {}\n", toml_array(&shared_dirs)));
        toml_keys += 1;
    }
    if let Some(t) = search_timeout {
        toml.push_str(&format!("search_timeout = {t}\n"));
        toml_keys += 1;
    }
    if !wishes.is_empty() {
        toml.push_str(&format!("wishlist = {}\n", toml_array(&wishes)));
        toml_keys += 1;
    }
    atomic_write(&dst.join("config.toml"), toml.as_bytes())?;

    // ---- downloads.json envelope {version:0, data} ----
    let dl_raw = load_first(&[
        src.join("downloads.json"),
        src.join("transfers.json"),
        data.join("downloads.json"),
        data.join("transfers.json"),
    ]);
    let (dl_written, dl_uploads, dl_skipped) =
        migrate_downloads(&dl_raw, &state_dir.join("downloads.json"), &data)?;

    // ---- verbatim copies ----
    let mut copied = 0;
    for f in ["session.vault", ".vault.key", "browse.cache"] {
        if copy_if_exists(&src.join(f), &dst.join(f))? {
            #[cfg(unix)]
            if f != "browse.cache" {
                use std::os::unix::fs::PermissionsExt;
                let _ =
                    std::fs::set_permissions(dst.join(f), std::fs::Permissions::from_mode(0o600));
            }
            copied += 1;
        }
    }
    copied += copy_dir(&src.join("logs"), &dst.join("logs"))?;

    std::fs::write(&marker, format!("migrated {toml_keys} keys\n"))?;

    println!(
        "migrate: done config.toml ({toml_keys} keys) shares={} dropped_buddy_trusted={} downloads={} (uploads_skipped={} bad={}) wishes={} files_copied={} worker.json untouched",
        shared_dirs.len(),
        dropped_shares,
        dl_written,
        dl_uploads,
        dl_skipped,
        wishes.len(),
        copied,
    );
    if port_notice {
        println!(
            "migrate: notice listen_port {LEGACY_LISTEN_PORT} (bridge default) -> {RS_LISTEN_PORT} (soulseek-rs default); republish host port TCP+UDP"
        );
    }
    if dropped_shares > 0 {
        println!(
            "migrate: notice {dropped_shares} buddy/trusted shares have no tier in soulseek-rs and were dropped (public shares carried over)"
        );
    }
    Ok(())
}

/// First path that exists and parses as JSON.
fn load_first(paths: &[PathBuf]) -> Option<Value> {
    paths.iter().find_map(|p| {
        std::fs::read_to_string(p)
            .ok()
            .and_then(|t| serde_json::from_str(&t).ok())
    })
}

/// settings server.server is `{host, port}` or a `"host:port"` string.
fn server_string(v: &Value) -> Option<String> {
    if let Some(s) = v.as_str() {
        return (!s.trim().is_empty()).then(|| s.trim().to_string());
    }
    let host = v.get("host")?.as_str().filter(|s| !s.is_empty())?;
    match v.get("port").and_then(Value::as_u64) {
        Some(p) => Some(format!("{host}:{p}")),
        None => Some(host.to_string()),
    }
}

/// listen_port file (CONFIG_DIR then DATA_DIR, mirroring server.ts) beats
/// settings server.portrange[0] / listen_port; 60754 maps to 2234 + notice.
fn migrate_port(src: &Path, data: &Path, settings: Option<&Value>) -> (Option<u16>, bool) {
    let from_file = [src.join("listen_port"), data.join("listen_port")]
        .into_iter()
        .find_map(|p| {
            std::fs::read_to_string(p)
                .ok()
                .and_then(|t| t.trim().parse::<u16>().ok())
                .filter(|n| (1024..=65535).contains(n))
        });
    let from_settings = settings
        .and_then(|s| s.get("server"))
        .and_then(|s| {
            s.get("portrange")
                .and_then(|r| r.get(0))
                .and_then(Value::as_u64)
                .or_else(|| s.get("listen_port").and_then(Value::as_u64))
                .or_else(|| s.get("listenPort").and_then(Value::as_u64))
        })
        .and_then(|n| u16::try_from(n).ok())
        .filter(|n| (1024..=65535).contains(n));
    match from_file.or(from_settings) {
        Some(LEGACY_LISTEN_PORT) => (Some(RS_LISTEN_PORT), true),
        other => (other, false),
    }
}

/// ponytail: key hunt across sections (no single canonical key); first hit wins.
fn search_timeout_of(settings: &Value) -> Option<u64> {
    for section in ["searches", "server", "transfers"] {
        for key in ["search_timeout", "searchTimeout", "search_timeout_secs"] {
            if let Some(n) = settings
                .get(section)
                .and_then(|s| s.get(key))
                .and_then(Value::as_u64)
                .filter(|n| *n > 0)
            {
                return Some(n);
            }
        }
    }
    None
}

/// Public-tier real paths (settings transfers.shared pairs + shares.json
/// customRoots.public), deduped; buddy/trusted tiers counted as dropped.
fn shared_dirs_of(
    src: &Path,
    data: &Path,
    settings: Option<&Value>,
    cfg: &Path,
    dat: &Path,
) -> (Vec<String>, usize) {
    let _ = (src, data);
    let mut dirs: Vec<String> = Vec::new();
    let mut dropped = 0;
    let mut push = |d: &str, cfg: &Path, dat: &Path| {
        let e = expand(d, cfg, dat);
        if !e.is_empty() && !dirs.iter().any(|x| x == &e) {
            dirs.push(e);
        }
    };
    if let Some(t) = settings.and_then(|s| s.get("transfers")) {
        if let Some(arr) = t.get("shared").and_then(Value::as_array) {
            for item in arr {
                if let Some(real) = real_of_pair(item) {
                    push(real, cfg, dat);
                }
            }
        }
        for key in ["buddyshared", "trustedshared"] {
            dropped += t
                .get(key)
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or(0);
        }
    }
    if let Some(raw) = load_first(&[cfg.join("shares.json"), dat.join("shares.json")]) {
        for lvl in ["buddyFolders", "trustedFolders"] {
            dropped += raw
                .get(lvl)
                .and_then(Value::as_array)
                .map(Vec::len)
                .unwrap_or(0);
        }
        // ponytail: only customRoots carry real paths; scanned publicFolders are virtual names, unrecoverable.
        let roots = raw.get("customRoots").and_then(Value::as_object);
        if let Some(roots) = roots {
            for (lvl, arr) in roots {
                let public = lvl == "public";
                for item in arr.as_array().cloned().unwrap_or_default() {
                    if public {
                        if let Some(real) = real_of_pair(&item) {
                            push(real, cfg, dat);
                        }
                    } else {
                        dropped += 1;
                    }
                }
            }
        }
        if let Some(arr) = raw.get("customRootsByLevel").and_then(Value::as_array) {
            for entry in arr {
                let (lvl, items) = match entry.as_array() {
                    Some(e) if e.len() == 2 => (
                        e[0].as_str().unwrap_or("public"),
                        e[1].as_array().cloned().unwrap_or_default(),
                    ),
                    _ => continue,
                };
                for item in items {
                    if lvl == "public" {
                        if let Some(real) = real_of_pair(&item) {
                            push(real, cfg, dat);
                        }
                    } else {
                        dropped += 1;
                    }
                }
            }
        }
    }
    (dirs, dropped)
}

/// A share root is `[virtual, real]`; tolerate a bare string path.
fn real_of_pair(v: &Value) -> Option<&str> {
    match v {
        Value::String(s) => Some(s.as_str()),
        Value::Array(a) if a.len() == 2 => a[1].as_str(),
        _ => None,
    }
}

/// wishlist.json is `[{term, ...}]` or `["term"]`.
fn wishlist_of(raw: &Option<Value>) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for item in raw
        .as_ref()
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
    {
        let term = match &item {
            Value::String(s) => s.trim().to_string(),
            Value::Object(_) => item
                .get("term")
                .and_then(Value::as_str)
                .unwrap_or("")
                .trim()
                .to_string(),
            _ => String::new(),
        };
        if !term.is_empty() && !out.iter().any(|t| t == &term) {
            out.push(term);
        }
    }
    out
}

/// Bridge downloads.json (bare array; tolerate `{data: [...]}`) ->
/// daemon envelope `{version:0, data: PersistedDownload[]}`. Uploads skipped.
fn migrate_downloads(
    raw: &Option<Value>,
    dest: &Path,
    data_dir: &Path,
) -> Result<(usize, usize, usize)> {
    let items = match raw {
        Some(Value::Array(a)) => a.clone(),
        Some(Value::Object(_)) => raw
            .as_ref()
            .and_then(|v| v.get("data"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
        _ => Vec::new(),
    };
    let fallback_dir = data_dir.join("downloads").display().to_string();
    let mut out = Vec::new();
    let (mut uploads, mut skipped) = (0, 0);
    for t in &items {
        if t.get("isUpload").and_then(Value::as_bool) == Some(true) {
            uploads += 1;
            continue;
        }
        let (Some(user), Some(file)) = (
            t.get("username").and_then(Value::as_str),
            t.get("virtualPath").and_then(Value::as_str),
        ) else {
            skipped += 1;
            continue;
        };
        // ponytail: best-effort parent of the stored path; else <DATA_DIR>/downloads.
        let dir = [t.get("localPath"), t.get("_incompletePath")]
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .find_map(|p| {
                Path::new(p)
                    .parent()
                    .filter(|_| Path::new(p).is_absolute())
                    .map(|par| par.display().to_string())
            })
            .unwrap_or_else(|| fallback_dir.clone());
        out.push(serde_json::json!({
            "username": user,
            "filename": file,
            "size": t.get("size").and_then(Value::as_u64).unwrap_or(0),
            "download_directory": dir,
            "completed": t.get("status").and_then(Value::as_str) == Some("Finished"),
        }));
    }
    let envelope = serde_json::json!({ "version": 0, "data": out });
    atomic_write(
        dest,
        &serde_json::to_vec_pretty(&envelope).unwrap_or_default(),
    )?;
    Ok((out.len(), uploads, skipped))
}

fn expand(s: &str, cfg: &Path, data: &Path) -> String {
    s.trim()
        .replace("${DATA_DIR}", &data.display().to_string())
        .replace("${CONFIG_DIR}", &cfg.display().to_string())
}

fn toml_str(s: &str) -> String {
    let mut e = String::with_capacity(s.len() + 2);
    e.push('"');
    for c in s.chars() {
        match c {
            '\\' => e.push_str("\\\\"),
            '"' => e.push_str("\\\""),
            '\n' => e.push_str("\\n"),
            '\r' => e.push_str("\\r"),
            '\t' => e.push_str("\\t"),
            c if (c as u32) < 0x20 => {
                e.push_str(&format!("\\u{:04X}", c as u32));
            }
            c => e.push(c),
        }
    }
    e.push('"');
    e
}

fn toml_array(items: &[String]) -> String {
    let inner: Vec<String> = items.iter().map(|s| toml_str(s)).collect();
    format!("[{}]", inner.join(", "))
}

fn atomic_write(dest: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = dest.with_extension("tmp-migrate");
    std::fs::write(&tmp, bytes)?;
    std::fs::rename(&tmp, dest)?;
    Ok(())
}

fn copy_if_exists(src: &Path, dst: &Path) -> Result<bool> {
    if !src.is_file() {
        return Ok(false);
    }
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent)?;
    }
    std::fs::copy(src, dst)?;
    Ok(true)
}

/// ponytail: flat recursive copy, regular files only (symlinks skipped).
fn copy_dir(src: &Path, dst: &Path) -> Result<usize> {
    if !src.is_dir() {
        return Ok(0);
    }
    let mut copied = 0;
    let mut stack = vec![src.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in std::fs::read_dir(&dir)? {
            let entry = entry?;
            let path = entry.path();
            let rel = path.strip_prefix(src).unwrap_or(&path);
            if path.is_dir() {
                std::fs::create_dir_all(dst.join(rel))?;
                stack.push(path);
            } else if path.is_file() {
                if let Some(parent) = dst.join(rel).parent() {
                    std::fs::create_dir_all(parent)?;
                }
                std::fs::copy(&path, dst.join(rel))?;
                copied += 1;
            }
        }
    }
    Ok(copied)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn toml_escapes_quotes_and_controls() {
        assert_eq!(toml_str("a\"b\\c"), "\"a\\\"b\\\\c\"");
        assert_eq!(toml_str("l1\nl2"), "\"l1\\nl2\"");
    }

    #[test]
    fn legacy_port_maps_with_notice() {
        let tmp = std::env::temp_dir();
        let (port, notice) = migrate_port(&tmp, &tmp, None);
        assert_eq!((port, notice), (None, false));
        let settings = serde_json::json!({"server": {"portrange": [60754, 60754]}});
        assert_eq!(
            migrate_port(&tmp, &tmp, Some(&settings)),
            (Some(2234), true)
        );
        let custom = serde_json::json!({"server": {"portrange": [12345, 12345]}});
        assert_eq!(
            migrate_port(&tmp, &tmp, Some(&custom)),
            (Some(12345), false)
        );
    }

    #[test]
    fn pair_real_and_wish_terms() {
        let pair = serde_json::json!(["Music", "/data/Music"]);
        assert_eq!(real_of_pair(&pair), Some("/data/Music"));
        let raw = Some(serde_json::json!([
            {"term": "aphex", "auto": true},
            "plaid",
            "",
            "plaid"
        ]));
        assert_eq!(wishlist_of(&raw), vec!["aphex", "plaid"]);
    }
}
