<h1 align="center">Nicotine Hub</h1>

<p align="center">
  <img src="apps/web/public/icon-512.png" alt="Nicotine Hub logo" width="140" height="140" />
</p>

<p align="center">
  <a href="AI-DECLARATION.md"><img src="https://img.shields.io/badge/䷼%20AI--DECLARATION-pair-ffedd5?labelColor=ffedd5" alt="AI-DECLARATION: pair" /></a>
</p>

<p align="center">
  A <strong>mobile-first</strong> web client for the <a href="https://www.slsknet.org/">Soulseek</a> network.<br/>
  <em>This port is built predominantly with AI assistance under human review — see <a href="AI-DECLARATION.md">AI-DECLARATION.md</a>.</em>
</p>

## Demo

<p align="center">
  <strong>Try before you install → <a href="https://nicotine-hub-web-phi.vercel.app/">https://nicotine-hub-web-phi.vercel.app/</a></strong><br/>
  No bridge required. Enter any username/password to explore search, chat, profiles &amp; browse with mocked data.<br/>
  <em>Downloads/uploads are disabled in the demo.</em>
</p>

This is an almost 1:1 port of the [nicotine-plus](https://nicotine-plus.org/) project ([GitHub](https://github.com/nicotine-plus/nicotine-plus)) to a modern Next.js web app that is mobile friendly. Built on the protocol from [Nicotine+](https://github.com/nicotine-plus/nicotine-plus) (`doc/SLSKPROTOCOL.md`).

```
[ Browser (Next.js PWA) ] --WS JSON--> [ Bun bridge :8787 ] --TCP--> server.slsknet.org:2242
                                                         --P2P--> peers
```

The browser can't open raw TCP sockets, so the bridge translates JSON over WebSocket to Soulseek binary framing. See `docs/architecture.md` for protocol details.

> **Security:** Soulseek sends passwords in plaintext. The app never stores them — use credentials you trust.

---

## Features

- **Search** — global, user, room, wishlist & buddies; tabs + filters (size/bitrate/length/type/slot)
- **Transfers** — queue, resume (`INCOMPLETE<md5>`), `GET /files/:token`, throttled streaming
- **Browse** — shares & folders via peers
- **Chat** — rooms + private, tickers, owned/member lists
- **Social** — buddies, interests/recommendations/similar users
- **Profiles** — description, picture, stats, privileges
- **Mobile shell** — `TopBar`/`BottomNav`, safe-area, PWA, diagnostics live tail

---

## Repo layout

```
apps/bridge  — Bun bridge  (WebSocket `/ws` + `/health` + `/files/:token`)
apps/web     — Next.js 15 PWA
compose.yaml — web:3000 + bridge:8787/2234 → bridge-data:/data
```

---

## Quick start

```bash
bun install
bun run dev              # bridge + web
# or separately
bun run --cwd apps/bridge dev   # ws://localhost:8787/ws
bun run --cwd apps/web dev      # http://localhost:3000

bun test        # unit tests
bun run build   # prod builds
docker compose up --build  # http://localhost:3000 (build from source)
```

### Docker (GHCR — no build required)

Images are published to GHCR on every `main` push and on version tags (`v*.*.*`). Both services are versioned together and shipped via one `compose.yaml`.

```bash
# latest (default)
docker compose pull
docker compose up -d
# http://localhost:3000 + bridge ws://localhost:8787/ws

# pinned release — both services locked to the same version
TAG=v0.2.0 docker compose pull
TAG=v0.2.0 docker compose up -d

# pinned commit (per-build reproducibility)
TAG=sha-abc1234 docker compose pull
TAG=sha-abc1234 docker compose up -d
```

Images:

- `ghcr.io/mlnl221/nicotinehub-bridge` — Bun bridge (`:latest`, `:sha-<short>`, `:<semver>` e.g. `:0.2.0`, `:0.2`, `:0`)
- `ghcr.io/mlnl221/nicotinehub-web` — Next.js PWA (same tags)

Manual pulls:

```bash
docker pull ghcr.io/mlnl221/nicotinehub-bridge:latest
docker pull ghcr.io/mlnl221/nicotinehub-web:latest
docker pull ghcr.io/mlnl221/nicotinehub-bridge:0.2.0
```

> First publish requires making each GHCR package **Public** (GitHub → Packages → Settings → Change visibility) so `docker pull` works without `docker login ghcr.io`.

### Branching & promotion

Default branch is **`stage`**. All feature PRs target `stage`.

```
feature/*  →  stage  (PR, dry-run docker build)  →  main  (promotion, builds & pushes GHCR)
```

- **Feature → stage:** open PR against `stage`. CI runs `docker.yml` as dry-run (`push: false`) for both images (`linux/amd64,linux/arm64`, `cache: gha`) — validates Dockerfiles without pushing. Merge to `stage` does **not** publish images.
- **Stage → main:** promotion only. Either:
  - **Scheduled:** `.github/workflows/promote.yml` runs `cron: 0 2 * * 1` (Mondays 02:00 UTC) and via `workflow_dispatch` — if `stage` is ahead of `main` and no open `stage→main` PR exists, it auto-creates `chore: promote stage → main`.
  - **Manual:** `gh pr create --base main --head stage --title "chore: promote stage → main"` or via GitHub UI (base `main`, compare `stage`).

  Merging the promotion PR (push to `main`) triggers GHCR publish: `ghcr.io/mlnl221/nicotinehub-bridge|web:latest` + `sha-<short>` and on `v*.*.*` tags `0.2.0`/`0.2`/`0` + `latest` + `sha-`. Both services are versioned together; `compose.yaml` pins them via `${TAG:-latest}`.

```bash
# contributor flow
git checkout -b feat/my-change
git push -u origin feat/my-change
gh pr create --base stage --title "feat: ..."   # targets stage

# weekly promotion (auto or manual)
gh workflow run promote.yml                      # or wait for Monday schedule
# then merge the auto-created stage→main PR on GitHub
```

> Tags `v*.*.*` should be cut from `main` after promotion (e.g. `git tag v0.2.0 && git push origin v0.2.0`).
```

Bridge URL: `NEXT_PUBLIC_BRIDGE_URL` (build) or `localStorage.nicotine.bridgeUrl` (runtime).

| Env | Default | Purpose |
|-----|---------|---------|
| `BRIDGE_TOKEN` | *(open)* | Token auth for `/ws` |
| `DATA_DIR` | `/data` | Volume for downloads / incomplete |
| `LISTEN_PORT` | `2234` | Peer listener (port-forward) |

See `docs/architecture.md` for `SHARED_DIRS`, `UPLOAD_LIMIT`, `DISTRIB` etc.

---

## Legal and Acknowledgements

**License:** [`GPL-3.0-or-later`](./COPYING) (`LICENSES/GPL-3.0-or-later.txt`).
© 2001–2026 Nicotine+, Nicotine and PySoulSeek Contributors; © 2025–2026 nicotine-mobile Contributors.

This project is a **1:1 TypeScript port** of [Nicotine+](https://github.com/nicotine-plus/nicotine-plus)
— especially `pynicotine/slskmessages.py` + `slskproto.py`, `transfers.py`, `shares.py`,
`pluginsystem.py` and `doc/SLSKPROTOCOL.md` — used under `GPL-3.0-or-later` with huge thanks
to the Nicotine+ team (`AUTHORS.md`). See [`ATTRIBUTION.md`](./ATTRIBUTION.md) for the full
file-by-file mapping and upstream commit `8d81e66`.

**Soulseek:** The Soulseek network and `server.slsknet.org` are operated by Soulseek
volunteers and are **not affiliated** with this project or Nicotine+. Trademark “Soulseek”
belongs to its owners (nominative fair use). By connecting you agree to the Soulseek
[rules](https://www.slsknet.org/news/node/681) and [Terms of Service](https://www.slsknet.org/news/node/682).
Soulseek is unencrypted; see Security above.

---

## Porting status — vs [nicotine-plus](https://nicotine-plus.org/) `3.3.x` / `doc/SLSKPROTOCOL.md`

> Stage `0075d93` — almost 1:1, mobile-friendly. Desktop-only bits are intentionally omitted. See `docs/settings-mapping.md` for the authoritative settings map.

| Domain | Ported (done) | Partial / stub | Missing / intentional omit |
|---|---|---|---|
| **Network / Distributed** | Login `1` + `SetWaitPort 2` + `SharedFoldersFiles 35`, `ConnectToPeer 18` direct+relay race 45s, `MAX_SOCKETS 512` queue, `ServerPing` fallback, `ReLogged 41` | Distributed leaf → branch: `HaveNoParent 71` 4-msg bootstrap, `PossibleParents 102` 10 dials, `_adoptParent` on `DistribSearch 3`, `BranchLevel 126/Distrib 4` +1 + server notify, `BranchRoot 127/5`, `EmbeddedMessage 93` server-parent, `AcceptChildren 100` toggle via `uploadSpeed`/`ParentMinSpeed 83`/`Ratio 84` — still leaf-first, child limit `min(speed//ratio//100,10)` | `PortMapper` NAT-PMP/UPnP `pynicotine/portmapper.py`, `RelatedSearch 153`, `ChildDepth 7/129` obsolete, `MAX_SOCKETS` hard cap vs `2048` dynamic |
| **Search** | Global `FileSearch 26`, `UserSearch 42`, `RoomSearch 120`, `WishlistSearch 103` manual; `FileSearchResponse 9` zlib 16M/128M + >2GiB sentinel, `ExcludedSearchPhrases 160`; filters `include/exclude/size/bitrate/length/type/slot` via `filter.ts` + `filter.worker.ts` | `WishlistInterval 104` auto 12m/2m timer + `ActiveSearch` routing via `onWishlistEvent` → `search:result` (needs UI tab for `wishlist:*`), `country` filter now `matchCountry` via `SearchRow.country` + `getCountryCode` bisect but `SearchRow.country` lazy after `GetPeerAddress` | `RoomSearch` scoped to joined rooms only, grouped `user_grouping` expand/collapse, `SearchFilterHelp` popover `preferences.py:2903` |
| **Transfers — Downloads** | `QueueUpload 43` + `TransferRequest 40 dir1` + `PlaceInQueueRequest 51` 300s poll + `PlaceInQueueResponse 44`, resume `INCOMPLETE<md5>+basename` `ab+`, `FileOffset 8` + throttle `DOWNLOAD_LIMIT` adaptive, `Finished → GET /files/:token`, `Filtered` via `downloadfilters`, `autoclear`/`usernamesubfolders` | `FileOffset -1` `0xFFFFFFFFFFFFFFFF` clamp for >2GiB NS bug, legacy `TransferRequest 0` → `handleQueueUpload` for slskd interop, `geoblock` re-check after `GetPeerAddress` via `handlePeerAddressResolved` | `afterfinish/afterfolder` shell, `groupdownloads` view grouping |
| **Transfers — Uploads** | `UploadDenied 50`/`Failed 46` + `Queued` with `banlist/ipblocklist/geoblock` `networkfilter.ts`, `filelimit 100`/`queuelimit 10000` + `friendsnolimits`, `FIFO` vs `RoundRobin` + `preferfriends` privileged/buddy, `SendUploadSpeed 121` | `shouldBlockUser` now uses bisect `getCountryCode` but `peerIp=""` at `QueueUpload` time defers `geoblock` to `peer-address` re-check (best-effort) | `Pending shutdown` graceful, `reveal_buddy_shares` rate-limit |
| **Shares** | `ShareDB` `shared/buddyshared/trustedshared` + `share_filters` (`.*`, `Thumbs.db`, `#recycle\` trailing `\`), `scanFsShares` + `scanFsSharesAsync` via `music-metadata` attrs `0/1/4/5`, `buildSharedFileListResponse 5` + `FolderContents 36/37` zlib lvl4, `shouldThrottle` 400ms | `buildAttrs` sync `[]` until async rescan, `isExcluded` gating, `Download Folder` batch button added `BrowseView.tsx` | `PermissionLevel PUBLIC/BUDDY/TRUSTED` split (bridge currently leaks private block), `check_shares_available` warning, `virtual2real` backslash sentinel |
| **Browse** | `requestSharedFileList` + `requestFolderContents` with `allowedPeerResponses` 448M guard + 30s timeout, `BrowseTabs` 10 LRU + `nicotine.recentBrowse` | Sortable columns `name/size/bitrate/length` persisted `localStorage nicotine.browse.sort` + `Download Folder` (`BrowseView.tsx`), column widths `config.columns` not yet persisted | `expand_folders`, multi-folder select, `slsk://user/path` `urls.protocols` |
| **Chat Rooms** | `SayChatroom 13` + `JoinRoom 14`/`Leave 15`/`UserJoined 16`/`Left 17` + `RoomList 64`, private rooms `AddRoomMember 134`/`Remove 135`/`CancelMembership 136`/`Ownership 137`/`Granted 139`/`Revoked 140`/`AddOperator 143`/`Remove 144`/`Granted 145`/`Revoked 146`/`Operators 148`, `RoomTickers 113`/`Added 114`/`Removed 115`/`SetRoomTicker 116`, global `150-152` | `JoinRoom` sanitizes `[^ -~]/\s+/24`, `/me` `* `, censor `words.censorwords` word-boundary `chatFormat.ts`, `replaceWords` on send, `readroomlines 200` `truncateMessages` + `rooms_timestamp %X` via `formatStrftime` | `RoomTicker` wall `popovers/roomwall.py` UI, `EnableRoomInvitations 141` toggle not yet wired to `user_list_visible`, `Completion` dropdown `words.tab/dropdown` `tab` |
| **Private Chat** | `MessageUser 22` + `Ack 23` + `MessageUsers 149` batch, `censorText`/`replaceText` + `readprivatelines 200`, `ctcp.enable` `VERSION` gate | `autoreply` away `server.autoreply` + `autoaway 15 → SetStatus 28`, CTCP 1s throttle, offline `GetPeerAddress` queue | Typing indicator, `MessageAcked` persist `privatechat.users` order |
| **Buddies** | `WatchUser 5`/`Unwatch 6` + `GetUserStatus 7`/`Stats 36` polling, `buddies` 100 LRU `localStorage nicotine.buddies`, `trusted/notify` toggles, grid cards `avgspeed/files` | `buddylistinchatrooms tab/sidebar` stored but always `/buddies` page, `country flag_XX` via `getCountryCode` (now real `—` → `flag`) | Per-buddy `note`, `buddy_notes` persist, `lastSeen` `Never seen` |
| **Interests** | Likes `AddThingILike 51`/`Remove 52`, hates `117/118`, `Recommendations 54`/`Global 56`/`SimilarUsers 110`/`ItemRecommendations 111`/`ItemSimilarUsers 112`, chips + `For "item"` drill-down | Global vs personal labels conflated, expiry 12m | Wishlist tie-in tab |
| **Profiles** | `UserInfoRequest 15`/`Response` `descr/pic/totalupl/queuesize/slotsavail/uploadallowed`, hide/show `pic` `nicotine.showPictures` + `picture_visible`, `givePrivileges 123`/`checkPrivileges 92`, `ClipboardItem` copy | `whois` `GetPeerAddress 3` `slotsFull` grey, `UserInterests 57` in profile but not on interests self-view | `SimilarUsers` shortcut from profile |
| **Notifications / Window** | `notifications` 11 toggles `notification_window_title/tab_colors/popup_*_wish` `defaults.ts:216`, `Notification.permission` + Service Worker `public/sw.js` `showNotification` + `NotificationsSection` enable button, `window.title` flash | `notification_popup_sound` `Audio` base64 beep | Tray `trayicon/startup_hidden/minimize` desktop, `VAPID` push signing |
| **Logging / Diagnostics** | `DiagnosticsPage` 355 lines live tail 500/2000 ring `diagnostics.log` + level/scope/search, `PortChecker` + `StatisticsPanel`, `LoggingSection` `privatechat/chatrooms/transfers/debug` | `log_timestamp` format not yet applied to Diagnostics `formatTime iso.slice`, `readroomlines` not truncating old rooms | Per-day `roomlogsdir/privatelogsdir/transferslogsdir` rotation `logfacility.py`, `logcollapsed` |
| **Statistics** | `StatsManager` `since_timestamp/started/completed_downloads/uploaded` `statistics.json`, `StatisticsPanel` total vs session + `Reset` button → `statistics:reset` → `TransferManager.resetStats()` | Session vs total `since` humanized `fmtSince` | Per-session `downloads_YYYY-MM-DD.log` |
| **Plugins** | `PluginManager` `plugins.json` + `builtins` `spamfilter` + `core_commands` 32 cmds (`help`, `plugin`, `clear/me/now/join/leave/say/pm/close/msg/ctcp/add/rem/browse/whois/ip/ban/unban/ignore/unignore/share/unshare/shares/rescan/search/rsearch/bsearch/usearch/connect/disconnect/away/quit`) `returncode.zap/break/pass` | `installPluginFromZip` via `unzip` 1GiB cap + `installFromUrl` | `PLUGININFO` `settings/metasettings` UI groups `preferences.py:3719` |
| **Settings** | 14 tabs (`Network`, `Interface` + `Notifications`, `Shares`, `Downloads`, `Uploads`, `Searches`, `User Profile`, `Chats`, `Now Playing`, `Logging`, `Banned`, `Ignored`, `URL Handlers`, `Plugins`) `settings/page.tsx` with `?tab=` deep-link | `Network: interface/autoreply/autosearch/autojoin/userlist` list editors future (`settings-mapping.md:44`), `UI: dark_mode/language(5 vs 30+ LANGUAGES)/reverse_file_paths/spellcheck/tabclosers/buddylistinchatrooms` — **color pickers + font pickers omitted intentionally** | `portrange/upnp` P2P, tray/window geometry `width/height`, `filemanager` `desktop.ini`, `speech` deprecated `3.4.0` |
| **Now Playing** | `npplayer/npformat/npothercommand/npformatlist` `NowPlayingSection.tsx`, `NowPlayingSync` `mediaSession`, token legend `$n $t $a $b` | `mpris/other` disabled on win/isolation, `Test` button not yet | `lastfm/librefm/listenbrainz` `ws.audioscrobbler.com` polling |
| **PWA / Mobile shell** | `TopBar` 60 + `env(safe-area)`, `BottomNav` 64 + safe-area, `Sidebar` `w-72`, `ThemeProvider` dark, `manifest.webmanifest`, `ThroughputChart` 2s | `modes_visible/modes_order` drag now via `↑/↓` order controls `UiSection.tsx` + `Sidebar/BottomNav` filtered (full `@dnd-kit` drag omitted) | `Global font` pickers, `icon_view` preview 7 icons |

*Intentionally omitted (no web equivalent, see `docs/settings-mapping.md:310`):* `server.passw` plaintext, `portrange`/`upnp`/`interface` inbound, tray `trayicon`/`startup_hidden`/window geometry, `ui.filemanager` `xdg-open`, `urls.protocols` custom handlers, OS `MPRIS`/`speech`, desktop `afterfinish/afterfolder` shell.

## Docs

- `docs/architecture.md` — bridge, search & protocol details
- `docs/DESIGN.md` — UI tokens
- `docs/settings-mapping.md` — Nicotine+ settings reference (authoritative)
- `docs/settings-plan.md` — remaining settings phases
- `AGENTS.md` — agent conventions
