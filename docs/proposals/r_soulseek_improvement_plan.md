# r/Soulseek → Nicotine Hub Improvement Plan — 2026-09-02 (moved to proposals 2026-09-03)

> **Status: PROPOSAL — partial.** Worker scaffold + scrape/spectrum/tag/verify/analyze landed in `5c65ea9` (record: `docs/architecture.md` `## Worker`); worker plan doc deleted. Unbuilt backlog below: share safety, ProveIt, wildcard bans, webhook, HoneyPot.
> **Decisions locked 2026-09-02:** scope **Full P0–P2** (P3 deferred), ProveIt `hash(user+week)` rotating.
> **Sources:** `r_soulseek_posts.jsonl` (4763) + `r_soulseek_comments.jsonl` (50604) in `~/projects/improvement_docs/`
> **Snapshot:** retrieved_on up to 2026, covers 2002–2026 nostalgia through TikTok + vibe-coded slop era.
> **Hub reference:** `apps/bridge` (`server.slsknet.org:2242` TCP, `ws://:8787/ws`, `/health`, `/files/:token`, volume `DATA_DIR`) + `apps/web` Next.js 15 PWA (`apps/web/src/lib/session.tsx`, `apps/bridge/src/session.ts:102`, `apps/bridge/src/soulseek.ts` `[uint32 len][uint32 code][payload]`) + **new `apps/worker`** (Python FastAPI — implement own code guided by `~/projects/smoked-salmon/src/salmon/sources/base.py:26` `BaseScraper` pattern, **do not import/copy smoked-salmon code**), parity `docs/porting-status.md:5`, `docs/settings-plan.md:12`, `apps/web/src/lib/config/defaults.ts:27`.

---

## 0. Summary

Reddit pain clusters on **quality**, **slop/leech automation**, **share safety**, **mobile bridging**, **workflow glue** — not SLSK plumbing (search/browse/chat/transfers ~1:1). With **Full P0–P2 + worker** locked, **7 in-scope + 3 doc-only + 4 skipped** (P3 deferred). Biggest wins: `P0 share safety` (leak), `P0 ProveIt hash(user+week)` (slop), and **offloading heavy lifting from bridge to worker** (keeps bridge `SLSK`-only per your “keep it clean”).

| Pri | Title | Effort | Where (after worker) | Evidence | Decision |
|---|---|---|---|---|---|
| **P0** | Share safety + per-path exclusions | 1 d | `apps/web Settings/Shares` + `apps/bridge shares.ts:384` | `1pwgmya 84/66`, `1lkxgp6 58/21`, `1hpq2vf 12/35` | **Build in bridge** |
| **P0** | ProveIt captcha `hash(user+week)` | 1–2 d | `apps/bridge plugins/builtin/proveIt.ts` | `1s232m7 26/9`, `1tglltw 16/27`, `1rzsds8 55/163` | **Build in bridge** |
| **P1** | Wildcard bans + slop badge | 0.5 d | `apps/bridge networkfilter.ts:70` | `1s8igsv 39/57`, `1oeg231 79/37`, `1ulos96 42/19` | **Bridge** |
| **P1** | Paste-link **scrape engine** (smoked-salmon style) | 1–2 d | **`apps/worker` FastAPI** `POST /scrape` | `1vzc2al 61/29`, `1fwli2j 176/24`, `1easrn6 86/21` | **Build in worker** (not client regex) |
| **P1** | Finished-download webhook (Plex/Navidrome) | 0.5 d | `apps/bridge transfers.ts:991` or `apps/worker` | `1iu68qz 23/30`, `1k9uk09 7/28` | **Bridge (or worker webhook)** |
| **P2** | Quality filter + badge | 1 d | `apps/web filter.ts` + `apps/worker POST /analyze` | `1p0iosj 36/43`, `1qgimqy 14/33`, `1t3r1sl 29/42`, `1ufawq3 112/83` | **Web + worker** |
| **P2** | HoneyPot bait | 0.25 d | `apps/bridge` | `1noys3w 0/33` | **Bridge** |
| **P3** | Soulchat notify (Gotify) | 0.5 d | `apps/worker POST /notify` or bridge | `1k8ke1z 48/10` | **Deferred** |

**Worker owns:** scrape, spectrum, tagging/verify, quality deep-check. **Bridge stays:** SLSK TCP/WS, transfers, bans, ProveIt, HoneyPot. **Web stays:** UI, but calls worker for heavy ops.

---

## 0.1 Worker architecture — extracted

**Big architectural change → worker landed in `5c65ea9`; record is `docs/architecture.md` (`## Worker`).**

Summary: separate Python FastAPI service `apps/worker:8789` (own code, guided by smoked-salmon `BaseScraper`/`spectrals.py` but **do not copy**) owns scrape/spectrum/tag/verify. Bridge stays `SLSK`-only (`apps/bridge/src/spectrum.ts:12` → worker, no `fetch()` egress). Worker endpoints `POST /scrape`, `POST /spectrum`, `POST /tag|verify|analyze`, `GET /health`, volumes `bridge-data:/data:ro` + `/tmp/hub-spectrum`. Full design + cleanup checklist in `worker_service_plan.md:0`.

---

## 1. Method

1. `python3 -c json.loads` → 4763 posts, 50604 comments indexed by `link_id`.
2. Scanned titles by `score`/`num_comments`, flagged `?` + keywords (`spotify discogs bandcamp playlist flac mp3 transcode tag metadata mobile …`), ~3064 candidates → ~300 hand-reads of `selftext[:1200]` + top-score comments.
3. Cross-checked vs `docs/porting-status.md:5` (15 domains, `leech_detector`, `spectrum` via `sox`, `wishlist`, `notifications`, `geoblock`, `PortMapper`), `README.md:38`, `docs/settings-mapping.md`.
4. Inspected `~/projects/smoked-salmon/src/salmon/sources/base.py:26` (`BaseScraper`, `get_json`/`fetch_page`, `IdentData`, `UAGENTS`), `discogs.py:14`/`apple_music.py:41`/`musicbrainz.py:9`/`qobuz.py:14`/`tidal.py:14`, `search/base.py:16`, `pyproject.toml:8` to size worker — **use as guide only, implement own code (do not copy/import smoked-salmon)** per updated requirement.

**Limits:** Pushshift-style dump, scores historical, TikTok viral overweight, English-only titles.

---

## 2. Already covered — skip (bridge stays SLSK)

- **Mobile PWA** `TopBar`/`BottomNav`/`manifest` → answers `1rkop84` iOS + `1svgi2d`.
- **Search filters** `filter.ts`/`filter.worker.ts` `WishlistInterval 104` → covers `1ahg6ry` 3.3.0 phrase searches.
- **Spectrum** `sox` Full 2000×513 + Zoom 500×1025 (`README.md:46`) currently in bridge — **will be moved to worker** (see §3.5/§8). Post-download badge stays, generation leaves bridge.
- **`leech_detector`** (`plugins/builtin/leech_detector.ts`) + `banlist` → base gating (`docs/porting-status.md:10`).
- **`LISTEN_PORT` + `PortMapper`** (`server.ts:185`) → covers `1inl4xu` port-forward (needs tooltip).
- **Interests** `interests/page.tsx:296` → covers `1e47j8g` discovery.

---

## 3. Opportunities — grouped, with evidence and lazy solution (worker-aware)

### 3.1 Share safety & per-item exclusion — P0 (stay in bridge)

**Posts:** `1pwgmya` 84/66, `1lkxgp6` 58/21, `1hpq2vf` 12/35. **Comments:** `1pwgmya:108`, `1hpq2vf:18` slskd `exclusions`, `1hpq2vf:25` “destroying structure”.

**Has:** `SharesSection.tsx:66` `virtual_name/folder/accessible_to` + `share_filters` regex + `ShareDB` `public/buddy/trusted` (`shares.ts:24`, `shares.ts:384`) + `check_shares_available` banner. No per-path exclude, no preview, no secret heuristic.

**Lazy:** add `transfers.exclusions` globs (slskd style) in `defaults.ts:27` → `shares.ts:scanFsShares` filter pass + **Preview modal** dry-run listing top 20 exposed files, banner on `\.env|id_rsa|*.key|wallet|.git`. Panel only.

```
→ skipped: rewriting Plex lib, per-file ACL DB
add when: per-user per-file ACL needed
```

**Files:** `apps/web/src/lib/config/defaults.ts:27`, `apps/web/src/components/settings/SharesSection.tsx:66`, `apps/bridge/src/shares.ts:125,364`, `apps/bridge/src/session.ts:1955`.

---

### 3.2 Anti-leech / anti-slop — P0+P1 (stay in bridge)

**Posts:** `1rzsds8` 55/163, `1s8igsv` 39/57 `aurral_*`, `1oeg231` 79/37 `generate_random_credentials: [A-Za-z0-9]{8}`, `1n4vhrz` 94/38, `1oevauz` 96/26, `1tipagj` 18/28, `1s232m7` 26/9 ProveIt, `1tglltw` 16/27, `1noys3w` 0/33 HoneyPot.

**Comments:** `1rzsds8:65` (slskd author) reputation, `1rzsds8:42` captcha word, `1rzsds8:20` `50 files/10 folders` slop signature (`1ulos96:19` batchdl artifact), `1tipagj:9` ProveIt, `1s232m7:3` “bans & messages”.

**Has:** `leech_detector` + `banlist` + `UploadsSection` limits. Missing: ProveIt per-user, wildcard, honeypot badge.

**Lazy (worker not needed, keep SLSK loop tight):**

- **ProveIt `hash(user+week)` (P0 locked):** `apps/bridge/src/plugins/builtin/proveIt.ts` (≈80 lines, copy `leech_detector.ts`). `shouldBlockUser` → if unverified, `UploadDenied 50` + `MessageUser 22` word `hash(username+ISOWeek)[0:6]` (`djb2`/`sha256`). `verified.json` `{user, week}` valid 4 weeks, then re-challenge. No globals.
- **Wildcard+slop badge (P1):** `banlist` glob `aurral_*` (`*`→`.*`) in `networkfilter.ts:70`, uploads `isSlopLike = pending.files<=60 && folders==10 && /^[A-Z0-9]{8,12}$/` badge.
- **HoneyPot (P2 in-scope):** `if (filename==="!banned.txt") ban(user)` opt-in off.

```
→ skipped: community blocklist sync, reputation, country ban
add when: slop still degrades throughput despite ProveIt
```

**Files:** `apps/bridge/src/plugins/builtin/leech_detector.ts`, `server.ts:591`, `networkfilter.ts:70`, `app/uploads/page.tsx`.

---

### 3.3 Paste-link scrape engine — P1 (extracted to worker)

**Extracted → `worker_service_plan.md:2` (`POST /scrape`).** Short: `1vzc2al` 61/29 Discogs link, `1fwli2j` 176/24 etc. → worker owns own scraper (guided by `BaseScraper` but not copied), `SearchBar.tsx:72` → `fetch(WORKER_URL/scrape)` → `search:global`. Bridge stays clean. See worker plan for endpoints + cleanup list.

---

### 3.4 Finished-download webhook — P1 (bridge or worker)

**Posts:** `1iu68qz` 23/30 (Synology vs QNAP), `1k9uk09` 7/28, `14ke746` 57/14, `1sfl7zs` 18/9 Feishin.

**Lazy:** `MEDIA_SCAN_URL` env + Settings Downloads webhook. On `TransferManager:Finished` (`transfers.ts:991`) `fetch(webhook,{method:"POST"})` 5 s fire-and-forget. Keep in bridge (simpler) or host in worker `POST /scan` that worker calls `fetch(MEDIA_SCAN_URL)` — either works; pick bridge to avoid worker dependency for trivial fetch.

```
→ skipped: DLNA server, Symfonium inside Hub
```

**Files:** `apps/bridge/src/transfers.ts:904`, `apps/web/src/components/settings/DownloadsSection.tsx:7`.

---

### 3.5 Spectrum — P2 heavy → migrate to worker (extracted)

**Extracted → `worker_service_plan.md:2` (`POST /spectrum`).** Short: `1p0iosj`/`1ufawq3` etc. → worker owns own `sox` Full 2000×513 + Zoom (`spectrum.ts:12` → worker), bridge strips `sox`/`oxipng`, web `bridgeHttpBase()` → `workerHttpBase()`. See worker plan for full file removals + `sox` wrapper details.

---

### 3.6 Tag / verify / analyze — future worker extensions (extracted)

**Extracted → `worker_service_plan.md:2` (`POST /tag|verify|analyze`).** Short: `1e6jn8g` etc. → worker `POST /tag`/`verify`/`analyze` own impl. See worker plan.

---

### 3.7 Chat & hygiene / Ports — doc only

**Posts:** `174k0lo` 58/45, `1uorx5x` 41/68, `xruu6v` 22/45, `1j75kil` 11/124, `1tl51ht` 16/27, `1inl4xu` 1/63 Nord, `1e5hw0f` 168/83 TikTok.

**Note:** `geoblock`/`ignorelist` wired (`BannedUsersSection`, `chatFormat.ts`). `PortChecker` + `StatisticsPanel` keep tooltip. No code in worker.

---

### 3.8 Notifications — P3 deferred

**Posts:** `1k8ke1z` 48/10 Soulchat. **Lazy:** `NOTIFY_URL` webhook on `MessageUser 22` when WS backgrounded. Host in bridge (simpler) or worker `POST /notify` — same defer.

---

## 4. Prioritized implementation order — Full P0–P2 + worker

| Phase | Scope | Verify |
|---|---|---|
| **0 — Worker scaffold** | **Extracted to `worker_service_plan.md:4` Phase 0** — `apps/worker/` FastAPI own impl (do not copy) + `POST /scrape` + `GET /health` + `compose.yaml` worker:8789 | See worker plan `worker_service_plan.md:4` for verify `curl /health?json` |
| **A — Share safety (P0)** | `defaults.transfers.exclusions[]` + `SharesSection` preview modal + `shares.ts:scanFsShares` exclude | `/tmp` with `.env`, preview warns; `bun test && bun run build` |
| **B — ProveIt `hash(user+week)` (P0)** | `apps/bridge/src/plugins/builtin/proveIt.ts`, `verified.json` 4-week TTL, `server.ts:591` bypass | Unverified → `UploadDenied 50`+PM `abc123`; correct word → success; week rolls |
| **C — Wildcard+slop badge (P1)** | `networkfilter.ts` glob, `uploads/page.tsx` badge `slop-like` | `aurral_*` blocks, `50/1000`+`[A-Z0-9]{8}` badge |
| **D — Scrape engine (P1)** | **Extracted to `worker_service_plan.md:2` `POST /scrape`** | See worker plan |
| **E — Webhook (P1)** | `MEDIA_SCAN_URL` in `transfers.ts:991` | Finish → `docker logs bridge` shows `POST` |
| **F — Migrate spectrum (P2)** | **Extracted to `worker_service_plan.md:2` `POST /spectrum`** | See worker plan |
| **G — Tag/verify (P2 opt)** | **Extracted to `worker_service_plan.md:2` `POST /tag|verify`** | See worker plan |
| **H — HoneyPot (P2)** | `honeyPot.ts` plugin | `!banned.txt` → ban |

Deferred P3: `POST /notify` in worker or bridge. **Worker tasks: see `worker_service_plan.md:4` for full Phase 0/F/G.**

Each phase: git worktree → `bun test && bun run build` → `docker compose up --build` (worker when needed) → `curl -sf http://localhost:8788/health` + `curl -sf http://localhost:8789/health` + `cp apps/web/.env.example apps/web/.env`. After build: `cp ~/projects/improvement_docs/r_soulseek_improvement_plan.md docs/improvements/r_soulseek_improvement_plan.md && cp ~/projects/improvement_docs/../nicotine_mobile/docs/improvements/worker_service_plan.md docs/improvements/worker_service_plan.md`.

---

## 5. Code to remove / move to worker — extracted

**Full cleanup checklist → `worker_service_plan.md:3`.** Summary: delete `apps/bridge/src/spectrum.ts:1` (334 lines), `spectrum.test.ts:4`, `server.ts:192`/`720`/`1509` spectrum handlers, `transfers.ts:1489`, `Dockerfile:62` `sox` apk → worker `spectrals.py` own + `GET /spectrum`; delete `apps/web/src/lib/linkParser.ts` → worker `sources/*.py` own; update `apps/web/src/lib/spectrum.tsx:32` `bridgeHttpBase()` → `workerHttpBase()`. See worker plan for complete table. Net ~400 lines deleted from bridge, new worker service, `docs/architecture.md#worker` added (see §7 below).

---

## 6. Intentionally not building

- **Full Spotify→Soulseek sync / Lidarr shim** `1mdaobf`/`1tnbh45` 15k lines — separate `SoulSync`/`Crate` containers; DMCA per `1q0p0p0:4`.
- **Community blocklist auto-sync** `1tipagj:25` — mutable usernames, abuse.
- **Native iOS** `1rkop84` — PWA+webhook sufficient.
- **Rebuilding `beets`/`Picard` in web** `1e6jn8g`/`1ig5rh9` — use `worker POST /tag` or external `beets`.
- **YT-rip → FLAC** — warn via `POST /analyze` badge.
- **Server-side fetch in bridge** — now in worker; bridge never `fetch()`s external URLs after F.

---

## 7. Decisions locked 2026-09-02

1. **Scope Full P0–P2** — A–H above; **P3 Soulchat deferred**.
2. **ProveIt `hash(user+week)`** — `hex(hash(user+ISOWeek))[0:6]`, 4-week TTL, per `1s232m7:4`.
3. **Scrape engine in worker** — `apps/worker POST /scrape` **own implementation guided by** `src/salmon/sources/*.py:14` `BaseScraper` pattern (do not copy/import smoked-salmon); no bridge `fetch`, no client `linkParser.ts` regex (too weak per your correction).
4. **Spectrum migrated to worker** — own reimplementation guided by `src/salmon/uploader/spectrals.py` (not copied), bridge strips `sox`/`ffmpeg`/`oxipng`, web points at worker. Bridge stays SLSK-only per your “keep it clean”.
5. **Tag/verify in worker when added** — no new JS libs in web/bridge.
6. **Exclusions = glob** `**/node_modules/**` via `*`→`.*`; `share_filters` stays regex.
7. **Doc location** `docs/proposals/r_soulseek_improvement_plan.md`.

Minor: `MEDIA_SCAN_URL` → `MEDIA_SCAN_TOKEN` Bearer if needed; `WORKER_TOKEN` env for web→worker.

---

## 8. Appendix — candidate posts inspected

`1mdaobf 129/77 SoulSync`, `1q0p0p0 33/29 v1.2`, `1fwli2j 176/24 Spotify Webclient`, `1ufawq3 112/83 fake lossless`, `1tnbh45 5/35 lidarr`, `1rzsds8 55/163 slop rising`, `1s8igsv 39/57 Aurral`, `1oeg231 79/37 Sonosano`, `1rkop84 35/34 iOS`, `1vzc2al 61/29 Mac Discogs`, `1easrn6 86/21 guide`, `1jov01f 12/56 fake`, `1t3r1sl 29/42 tell FLAC`, `1w30obn 42/37 fake flacs`, `1k1vno7 22/30 auto block`, `1tgzmcv 49/68 restrict`, `1pwgmya 84/66 Be careful`, `1hpq2vf 12/35 block album`, `1iu68qz 23/30 NAS`, `1k8ke1z 48/10 Soulchat`, `1s232m7 26/9 ProveIt`, `1noys3w 0/33 HoneyPot`, `1tipagj 18/28 blocklist`, `1nbmiuw 19/85 rant`, `1ig5rh9 10/27 covers`, `1e6jn8g 5/29 tag`, `1isokob 24/77 locked`, `1e5hw0f 168/83 TikTok`, `1inl4xu 1/63 VPN`, `1p0iosj 36/43 128k`, `1qgimqy 14/33 v0>320`, `1qyw4jy 43/25 updates`, `1middul 48/10 Soulify`, `1lkxgp6 58/21 TIFU`, `1k9uk09 7/28 iPhone`, `1tl51ht 16/27 countries`. Dismissed memes: `1qzw7lm 122/25`, `1huf13o 135/60`, `1f2atj1 89/65`, `z3wf4i`, `1dotccj`.

---

*Next: start Phase 0 worker scaffold — `git worktree add ../nicotine_mobile-feat_worker -b feat/worker stage && mkdir -p apps/worker && implement apps/worker/sources/base.py + per-source scrapers from scratch guided by ~/projects/smoked-salmon/src/salmon/sources/base.py:26 (do not copy) && rm apps/bridge/src/spectrum.ts && rm apps/bridge/Dockerfile:62 apk line && cp ~/projects/improvement_docs/r_soulseek_improvement_plan.md docs/improvements/r_soulseek_improvement_plan.md` per AGENTS.md:worktree ports.*
