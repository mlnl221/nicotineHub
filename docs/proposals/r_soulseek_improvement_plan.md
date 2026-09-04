# r/Soulseek → Nicotine Hub Improvement Plan — 2026-09-02 (moved to proposals 2026-09-03)

> **Status: PROPOSAL — partial.** Worker scaffold + scrape/spectrum/tag/verify/analyze landed in `5c65ea9` + **share safety (exclusions + preview + secret heuristic) landed in `feat/share-safety`** + **P1 wildcard bans + slop badge + worker webhook landed in `feat/share-safety` (second push)** (record: `docs/architecture.md` `## Worker` + `apps/bridge/src/networkfilter.ts:34` + `apps/worker/app.py:754` + `apps/web/src/components/settings/WorkerSection.tsx`); worker plan doc deleted. Unbuilt backlog: **B ProveIt, H HoneyPot** (A, C, E DONE; D,F,G DONE).
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

## 0.1 Worker architecture — landed in `5c65ea9`

**Big architectural change → worker landed in `5c65ea9`; record is `docs/architecture.md` `## Worker` + `docs/spectrum.md`. Worker plan doc deleted (was `worker_service_plan.md`).**

Summary: separate Python FastAPI service `apps/worker:8789` (own code, guided by smoked-salmon `BaseScraper`/`spectrals.py` but **do not copy**) owns scrape/spectrum/tag/verify. Bridge stays `SLSK`-only (`apps/bridge/src/spectrum.ts:12` → worker, no `fetch()` egress). Worker endpoints `POST /scrape`, `POST /spectrum`, `POST /tag|verify|analyze`, `GET /health`, volumes `bridge-data:/data:ro` + ephemeral `/tmp/spectrals`. See `docs/architecture.md` `## Worker` for full endpoints + shared volumes.

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
- **Spectrum** `sox` Full 2000×513 + Zoom 500×1025 — **migrated to worker `apps/worker/spectrals.py` in `5c65ea9`** (see `## Worker` + `docs/spectrum.md`). Post-download badge stays via `workerHttpBase()`, generation left bridge (410 stubs remain).
- **`leech_detector`** (`plugins/builtin/leech_detector.ts`) + `banlist` → base gating (`docs/porting-status.md:10`).
- **`LISTEN_PORT` + `PortMapper`** (`server.ts:185`) → covers `1inl4xu` port-forward (needs tooltip).
- **Interests** `interests/page.tsx:296` → covers `1e47j8g` discovery.

---

## 3. Opportunities — grouped, with evidence and lazy solution (worker-aware)

### 3.1 Share safety & per-item exclusion — P0 (DONE in `feat/share-safety`)

**Posts:** `1pwgmya` 84/66, `1lkxgp6` 58/21, `1hpq2vf` 12/35. **Comments:** `1pwgmya:108`, `1hpq2vf:18` slskd `exclusions`, `1hpq2vf:25` “destroying structure”.

**DONE `feat/share-safety`:** `transfers.exclusions[]` (`defaults.ts:98` + `sync.tsx:25`) → `shares.ts:59` `exclusions` + `compileExclusions()` reused `*`→`.*` glob, `walkDir:567`/`walkDirAsync:630` + single-file guards + `server.ts:1386` `key==="exclusions"` + `session.ts:488` shim, **Preview** throwaway `previewWithExclusions()` (`shares:preview` → `shares:preview:result` `{counts, sample[20], excludedCount, secretHits}`) + **Secret heuristic** `isSecretFile()` (`.env|id_rsa|*.pem|*.key|wallet*|.git`) banner in `SharesSection.tsx` + `Rescan` `secretHits` (20). Panel only — skipped per-file ACL DB (add when per-user per-file ACL needed). `shares.json:exclusions` persisted (500 cap).

**Files:** `apps/web/src/lib/config/defaults.ts:98`, `apps/web/src/components/settings/SharesSection.tsx:733`, `apps/bridge/src/shares.ts:59,191,567,630,681`, `apps/bridge/src/session.ts:488`, `apps/bridge/src/server.ts:1343,1386`.

---

### 3.2 Anti-leech / anti-slop — P0+P1 (P1 wildcard+slop DONE in `feat/share-safety`)

**Posts:** `1rzsds8` 55/163, `1s8igsv` 39/57 `aurral_*`, `1oeg231` 79/37 `generate_random_credentials: [A-Za-z0-9]{8}`, `1n4vhrz` 94/38, `1oevauz` 96/26, `1tipagj` 18/28, `1s232m7` 26/9 ProveIt, `1tglltw` 16/27, `1noys3w` 0/33 HoneyPot.

**Comments:** `1rzsds8:65` (slskd author) reputation, `1rzsds8:42` captcha word, `1rzsds8:20` `50 files/10 folders` slop signature (`1ulos96:19` batchdl artifact), `1tipagj:9` ProveIt, `1s232m7:3` “bans & messages”.

**Has:** `leech_detector` + `banlist` + `UploadsSection` limits. **P1 DONE:** `isUserBanned` now glob `*`/`?` case-sensitive (`networkfilter.ts:34`) + `TransferManager` queue aggregate `isSlopLike` (`transfers.ts:236`) + `TransferCard` pill (`TransferCard.tsx:90`).

**Lazy (worker not needed, keep SLSK loop tight):**

- **ProveIt `hash(user+week)` (P0 locked):** `apps/bridge/src/plugins/builtin/proveIt.ts` (≈80 lines, copy `leech_detector.ts`). `shouldBlockUser` → if unverified, `UploadDenied 50` + `MessageUser 22` word `hash(username+ISOWeek)[0:6]` (`djb2`/`sha256`). `verified.json` `{user, week}` valid 4 weeks, then re-challenge. No globals. **Still OPEN (B).**
- **Wildcard+slop badge (P1 DONE):** `banlist` glob `aurral_*` (`*`→`.*`) in `networkfilter.ts:34`, uploads `isSlopLike = queued.files<=60 && folders==10 && /^[A-Z0-9]{8,12}$/` badge (`TransferCard.tsx:90`).
- **HoneyPot (P2 in-scope):** `if (filename==="!banned.txt") ban(user)` opt-in off. **Still OPEN (H).**

```
→ skipped: community blocklist sync, reputation, country ban
add when: slop still degrades throughput despite ProveIt
```

**Files:** `apps/bridge/src/plugins/builtin/leech_detector.ts`, `server.ts:591`, `networkfilter.ts:34`, `app/uploads/page.tsx`, `transfers.ts:236`, `protocol.ts:218`.

---

### 3.3 Paste-link scrape engine — P1 (DONE in worker, `5c65ea9`)

**DONE → `apps/worker` `POST /scrape` (8 sources: discogs/bandcamp/apple/qobuz/tidal/musicbrainz/deezer/beatport) + `apps/web/src/lib/worker.ts:58` + `SearchBar.tsx:53`.** Short: `1vzc2al` 61/29 Discogs link, `1fwli2j` 176/24 etc. → worker owns own scraper (guided by `BaseScraper` but not copied), `SearchBar.tsx:53` → `workerFetch(/scrape)` → `search:global`. Bridge stays clean (no `fetch()` egress). `linkParser.ts` deleted. See `docs/architecture.md` `## Worker` for endpoint + SSRF/UA.

---

### 3.4 Finished-download webhook — P1 (DONE via worker `POST /scan` in `feat/share-safety`)

**Posts:** `1iu68qz` 23/30 (Synology vs QNAP), `1k9uk09` 7/28, `14ke746` 57/14, `1sfl7zs` 18/9 Feishin.

**DONE `feat/share-safety`:** worker `POST /scan` (`apps/worker/app.py:754` `ScanIn` + `tokens.py:media_scan_url` 0600) validates `http(s)` + no creds, forwards `{event:"download.finished",eventType:"Download",fileName,size,username,virtualPath,destinationPath,transferId,downloadUrl}` to `MEDIA_SCAN_URL` with `Bearer <MEDIA_SCAN_TOKEN>` (5 s timeout, fire-and-forget). Web `transfers.tsx:201` `transfer:finished`/`transfer:update Finished` → `workerFetch("/scan")` (tab-open only, bridge stays SLSK-only). Settings → Worker → Media automation card (`WorkerSection.tsx:135`). Bridge `server.ts:1528` now accepts `media_scan_url`/`media_scan_token` (≤2048 chars, `http(s)` check) into `worker.json`.

```
→ skipped: DLNA server, Symfonium inside Hub (worker webhook covers Plex/Navidrome/n8n)
```

**Files:** `apps/worker/app.py:754`, `apps/worker/tokens.py:17`, `apps/bridge/src/server.ts:1528`, `apps/web/src/lib/transfers.tsx:201`, `apps/web/src/components/settings/WorkerSection.tsx:135`.

---

### 3.5 Spectrum — P2 heavy → migrated to worker (DONE, `5c65ea9`)

**DONE → `apps/worker` `POST /spectrum/request` + `GET /spectrum/{stem}/full|zoom` (`spectrals.py` `sox` Full 2000×513 + Zoom 500×1025, `ffmpeg` transcode, `oxipng` best-effort) + `apps/web/src/lib/spectrum.tsx` → `workerHttpBase()`.** Short: `1p0iosj`/`1ufawq3` etc. → worker owns `sox`; bridge `spectrum.ts` deleted, `Dockerfile:63` stripped `sox`, `server.ts` now 410 `moved to worker`, web `bridgeHttpBase()` → `workerHttpBase()`. See `docs/architecture.md` `## Worker` + `docs/spectrum.md`.

---

### 3.6 Tag / verify / analyze — landed in worker (`5c65ea9`, honest subset)

**DONE (subset) → `apps/worker` `POST /tag|/tag/write|/tag/scrape|/tag/bulk` + `POST /verify|/verify/bulk` + `POST /analyze|/analyze/bulk` (`mutagen`/`ffmpeg` FFT knee, `numpy` when present).** Short: `1e6jn8g` etc. → worker owns tag/verify/analyze; `POST /verify` currently returns `{flacOk, upconvert, mqa, logScore, logChecksum, durationMismatch}` with `upconvert/logScore/logChecksum/durationMismatch = null` until spectral checks land (only `flacOk` + MQA sniff honest today); `POST /analyze` returns `cutoffHz/likelyTranscode` via 30s `ffmpeg→wav` + FFT when `numpy` present else `null`. See `docs/architecture.md` `## Worker`.

---

### 3.7 Chat & hygiene / Ports — doc only

**Posts:** `174k0lo` 58/45, `1uorx5x` 41/68, `xruu6v` 22/45, `1j75kil` 11/124, `1tl51ht` 16/27, `1inl4xu` 1/63 Nord, `1e5hw0f` 168/83 TikTok.

**Note:** `geoblock`/`ignorelist` wired (`BannedUsersSection`, `chatFormat.ts`). `PortChecker` + `StatisticsPanel` keep tooltip. No code in worker.

---

### 3.8 Notifications — P3 deferred

**Posts:** `1k8ke1z` 48/10 Soulchat. **Lazy:** `NOTIFY_URL` webhook on `MessageUser 22` when WS backgrounded. Host in bridge (simpler) or worker `POST /notify` — same defer.

---

## 4. Prioritized implementation order — Full P0–P2 + worker (updated 2026-09-03: 0/D/F/G landed)

| Phase | Scope | Status | Verify |
|---|---|---|---|
| **0 — Worker scaffold** | `apps/worker/` FastAPI own impl (do not copy) + `POST /scrape` (8 sources) + `GET /health` + `compose.yaml` `worker:8789` | **DONE `5c65ea9`** — `docs/architecture.md` `## Worker` | `curl -sf http://localhost:8789/health \| jq .sources` → 8 sources |
| **A — Share safety (P0)** | `defaults.transfers.exclusions[]` + `SharesSection` preview modal + `shares.ts:scanFsShares` exclude (`\.env\|id_rsa\|*.key\|wallet\|.git` banner) | **DONE `feat/share-safety`** — `shares.ts:59` + `sync.tsx:25` + `server.ts:1343` preview + `SharesSection.tsx:733` | `/tmp` with `.env` → preview `secretHits`, `bun test` 116 pass + `bun run build` + Playwright `Settings→Shares` → `Excluded paths` + `Preview` modal |
| **B — ProveIt `hash(user+week)` (P0)** | `apps/bridge/src/plugins/builtin/proveIt.ts`, `verified.json` 4-week TTL, `server.ts:591` bypass | **OPEN** | Unverified → `UploadDenied 50`+PM `abc123`; correct word → success; week rolls |
| **C — Wildcard+slop badge (P1)** | `networkfilter.ts` glob (`*`→`.*` user glob; IP `*` already) + `transfers.ts` `isSlopLike` + `TransferCard` pill | **DONE `feat/share-safety`** — `networkfilter.ts:34` + `transfers.ts:236` + `protocol.ts:218` | `aurral_*` blocks (case-sensitive), `50/60`+10 folders+`[A-Z0-9]{8,12}` → `Slop-like` badge in Uploads |
| **D — Scrape engine (P1)** | `apps/worker` `POST /scrape` + web `SearchBar→workerFetch` + delete `linkParser.ts` | **DONE `5c65ea9`** — `docs/architecture.md` `## Worker` | Paste Discogs URL in global search → `scrapeRelease` → `query` |
| **E — Webhook (P1)** | `worker POST /scan` (was `MEDIA_SCAN_URL` in `transfers.ts:991`) | **DONE `feat/share-safety`** — `worker/app.py:754` + `WorkerSection` Media automation + `transfers.tsx:201` relay | Finish (tab open) → worker forwards POST (5s, Bearer), `curl /scan` → `media_scan:true` |
| **F — Migrate spectrum (P2)** | `apps/worker` `POST /spectrum/request` + `GET /spectrum/{stem}/full\|zoom` + web `workerHttpBase()` | **DONE `5c65ea9`** — `docs/architecture.md` `## Worker` + `docs/spectrum.md` | Finished flac → `Analyze Spectrum` → Full+Zoom PNGs, `curl -I .../full` 304 |
| **G — Tag/verify/analyze (P2 opt)** | `apps/worker` `POST /tag|verify|analyze` (+ bulk/write/scrape) | **DONE (subset) `5c65ea9`** — `docs/architecture.md` `## Worker` | `curl -X POST :8789/verify` → `flacOk` honest; rest `null` until spectral checks |
| **H — HoneyPot (P2)** | `honeyPot.ts` plugin `!banned.txt → ban` | **OPEN** | `!banned.txt` → ban |

Deferred P3: `POST /notify` in worker or bridge (still deferred — no code). Unbuilt backlog: **B, H** (A, C, D, E, F, G DONE).

Each phase: git worktree → `bun test && bun run build` → `docker compose up --build` (worker when needed) → `curl -sf http://localhost:8789/health \| jq` + `cp apps/web/.env.example apps/web/.env`. Doc sync after build: `cp docs/proposals/r_soulseek_improvement_plan.md ~/projects/improvement_docs/r_soulseek_improvement_plan.md`.

---

## 5. Code to remove / move to worker — DONE in `5c65ea9`

**Cleanup landed — record `docs/architecture.md` `## Worker` + `docs/spectrum.md`.** Deleted `apps/bridge/src/spectrum.ts:1` (334 lines), `spectrum.test.ts:4`, `server.ts:192`/`720`/`1509` spectrum handlers (now 410 `moved to worker`), `transfers.ts:1489` synth stub trimmed, `Dockerfile:62` `sox` apk (`sox/flac/ffmpeg` → `apps/worker/Dockerfile` `python:3.11-slim` + `spectrals.py` own); deleted `apps/web/src/lib/linkParser.ts` → `apps/worker/sources/*.py` own (8 sources); updated `apps/web/src/lib/spectrum.tsx:32` `bridgeHttpBase()` → `workerHttpBase()` via `apps/web/src/lib/worker.ts`. Net ~400 lines deleted from bridge, new worker service, `docs/architecture.md` `## Worker` added.

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

*Next (unbuilt P0–P2): **A DONE, C DONE, E DONE** `feat/share-safety` → **B ProveIt** `proveIt.ts` `hash(user+week)` → **H HoneyPot** `!banned.txt`. Worker (0/D/F/G) already landed in `5c65ea9`; see `docs/architecture.md` `## Worker`.*

(End of file - total 205 lines)
