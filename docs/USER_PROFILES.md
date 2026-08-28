# User Profiles — Feature Mapping & Implementation Plan

> Maps all nicotine-plus User Profile functionality to our mobile web app.
> Reference: `docs/user_profiles.html` (visual suggestion, not strict requirement).
> Design system: `docs/DESIGN.md` (Alexandria — High-End Editorial).

---

## 1. nicotine-plus Feature Inventory

### 1.1 Profile Display (View Any User)

| # | Feature | nicotine-plus Source | Data |
|---|---------|---------------------|------|
| 1 | **Username** | `userinfo.ui:59` `user_label` | String, selectable, tooltip |
| 2 | **Profile Picture** | `userinfo.py:466-502` | Binary (SVG or PNG) from `UserInfoResponse.pic` |
| 3 | **Self Description** | `userinfo.py:276` `description_view` | String from `UserInfoResponse.descr` |
| 4 | **Country + Flag** | `userinfo.py:682-696` | 2-letter code from `GetUserStatus`/`WatchUser` |
| 5 | **Privileged User** | `userinfo.py:660-661` | Bool from `GetUserStatus.privileged` |
| 6 | **Upload Speed** | `userinfo.py:663-674` | `uint32` from `GetUserStats.avgspeed` |
| 7 | **Shared Files** | `userinfo.py:419-420` | `uint32` from `GetUserStats.files` |
| 8 | **Shared Folders** | `userinfo.py:422-423` | `uint32` from `GetUserStats.dirs` |
| 9 | **Upload Slots Available** | `userinfo.py:639` | `bool` from `UserInfoResponse.slotsavail` |
| 10 | **Total Upload Slots** | `userinfo.py:640` | `uint32` from `UserInfoResponse.totalupl` |
| 11 | **Queued Uploads** | `userinfo.py:641-643` | `uint32` from `UserInfoResponse.queuesize` |

### 1.2 User Interests (Displayed on Profile)

| # | Feature | nicotine-plus Source | Data |
|---|---------|---------------------|------|
| 12 | **Likes List** | `userinfo.py:309-319` | `string[]` from `UserInterests.likes` |
| 13 | **Dislikes List** | `userinfo.py:322-332` | `string[]` from `UserInterests.hates` |
| 14 | **Like/Dislike Toggle** | `userinfo.py:344-358` | Context menu on items |

### 1.3 Action Buttons (On Profile Page)

| # | Feature | Handler | Protocol |
|---|---------|---------|----------|
| 15 | **Send Message** | `on_send_message` | Navigate to private chat |
| 16 | **Browse Files** | `on_browse_user` | Opens `UserBrowse` for that user |
| 17 | **Add/Remove Buddy** | `on_add_remove_buddy` | Local buddy list toggle |
| 18 | **Ban/Unban User** | `on_ban_unban_user` | Local filter list |
| 19 | **Ignore/Unignore User** | `on_ignore_unignore_user` | Local filter list |
| 20 | **Gift Privileges** | `on_give_privileges` | `GivePrivileges` server msg |
| 21 | **Show/Hide Picture** | `on_toggle_picture` | Local config toggle |
| 22 | **Refresh Profile** | `on_refresh` | Re-request all data |

### 1.4 Own Profile Editing

| # | Feature | nicotine-plus Source | Data |
|---|---------|---------------------|------|
| 23 | **Edit Description** | `settings/userinfo.ui` | Editable textarea in preferences |
| 24 | **Upload Picture** | `settings/userinfo.ui` | File picker → binary stored locally |
| 25 | **Remove Picture** | `on_remove_picture` | Clear picture from config |

### 1.5 Interests Page (Separate Tab)

| # | Feature | nicotine-plus Source | Description |
|---|---------|---------------------|-------------|
| 26 | **Personal Likes (editable)** | `interests.py:61-71` | Add/remove via combobox |
| 27 | **Personal Dislikes (editable)** | `interests.py:73-83` | Add/remove via combobox |
| 28 | **Recommendations** | `interests.py:85-106` | Rating + Item columns |
| 29 | **Similar Users** | `interests.py:108-156` | Status, country, username, speed, files |
| 30 | **Item Recommendations** | `show_item_recommendations` | Click item → recs for that item |
| 31 | **Refresh Recs** | `on_refresh_recommendations` | Re-fetch from server |

### 1.6 User File Browser (Browse Shares)

| # | Feature | nicotine-plus Source | Description |
|---|---------|---------------------|-------------|
| 32 | **Folder Tree** | `userbrowse.py:243-258` | Hierarchical navigation |
| 33 | **File List** | `userbrowse.py:307-351` | Columns: icon, name, size, quality, duration |
| 34 | **Path Bar Breadcrumbs** | `userbrowse.py:663-732` | Clickable breadcrumb navigation |
| 35 | **Search Within Shares** | `userbrowse.py:806-874` | Filter folders/files |
| 36 | **Download Files** | `on_download_files` | Download selected files |
| 37 | **Download Folder** | `on_download_folder` | Download entire folder |
| 38 | **Download To...** | `on_download_files_to` | Choose destination |
| 39 | **File Properties** | `on_file_properties` | Dialog with metadata |

### 1.7 Picture Context Menu

| # | Feature | Handler |
|---|---------|---------|
| 40 | **Copy Picture** | `on_copy_picture` — Clipboard API |
| 41 | **Save Picture** | `on_save_picture` — File download |
| 42 | **Hide Picture** | `on_hide_picture` — Config toggle |

---

## 2. Protocol Messages Required

### 2.1 Server Messages (TCP to Soulseek Server)

| Code | Name | Direction | Purpose |
|------|------|-----------|---------|
| 3 | `GetPeerAddress` | Send | Get peer IP/port for P2P connection |
| 5 | `WatchUser` | Send | Subscribe to user status + initial stats |
| 6 | `UnwatchUser` | Send | Unsubscribe from user updates |
| 7 | `GetUserStatus` | Recv | User online/away/offline + privileged |
| 28 | `SetStatus` | Send | Set own status (online/away) |
| 35 | `SharedFoldersFiles` | Send | Report own shares to server |
| 36 | `GetUserStats` | Send/Recv | Speed, files, folders |
| 51 | `AddThingILike` | Send | Add interest to likes |
| 52 | `RemoveThingILike` | Send | Remove interest from likes |
| 54 | `Recommendations` | Recv | Personal recommendations |
| 56 | `GlobalRecommendations` | Recv | Global popular interests |
| 57 | `UserInterests` | Send/Recv | Request/receive user likes/hates |
| 110 | `SimilarUsers` | Recv | Users with similar interests |
| 111 | `ItemRecommendations` | Recv | Recs for specific item |
| 112 | `ItemSimilarUsers` | Recv | Users who like specific item |
| 117 | `AddThingIHate` | Send | Add interest to dislikes |
| 118 | `RemoveThingIHate` | Send | Remove interest from dislikes |

### 2.2 Peer Messages (P2P Direct)

| Code | Name | Direction | Purpose |
|------|------|-----------|---------|
| 15 | `UserInfoRequest` | Send | Request profile from peer |
| 16 | `UserInfoResponse` | Recv | Profile: description, picture, upload info |

---

## 3. Implementation Phases

### Phase 1: Protocol Foundation (Bridge)
**Goal:** Add all user-info protocol messages to the Bun bridge.

| Task | Details |
|------|---------|
| 1.1 Add server message codes | `getPeerAddress: 3`, `watchUser: 5`, `unwatchUser: 6`, `getUserStatus: 7`, `setStatus: 28`, `sharedFoldersFiles: 35`, `getUserStats: 36`, `recommendations: 54`, `globalRecommendations: 56`, `userInterests: 57`, `similarUsers: 110`, `itemRecommendations: 111`, `itemSimilarUsers: 112`, `addThingILike: 51`, `removeThingILike: 52`, `addThingIHate: 117`, `removeThingIHate: 118` |
| 1.2 Add peer message codes | `userInfoRequest: 15`, `userInfoResponse: 16` |
| 1.3 Add packing helpers | `packUint8`, `packInt32`, `packBytes` |
| 1.4 Add unpacking helpers | `unpackUint32`, `unpackInt32`, `unpackString`, `unpackBool`, `unpackBytes` |
| 1.5 Message builders | One `build*()` function per outbound message |
| 1.6 Message parsers | One `parse*()` function per inbound message |
| 1.7 WebSocket relay | Forward parsed messages as JSON events to web client |
| 1.8 Peer connection manager | Handle P2P connections for `UserInfoRequest`/`UserInfoResponse` |

**Depends on:** Nothing (build on existing `soulseek.ts`).
**Verify:** `bun test` passes, bridge can watch a user and receive status updates.

---

### Phase 2: Core Profile View (Web)
**Goal:** View any user's profile from the web app.

| Task | Details |
|------|---------|
| 2.1 Protocol types | TypeScript interfaces: `UserInfoResponse`, `UserStats`, `UserInterests`, `UserStatus`, `WatchUserResponse` |
| 2.2 Bridge client lib | `useUserInfo(username)` hook — sends watch + requests, subscribes to updates via WebSocket |
| 2.3 Profile page route | `/profile/[username]` Next.js App Router page |
| 2.4 Profile header | Username (Noto Serif), country flag + name, privileged badge (star icon) |
| 2.5 Stats grid | 2×2 grid: Files Shared, Avg Speed, Shared Folders, Upload Slots — using `surface-container-low` cards |
| 2.6 Description section | Scrollable text view for bio, styled with `surface-container-low` background |
| 2.7 Interests section | Likes/dislikes list (read-only for other users), using `tertiary` accents for items |
| 2.8 Loading/error states | Progress bar, retry button, offline detection message |
| 2.9 Navigation | "Browse Files" and "Send Message" buttons at bottom of profile card |

**Design alignment with `user_profiles.html`:**
- Right panel layout with centered avatar, stats grid, action buttons
- Use `font-headline` (Noto Serif) for username and stats
- Use `font-label` (Public Sans) for metadata labels
- Stats in `surface-container-low` rounded cards
- Action buttons: primary gradient for "Browse Files", surface bg for "Send Message"

**Depends on:** Phase 1.
**Verify:** Can navigate to `/profile/someuser` and see their stats, description, interests.

---

### Phase 3: Profile Picture Support
**Goal:** Display, copy, and save user profile pictures.

| Task | Details |
|------|---------|
| 3.1 Binary handling | Bridge receives raw bytes from `UserInfoResponse`, base64-encodes for WebSocket JSON |
| 3.2 Picture display | `<img>` with SVG/PNG auto-detection, aspect ratio preservation, `rounded-full` on profile card |
| 3.3 Show/hide toggle | Persist preference in `localStorage`, toggle via button |
| 3.4 Copy picture | Web Clipboard API (`navigator.clipboard.write`) |
| 3.5 Save picture | Download via `<a download>` blob URL |
| 3.6 Mobile share | Web Share API for native share sheet on mobile |

**Depends on:** Phase 2.
**Verify:** Profile picture renders, can copy/save.

---

### Phase 4: Own Profile Editing
**Goal:** Edit your own profile description and picture.

| Task | Details |
|------|---------|
| 4.1 Settings page | `/settings/profile` route |
| 4.2 Description editor | Multiline textarea with `surface-container` bg, save on submit |
| 4.3 Picture upload | File input → read as bytes → send via bridge |
| 4.4 Picture remove | Clear picture on server |
| 4.5 Local profile serving | Bridge stores `descr` and `pic` path, serves them when peers request `UserInfoRequest` |

**Depends on:** Phase 1 (peer connection handler), Phase 3.
**Verify:** Edit description → other clients see updated bio.

---

### Phase 5: User Actions
**Goal:** Send message, browse files, buddy/ban/ignore from profile page.

| Task | Details |
|------|---------|
| 5.1 Send Message | Button → navigate to `/chat/[username]` |
| 5.2 Browse Files | Button → navigate to `/browse/[username]` |
| 5.3 Add/Remove Buddy | Toggle buddy status, update button label ("Add Buddy" / "Remove Buddy") |
| 5.4 Ban/Unban User | Toggle ban status, hidden when viewing own profile |
| 5.5 Ignore/Unignore User | Toggle ignore status, hidden when viewing own profile |
| 5.6 Gift Privileges | Modal dialog → enter days → send `GivePrivileges` |
| 5.7 Own vs other detection | Compare `username === localUsername`, show/hide edit vs ban/ignore |

**Depends on:** Phase 2.
**Verify:** Buttons work, own profile shows edit options, other profiles show ban/ignore.

---

### Phase 6: Interests System
**Goal:** Full interests page with likes, dislikes, and recommendations.

| Task | Details |
|------|---------|
| 6.1 Interests page route | `/interests` Next.js page |
| 6.2 Likes list (editable) | Add via text input, remove via swipe/delete, send `AddThingILike` / `RemoveThingILike` |
| 6.3 Dislikes list (editable) | Same pattern, send `AddThingIHate` / `RemoveThingIHate` |
| 6.4 Recommendations panel | Fetch `Recommendations` or `GlobalRecommendations`, show rating + item in list |
| 6.5 Similar Users panel | Fetch `SimilarUsers`, show status icon, country flag, username, speed, files |
| 6.6 Item recommendations | Tap item → fetch `ItemRecommendations` + `ItemSimilarUsers` |
| 6.7 Refresh button | Re-fetch recommendations |
| 6.8 Context actions | "I Like This", "I Dislike This", "Recommendations for Item", "Search for Item" |

**Depends on:** Phase 1.
**Verify:** Can add/remove interests, see recommendations update.

---

### Phase 7: User File Browser
**Goal:** Browse another user's shared files and download them.

| Task | Details |
|------|---------|
| 7.1 Browse page route | `/browse/[username]` Next.js page |
| 7.2 Folder tree | Hierarchical list with expand/collapse, nested indentation |
| 7.3 File list table | Columns: file type icon, name, size, quality (bitrate), duration |
| 7.4 Path bar breadcrumbs | Clickable breadcrumb segments for navigation |
| 7.5 Search/filter | Search input to filter folders and files |
| 7.6 Download file(s) | Tap file → request download via bridge |
| 7.7 Download folder | "Download All" button for folder |
| 7.8 File properties | Bottom sheet with file metadata |

**Depends on:** Phase 1 (peer connection for file list), Phase 2.
**Verify:** Can browse user's shares, see folder tree and files, download works.

---

### Phase 8: Mobile Optimizations
**Goal:** Touch-first UX, PWA integration.

| Task | Details |
|------|---------|
| 8.1 Touch targets | Min 44px on all interactive elements |
| 8.2 Swipe gestures | Swipe between profile sections/tabs |
| 8.3 Pull-to-refresh | Refresh profile data on pull |
| 8.4 Bottom sheet actions | Action buttons in bottom sheet on mobile |
| 8.5 Safe area insets | Handle notch/Dynamic Island with `env(safe-area-inset-*)` |
| 8.6 Offline handling | Cache last-known profile in localStorage, show stale indicator |
| 8.7 PWA manifest | Add profile routes to `manifest.webmanifest` |
| 8.8 Responsive layout | Stack columns on mobile, side-by-side on desktop |

**Depends on:** All previous phases.
**Verify:** Smooth on mobile, works offline (cached), PWA installable.

---

## 4. Data Flow

```
Web App (Next.js)          Bridge (Bun)                Soulseek Server / Peer
      │                          │                              │
      │── watchUser(user) ──────>│── WatchUser(user) ──────────>│
      │── userInterests(user) ──>│── UserInterests(user) ──────>│
      │── userInfoRequest ──────>│── UserInfoRequest ──────────>│ (P2P)
      │                          │                              │
      │<── user-status ─────────│<── GetUserStatus ────────────│
      │<── user-stats ──────────│<── GetUserStats ─────────────│
      │<── user-interests ──────│<── UserInterests ────────────│
      │<── user-info-response ──│<── UserInfoResponse ─────────│ (P2P)
      │                          │                              │
      │── addThingILike(item) ──>│── AddThingILike(item) ─────>│
      │── removeThingILike() ───>│── RemoveThingILike(item) ──>│
      │<── recommendations ─────│<── Recommendations ──────────│
      │<── similar-users ───────│<── SimilarUsers ─────────────│
```

---

## 5. Priority & Build Order

| Priority | Phase | Effort | Impact |
|----------|-------|--------|--------|
| 1 | Phase 1: Protocol Foundation | High | Unblocks everything |
| 2 | Phase 2: Core Profile View | Medium | MVP: view any profile |
| 3 | Phase 5: User Actions | Low | Critical for usability |
| 4 | Phase 3: Profile Pictures | Low | Nice visual polish |
| 5 | Phase 4: Own Profile Edit | Medium | Self-expression |
| 6 | Phase 6: Interests | Medium | Full feature parity |
| 7 | Phase 7: File Browser | High | Complex, high value |
| 8 | Phase 8: Mobile Polish | Medium | Final pass |

---

## 6. Visual Design Mapping (from `user_profiles.html`)

The HTML suggestion uses a **two-column layout** with a peer list on the left and a profile detail panel on the right. For our mobile-first app:

### Mobile (single column)
- **Profile header:** Centered avatar (64-96px), username below, country flag inline
- **Stats:** 2×2 grid of stat cards (`surface-container-low` bg)
- **Description:** Scrollable text block
- **Interests:** Two small lists (likes/dislikes) side by side or stacked
- **Actions:** Full-width buttons stacked vertically

### Desktop (side-by-side)
- **Left:** Search bar + list of recently viewed profiles
- **Right:** Profile detail panel (sticky), matching the HTML layout

### Design Tokens to Use
- **Headlines:** `font-headline` (Noto Serif) — username, stats numbers
- **Labels:** `font-label` (Public Sans, uppercase, tracking-widest) — "FILES SHARED", "AVG SPEED"
- **Body:** `font-body` (Inter) — description text, interest items
- **Cards:** `bg-surface-container-low rounded-xl` — stat cards
- **Primary CTA:** `bg-gradient-to-r from-primary to-primary-container` — "Browse Files"
- **Secondary:** `bg-surface-container hover:bg-surface-container-high` — "Send Message"
- **No borders:** Use background color shifts, not 1px lines
- **Privileged badge:** `bg-tertiary-container` star icon

---

## 7. Not Implementing (Out of Scope)

These features exist in nicotine-plus but are deferred or skipped for this mobile MVP:

| Feature | Reason |
|---------|--------|
| Upload to other users | Requires local file sharing, complex permission model |
| File properties dialog | Desktop-focused, low mobile value |
| Shares list export | Desktop file system interaction |
| Keyboard shortcuts | Mobile-first, touch gestures instead |
| Tab management (close all) | Not applicable to mobile routing model |
| IP address display | Privacy concern on mobile, lower priority |

---

## 8. Implementation Status — 2026-08-28 (feat/profile-view)

> Built on `main@a57378c`. PR #7 `feat/profile-view` (commits `96ca142`, `77899e1`).

### What shipped (MVP — display-only per design decision)

| Area | Status | Notes |
|------|--------|-------|
| Phase 1 Protocol | ✅ Done | All server codes 3/5/6/7/28/35/36/51/52/54/56/57/110/111/112/117/118 + peer 15/16 in `soulseek.ts:20-42`; `SlskReader` + `pack*` helpers; parsers `parseUserStatus/Stats/Interests/Recommendations/SimilarUsers/Item* /PeerAddress/UserInfoResponse`; builders `buildWatchUser/UnwatchUser/GetUserStats/UserInterests/GetPeerAddress/SetStatus/SharedFoldersFiles/AddThing* /GivePrivileges/UserInfo*`; WS relay `server.ts:51-89` `userinfo` union (13 actions) + `server.ts:185` `userinfo:event`; peer manager `session.ts:373-442` for `UserInfoRequest/Response`. **Fix:** `session.ts:300` corrected `itemRecommendations` to use `parseItemRecommendations` (was swapped with `parseRecommendations`). |
| Phase 2 Core View | ✅ Done (MVP) | `protocol.ts:237-350` types `UserInfoStatus/Stats/Interests/Profile/Recommendation/SimilarUser/UserInfoEvent` + `UserInfoResponseOutbound/Failed`; `lib/userinfo.tsx:26` `useUserInfo` hook (watch + interests + get, handle both `user-info-response` direct and `userinfo:event`, unwatch on unmount); `app/profile/page.tsx` lookup + `app/profile/[username]/page.tsx` detail (header with avatar/privileged star, status, 2×2 stats grid `Files Shared/Shared Folders/Avg Speed/Upload Slots`, description, likes/dislikes chips, loading/error). Uses `DESIGN.md` tokens (`font-headline Noto Serif`, `font-label Public Sans`, `surface-container-low rounded-xl`, `primary→primary-container` CTA). |
| Picture (Phase 3) | ✅ Display only | Bridge base64 `server.ts:295`, web `profilePicSrc` SVG-vs-PNG detect, `rounded-full`. Copy/save/share deferred per MVP decision (user chose display-only). |
| Navigation | ✅ Done | `Sidebar.tsx:14` `User Profiles` → `/profile`; `SearchScreen.tsx` “View Profile” sheet → `router.push(/profile/:user)`; `profile/page.tsx` recent list. |
| Recent profiles | ✅ Done (localStorage) | User decision #3: `localStorage nicotine.recentProfiles` (max 20, dedup, LRU). `profile/[username]/page.tsx:saveRecent` on view; `profile/page.tsx:loadRecent` renders clickable `rounded-xl ghost-border` rows + Clear. |
| Verification | ✅ | `bun test` (bridge 30 pass) + `bun run build` (routes `/profile 3.75kB` + `/profile/[username] 5.22kB`) both green. |

### What was intentionally deferred for MVP

- Picture copy/save/share, show/hide toggle (Phase 3 full), own profile editing (Phase 4), buddy/ban/ignore/gift privileges (Phase 5 full — buttons show “coming soon” toast), interests page (Phase 6), file browser (Phase 7), mobile swipe/pull-to-refresh (Phase 8).

---

## 9. Next Phases — after MVP (roadmap)

Prioritized for incremental delivery; each phase is a small PR against `main`.

### 9.1 Phase 3.1 — Picture polish (Low effort, nice visual)

| Task | Detail | Protocol |
|------|--------|----------|
| Copy picture | `navigator.clipboard.write([ClipboardItem])` — guard `has_pic` | — |
| Save picture | Blob URL + `<a download="${username}.png">` | — |
| Mobile share | `navigator.share({files:[File]})` fallback to save | — |
| Show/hide toggle | `localStorage nicotine.showPictures` bool | — |

**Verify:** picture renders on offline user; save produces correct MIME (SVG vs PNG).

### 9.2 Phase 5.1 — User Actions (Low effort, high usability)

| Task | Detail | Depends |
|------|--------|---------|
| Send Message | `router.push(/chat/:username)` (stub → real `/chat` page) | Phase 2 |
| Browse Files | `router.push(/browse/:username)` (peer `SharedFileListRequest` 4/5) | Peer 4/5 |
| Add Buddy / Remove Buddy | `localStorage nicotine.buddies: string[]` + toggle label | — |
| Ban / Ignore | `localStorage nicotine.banned/ignored` + filter search results | — |
| Gift Privileges | Modal days 1-3650 → `userinfo givePrivileges` → `GivePrivileges(123)` | Bridge already wired |
| Own vs other | `username === useSession().state.user` → hide ban/ignore, show Edit link | — |

**Verify:** own profile shows “Edit Profile” not ban/ignore; buddy persists across reload.

### 9.3 Phase 4 — Own Profile Editing (Medium)

| Task | Detail |
|------|--------|
| `/settings/profile` page | Textarea `descr` + file input `pic` (read File → base64) |
| Save | `send {type:"userinfo",action:"setProfile",profile}` → `session.setProfile` → peers see update via `UserInfoResponse` |
| Clear picture | Button → `pic:null` |
| Validation | `descr≤10000`, `pic≤5M` (zod `ProfileSchema 42-49`) |

**Depends:** Phase 3.1 peer serve already via `buildUserInfoResponse`.

### 9.4 Phase 6 — Interests Page (Medium, full parity)

| Task | Detail |
|------|--------|
| `/interests` route | Two editable lists (likes/dislikes) + chips |
| Add/remove | Inputs → `AddThingILike(51)/RemoveThingILike(52)/AddThingIHate(117)/RemoveThingIHate(118)` |
| Recommendations | Panels `Recommendations(54)` + `GlobalRecommendations(56)` (rating + item) |
| Similar Users | `SimilarUsers(110)` table (username, status dot, speed, files) |
| Item drill-down | Tap item → `ItemRecommendations(111)` + `ItemSimilarUsers(112)` |
| Context menu | “I Like This”, “I Dislike This”, “Search for Item” (→ `FileSearch`) |

**Depends:** Phase 1 (parsers already fixed).

### 9.5 Phase 7 — User File Browser (High effort, high value)

Requires peer `SharedFileList` (codes 4/5, zlib, folder tree) — separate from profile P2P. Reuse `session.ts` peer manager pattern. Route `/browse/[username]` with breadcrumbs, search/filter, download via `TransferManager`/peer `TransferRequest(40)`.

### 9.6 Phase 8 — Mobile polish (Final pass)

- 44px touch targets already via `min-h-11`; add swipe between profile sections, pull-to-refresh `watch+get+interests`, bottom-sheet actions, stale cache indicator from `localStorage` profile snapshot, PWA `manifest.webmanifest` includes `/profile` routes, desktop `xl:grid-cols-3` two-column (recent list left, detail right) matching `user_profiles.html:163-294` hero styling.

### Build order summary

| Next | Phase | PR size |
|------|-------|---------|
| 1 | 3.1 Picture polish | Small |
| 2 | 5.1 User Actions | Small |
| 3 | 4 Own Profile Edit | Medium |
| 4 | 6 Interests | Medium |
| 5 | 7 File Browser | Large |
| 6 | 8 Mobile polish | Medium |
