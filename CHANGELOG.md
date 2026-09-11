# Changelog

## [0.35.0](https://github.com/mlnl221/nicotineHub/compare/v0.34.0...v0.35.0) (2026-09-11)


### Features

* **web:** stick-to-bottom chat scroll, username menus, syslog 5% ([1a14871](https://github.com/mlnl221/nicotineHub/commit/1a14871981fd5e27bc543c90eed0f253cb2d68de))
* **web:** stick-to-bottom chat scroll, username menus, syslog 5% ([5a081cb](https://github.com/mlnl221/nicotineHub/commit/5a081cb333bfb46867f601bfa6e05674945d2b5e))


### Bug Fixes

* **bridge:** deny repeat peer grants for finished downloads ([818d412](https://github.com/mlnl221/nicotineHub/commit/818d41242722146fb0d135eac5da42784d91fe2b))
* **bridge:** pack browse basenames so peers request single paths; deny auto-reject with UploadDenied ([209bb3f](https://github.com/mlnl221/nicotineHub/commit/209bb3fafa3afe1c7c786e69bdaf60b2092ffe6b))
* **bridge:** pack browse basenames so peers request single paths; deny auto-reject with UploadDenied ([9f69490](https://github.com/mlnl221/nicotineHub/commit/9f694903930f20d87fb5bbb50c1c245eb0db0573))

## [0.34.0](https://github.com/mlnl221/nicotineHub/compare/v0.33.0...v0.34.0) (2026-09-11)


### Bug Fixes

* **audit:** framing guards, search cancel, containment, dead UI prune ([c622777](https://github.com/mlnl221/nicotineHub/commit/c622777a2c2a4759560ddab5b64317b86aa51c01))
* **audit:** framing guards, ws-close search cancel, path containment, dead UI prune ([3e00492](https://github.com/mlnl221/nicotineHub/commit/3e004923b39c612654a6793a8f21ee390d920614))
* **web:** APG treeview keyboard for browse shares ([238f950](https://github.com/mlnl221/nicotineHub/commit/238f9500f1c6e7989cea7f34f2793c96ee29f258))


### Miscellaneous Chores

* release train 0.34 bundles audit hardening and treeview keyboard ([d65afa9](https://github.com/mlnl221/nicotineHub/commit/d65afa9ab15f3aee2f59fd303ed7a74e4edf363e))

## [0.33.0](https://github.com/mlnl221/nicotineHub/compare/v0.32.0...v0.33.0) (2026-09-09)


### Features

* **bridge:** preserve remote folder structure in downloads ([4341b9e](https://github.com/mlnl221/nicotineHub/commit/4341b9e236fc44d7b86e8c7889588efaec16d129))
* **bridge:** preserve remote folder structure in downloads ([f1f5f92](https://github.com/mlnl221/nicotineHub/commit/f1f5f92eae70eebcc6ff25572326cee88c8e0a4a))
* **browse:** expand-all/collapse-all plus synthetic parent folders ([8760102](https://github.com/mlnl221/nicotineHub/commit/8760102ef2ab7e26e470ff51620f9184eaa67929))
* **browse:** expand-all/collapse-all plus synthetic parent folders ([f47f8c9](https://github.com/mlnl221/nicotineHub/commit/f47f8c95980fba6fb697543b13d599b6e1ae257f))
* **browse:** loading progress + 9k-folder perf ([ac1d4dd](https://github.com/mlnl221/nicotineHub/commit/ac1d4dd98ba8f6108175676364349b6684be95a8))
* **browse:** loading progress + 9k-folder perf (page 1000, memo tree, debounced search) ([7c3db78](https://github.com/mlnl221/nicotineHub/commit/7c3db780829d420d9b1a843e61313f66ce3a98f9))
* **downloads:** path-depth setting + Play token exact resolve + trim migration ([3124e5d](https://github.com/mlnl221/nicotineHub/commit/3124e5dc24e4b0f0a8aebeb38f0936f78d59b06a))
* **downloads:** persist per-user subfolders, show expected save path ([6c7347e](https://github.com/mlnl221/nicotineHub/commit/6c7347e9fc3c4f5ed3466a39b26c445d9e610072))
* **downloads:** persist per-user subfolders, show expected save path ([7568ab7](https://github.com/mlnl221/nicotineHub/commit/7568ab74466898f2476eb0fa2bab3b67a9c9846f))
* **downloads:** Play pill on finished audio + Files-parity context menu ([2e35cbb](https://github.com/mlnl221/nicotineHub/commit/2e35cbbee19b74fa5341569de871c2c91e8a2496))
* **downloads:** Play pill on finished audio + Files-parity context menu ([d943e69](https://github.com/mlnl221/nicotineHub/commit/d943e69b35a0df8bad0282c79c1c6efb09230e13))
* **scrape:** generalize adjust-tags to all scrapers with canonical shapes ([ac4b56a](https://github.com/mlnl221/nicotineHub/commit/ac4b56a67b52092a528815b0a244c7a3abdd1e71))
* **scrape:** Mp3tag-style adjust-tags modal with full Discogs meta and cover ([11ab782](https://github.com/mlnl221/nicotineHub/commit/11ab782a405a7763a425cc83aa28ecea11a3c3f8))
* **scrape:** per-file Discogs track mapping in bulk scrape ([fb06999](https://github.com/mlnl221/nicotineHub/commit/fb069998d2d48c66b6aecc796bd315f4e5bd8008))
* **scrape:** post-apply rename files from settings template ([d6ce6cc](https://github.com/mlnl221/nicotineHub/commit/d6ce6cc72ac0e632644af225dca5e301352c8725))
* **scrape:** smoked-salmon cross-check fixes, disable beatport ([a77bec1](https://github.com/mlnl221/nicotineHub/commit/a77bec1793d23c89cee91322b2cfd46d50b35c54))
* **search:** double-click download, full result menu, sheet above chrome ([025280d](https://github.com/mlnl221/nicotineHub/commit/025280d6d3b84b745ca7f5cca641b80097d48b16))
* **search:** double-click download, full result menu, sheet above chrome ([c43830b](https://github.com/mlnl221/nicotineHub/commit/c43830b1068f02eb054c0d399c60271cc7593b60))
* **settings:** auto save+rescan on share add, top-level rescan buttons, drop WSL block ([79c86e2](https://github.com/mlnl221/nicotineHub/commit/79c86e2471fd3b9a829c262486ac235af50124b8))
* **settings:** auto save+rescan on share add, top-level rescan buttons, drop WSL block ([35b7a26](https://github.com/mlnl221/nicotineHub/commit/35b7a26fb90b8fe906986b3c661cf9802fa25bab))
* **shares:** files rescan button, scan progress stream, autosave on pick ([15e9946](https://github.com/mlnl221/nicotineHub/commit/15e9946922d46c3d964565a7a08c9cff71382d2c))
* **transfers:** kebab More-actions button on transfer cards ([9e410c4](https://github.com/mlnl221/nicotineHub/commit/9e410c42cd49c30266b075a139e460684aa04529))
* **web:** best-first search sort with peer speed/queue pills ([96b4d34](https://github.com/mlnl221/nicotineHub/commit/96b4d3480af889b192140aac25206fabb803b840))
* **web:** best-first search sort with peer speed/queue pills ([6d835fd](https://github.com/mlnl221/nicotineHub/commit/6d835fde5e6ae6ec7ca2b547f1462d8d76670562))
* **web:** default search to public files only ([c9a4718](https://github.com/mlnl221/nicotineHub/commit/c9a4718cd21e6321e116fc73eadc40297a331e4e))
* **web:** default search to public files only ([42d2b85](https://github.com/mlnl221/nicotineHub/commit/42d2b855c8a0f74fba5b27f0ccb55568f25a208b))
* **web:** draggable demo pill + banner ([b002169](https://github.com/mlnl221/nicotineHub/commit/b002169c8293ce45eef333e1ca2b26f2562402e1))
* **web:** hide buddies/chat/interests by default, rebrand tagline, confirm logoff ([7467b38](https://github.com/mlnl221/nicotineHub/commit/7467b38e5284196da4d0ec7c5225f6acb8e9dc3d))
* **web:** live pointer default, rendered-range select, keyboard menus ([d377cfb](https://github.com/mlnl221/nicotineHub/commit/d377cfba942763997ca6bc4ead2ae06e25ca744d))
* **web:** make demo pill and banner draggable with persisted position ([9a5dd5a](https://github.com/mlnl221/nicotineHub/commit/9a5dd5ad50bd966ee0de8eaeaf0c9e2da93566d4))
* **web:** move logging dirs to CONFIG_DIR with auto-migrate ([d6cc69d](https://github.com/mlnl221/nicotineHub/commit/d6cc69d3c1ab0e9c035fff6bb768cd618bd451c7))
* **web:** reliable right-click menus, desktop click-to-select search rows ([ba77ae6](https://github.com/mlnl221/nicotineHub/commit/ba77ae6b6db2343bd06ae738a2a845a611410939))
* **web:** reliable right-click menus, desktop click-to-select search rows ([de1ecea](https://github.com/mlnl221/nicotineHub/commit/de1eceae9fc30e1df3073fc0cb706a48c16dad71))
* **web:** search multi-select with bulk downloads ([4e40d7c](https://github.com/mlnl221/nicotineHub/commit/4e40d7c571b7b253d8f61273ed825125bcaa82ef))
* **web:** search multi-select with bulk downloads ([944a8f2](https://github.com/mlnl221/nicotineHub/commit/944a8f236f65c0efb98bc21fe6dc893f03eeec58))
* **web:** unread dots on nav for chat, downloads, search, browse, profiles ([0a4d4e7](https://github.com/mlnl221/nicotineHub/commit/0a4d4e7f75aa0fe98bdf2ef84377cec40a3880b1))
* **web:** unread dots on nav for chat, downloads, search, browse, profiles ([c4d5181](https://github.com/mlnl221/nicotineHub/commit/c4d51812abcca8728a91f5efcaf969d6a520f12d))
* **web:** user-only search groups, slim rows, drop porting-status doc ([28f6421](https://github.com/mlnl221/nicotineHub/commit/28f6421f7022708382ed95ad956a372e172dfaae))
* **wishlist:** bridge persistence, auto flag, colon-safe ids, notify dedupe + stable tokens ([7ecf1bd](https://github.com/mlnl221/nicotineHub/commit/7ecf1bd79e21e130fbe64b349a7240b4a9aaf3c5))
* **wishlist:** bridge persistence, auto flag, colon-safe ids, notify dedupe + stable tokens ([f6bf7db](https://github.com/mlnl221/nicotineHub/commit/f6bf7dbdd2284c019c6245c0469005052d7eee68))


### Bug Fixes

* **bridge,web:** P0-P2 download hardening (owner-scoped matching, no fake progress, upload F initiator) ([c90d260](https://github.com/mlnl221/nicotineHub/commit/c90d2606d79506a53706457340d170478611a3ea))
* **bridge,web:** P0-P2 review followups ([e707f41](https://github.com/mlnl221/nicotineHub/commit/e707f41e0d37a1e9fe3b844ab1a622f74bdeeba6))
* **bridge:** accept F on any granted token for a transfer ([0ad2f06](https://github.com/mlnl221/nicotineHub/commit/0ad2f06def7c7025559b870de82d81c31907a7c0))
* **bridge:** adopt early inbound pierce + FileInit demux on pierced F ([fc44661](https://github.com/mlnl221/nicotineHub/commit/fc4466182fbd8bb7adeff9af61e9564f3014b5c1))
* **bridge:** bare TransferResponse allowed has no filesize field ([24a2eb5](https://github.com/mlnl221/nicotineHub/commit/24a2eb57931c5f0bd407ab25cc880a0b6d243d22))
* **bridge:** correct peer init framing 5+len to 4+len ([9a0fd77](https://github.com/mlnl221/nicotineHub/commit/9a0fd77e8e3dfdfaf530b7fd6582f57bffc61a5b))
* **bridge:** correct peer init framing 5+len to 4+len ([8e4a269](https://github.com/mlnl221/nicotineHub/commit/8e4a269f77f0956ae48fb496e1d389b275c9bf22))
* **bridge:** don't coalesce peer sends behind half-open sockets ([81b26f2](https://github.com/mlnl221/nicotineHub/commit/81b26f20d95b9fb02cc026ece259f005a006b927))
* **bridge:** echo uploader size in TransferResponse allowed ([a40deda](https://github.com/mlnl221/nicotineHub/commit/a40dedaef8890c944723d4b67f8b86ae88ba6541))
* **bridge:** gate manual-retry progress stub on real TransferRequest ([5a6ed4a](https://github.com/mlnl221/nicotineHub/commit/5a6ed4a0924a0346ea4d960524286bb94b84bfcd))
* **bridge:** ignore duplicate F for an actively streaming transfer ([0be80f6](https://github.com/mlnl221/nicotineHub/commit/0be80f62fead4f6a5d8ad8f8fbc684105cf8f871))
* **bridge:** keep peer socket state for connection lifetime ([3fda861](https://github.com/mlnl221/nicotineHub/commit/3fda8610161277863f3d0c59592110499c0b87c6))
* **bridge:** repair download path end-to-end (F bytes reach disk) ([0314c09](https://github.com/mlnl221/nicotineHub/commit/0314c09af252431b1944ed6807d278da77391ed5))
* **bridge:** reply TransferResponse on TransferRequest, parse UploadDenied properly ([a51a709](https://github.com/mlnl221/nicotineHub/commit/a51a709ad8f52d925a43397bb324808758d2eaa4))
* **bridge:** stash remote browse pages on ws.data so browse:page works ([6583375](https://github.com/mlnl221/nicotineHub/commit/6583375801f1cba70342bbcacf87c61ed4559d07))
* **bridge:** wire onFileConnection in listener F demux ([6f39cb7](https://github.com/mlnl221/nicotineHub/commit/6f39cb7d707b8c5ddc75d43bcd6a68043c6da52a))
* **bridge:** wire onFileConnection in raw-token F demux path ([cb50996](https://github.com/mlnl221/nicotineHub/commit/cb50996b3bac6d2b81d035ae3a26188421031152))
* **browse:** keyboard tree nav + shares request loop ([27ec46d](https://github.com/mlnl221/nicotineHub/commit/27ec46d4757173c0eefd1c8ff1a42113dd855da3))
* **browse:** keyboard tree nav + shares request loop ([d9b0382](https://github.com/mlnl221/nicotineHub/commit/d9b0382e3f95f8abac8140e86beceb1d21c3a9b6))
* **browse:** match Nicotine+ peer framing and share-list protocol ([09b94b3](https://github.com/mlnl221/nicotineHub/commit/09b94b3f5f2f1ee99339757907c269c4a28fe6e9))
* **browse:** serve first inbound SharedFileListRequest, don't self-throttle ([2a281cd](https://github.com/mlnl221/nicotineHub/commit/2a281cdb795d8930d654e1f8aec045ac0b499f75))
* **chat:** drop wire TYPING, CTCP VERSION parity, single-line chat logs ([3f08e19](https://github.com/mlnl221/nicotineHub/commit/3f08e19aec417f2ac3102b313f5b62016fa92b58))
* **shares:** commit exact saved snapshot, add share-as picker on files ([ea0359a](https://github.com/mlnl221/nicotineHub/commit/ea0359a1cd27b375143b09aaaccebc78a3ad8006))
* **web:** add missing next/image import in UserProfileSection ([3125ea9](https://github.com/mlnl221/nicotineHub/commit/3125ea9fb9abd442cef8c5cddbec0c911f74301d))
* **web:** add missing next/image import in UserProfileSection ([eb4f752](https://github.com/mlnl221/nicotineHub/commit/eb4f752004ab219bc27bc9e727307ab291bc053f))
* **web:** bulk-selection audit findings ([e800846](https://github.com/mlnl221/nicotineHub/commit/e800846fa95d735661f057b6ee9423f37894d34f))
* **web:** still attach to logged-in singleton when auto_connect_startup is false ([5774fca](https://github.com/mlnl221/nicotineHub/commit/5774fcae507f403b3833cc42853a432adcdc31c9))

## [0.32.0](https://github.com/mlnl221/nicotineHub/compare/v0.31.0...v0.32.0) (2026-09-07)


### Features

* **demo:** mock leech_detector plugin so leecher settings render ([0631fa0](https://github.com/mlnl221/nicotineHub/commit/0631fa025493ceff752622cbe397d4bffa23f487))
* **leecher:** port Anti-Leecher ProveIt + Leecher settings tab ([7820dcf](https://github.com/mlnl221/nicotineHub/commit/7820dcf66d8bff39d3dbd9d7496e9edc5ecf31c5))
* **leecher:** port Anti-Leecher ProveIt + Leecher settings tab ([4e527dc](https://github.com/mlnl221/nicotineHub/commit/4e527dcd4f1c9ebff126b386ce88e0acfcb1002f))
* **leecher:** sane defaults 10 files / 1 folder, slider capped at 1000 ([87d668f](https://github.com/mlnl221/nicotineHub/commit/87d668f67afd4cab1a462fda786e444c761f2e8d))
* **onboarding:** first-run setup wizard ([11125a3](https://github.com/mlnl221/nicotineHub/commit/11125a386fd6391b0c01884e390c133ddabb867e))
* **onboarding:** first-run setup wizard (shares, leechers, captcha, appearance, keys) ([fd34f24](https://github.com/mlnl221/nicotineHub/commit/fd34f248c2dc047f2adcc80f5eef6813d02483b2))
* **onboarding:** include demo mode, leecher copy 10/1 ([49e7136](https://github.com/mlnl221/nicotineHub/commit/49e71363ae28887d642f1b2283e99ecb6ba15c40))
* **search:** add Hide-private toggle to /search header, persist default, mock private rows in demo ([2679256](https://github.com/mlnl221/nicotineHub/commit/2679256ec5c2bc9da606e4dc76e76cc2917b4e79))
* **search:** sticky zero-tab filter draft seeds next search ([b97c6d2](https://github.com/mlnl221/nicotineHub/commit/b97c6d29fc336248e3067b4011cb3a9cff2fd856))
* **search:** sticky zero-tab filter draft seeds next search ([cab626c](https://github.com/mlnl221/nicotineHub/commit/cab626c9e3ae5045b43cf60ae0cf3467bd10bce8))

## [0.31.0](https://github.com/mlnl221/nicotineHub/compare/v0.30.1...v0.31.0) (2026-09-06)


### Features

* **chat:** backfill room + private history from disk logs on join ([e0b1b3c](https://github.com/mlnl221/nicotineHub/commit/e0b1b3cf07aced8e5c275b60268b6a02988121b9))

## [0.30.1](https://github.com/mlnl221/nicotineHub/compare/v0.30.0...v0.30.1) (2026-09-06)


### Bug Fixes

* **docker:** handle multi-line tags in merge imagetools step ([d35dc1d](https://github.com/mlnl221/nicotineHub/commit/d35dc1d1d81dc1a6ba39488b201ad3c3e156d326))
* **docker:** handle multi-line tags in merge imagetools step ([944ed9a](https://github.com/mlnl221/nicotineHub/commit/944ed9aac840bd6dd48d5e7d693fc524daa1f68b))

## [0.30.0](https://github.com/mlnl221/nicotineHub/compare/v0.29.0...v0.30.0) (2026-09-06)


### Features

* **files:** remove ALLOWED_ROOTS gate, serve any mounted path ([56319ec](https://github.com/mlnl221/nicotineHub/commit/56319ec49c2a17a40f0d2803860123525397118d))
* **files:** remove ALLOWED_ROOTS gate, serve any mounted path ([6605c29](https://github.com/mlnl221/nicotineHub/commit/6605c293f0c38e7d81e933d89ec8f96f987373ab))
* **profile:** My profile button, description empty-state, avatar hover preview + lightbox ([10f6954](https://github.com/mlnl221/nicotineHub/commit/10f69546d6fe3b1895d138eedf0d610379eaf684))
* **profile:** My profile button, description empty-state, avatar hover preview + lightbox ([468bb90](https://github.com/mlnl221/nicotineHub/commit/468bb90a9928a9203996fa348e67a9d62b185dea))


### Bug Fixes

* **uploads:** resolve share virtual2real in startUploadStream for any mounted path ([91c4d2e](https://github.com/mlnl221/nicotineHub/commit/91c4d2e7e7ce53eb15b1a334dacda0fec3a1eeda))

## [0.29.0](https://github.com/mlnl221/nicotineHub/compare/v0.28.2...v0.29.0) (2026-09-06)


### Features

* **bridge,web:** shared singleton server login for all LAN clients ([a55a32d](https://github.com/mlnl221/nicotineHub/commit/a55a32dad2f29893d66e657689dfb0bc0320beb3))
* **bridge,web:** shared singleton server login for all LAN clients ([bccc8e4](https://github.com/mlnl221/nicotineHub/commit/bccc8e4d34f8bc4c413e3be8e3b12e4d45845d92))


### Bug Fixes

* **shared-session:** close stale-flag, duplicate-reply and compat gaps ([d753f3b](https://github.com/mlnl221/nicotineHub/commit/d753f3b9e7dbbaaa68d0bb2c1f93e140acd129f7))
