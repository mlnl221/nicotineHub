# Changelog

## [0.3.0](https://github.com/mlnl221/nicotineHub/compare/v0.2.1...v0.3.0) (2026-09-03)


### Features

* **bulk:** multi-select + bulk tag/verify/analyze/spectrum/scrape (Files/Downloads/Uploads) ([668e013](https://github.com/mlnl221/nicotineHub/commit/668e0131286e2d5f917a1f0d4a25bb5febe0417b))
* **bulk:** multi-select + bulk worker ops (Files/Downloads/Uploads) ([045e62e](https://github.com/mlnl221/nicotineHub/commit/045e62e114f57b368192a9e543a1430b9f7ec7ad))
* **worker,ui:** tagging separation — worker owns tag read/write/scrape, bridge SLSK-only ([ca4eb6b](https://github.com/mlnl221/nicotineHub/commit/ca4eb6b1a1218247a301eb8e5a21f5c6750523a6))
* **worker,ui:** tagging separation — worker owns tag read/write/scrape, bridge SLSK-only ([652245b](https://github.com/mlnl221/nicotineHub/commit/652245b9cbdb81a45ad16081167a309e333a8c5e))
* **worker:** python FastAPI service for scrape/spectrum/tag, bridge stays SLSK-only ([945f26c](https://github.com/mlnl221/nicotineHub/commit/945f26cdb41dc306084cdaaaff459d5f9b4a5b76))
* **worker:** Settings Worker section + token flow (env &gt; worker.json) ([3b8ff81](https://github.com/mlnl221/nicotineHub/commit/3b8ff8164ff535788619acb9a78efa834d36e159))


### Bug Fixes

* **auth:** handle BANNED silent close, stop auto-retry, keep 177/1 experimental ([3555da7](https://github.com/mlnl221/nicotineHub/commit/3555da734c4c7e0d242da696aab66a51b0ac2658))
* **auth:** handle BANNED silent close, stop auto-retry, keep 177/1 experimental ([81c8d97](https://github.com/mlnl221/nicotineHub/commit/81c8d9715dbbf4ad92cbe092d6a6aa95926ff2cc))
* background reconnect, profile cache, chat nicotine design, port checker ([364da5c](https://github.com/mlnl221/nicotineHub/commit/364da5c33eb1a218c940210054097b83967473bf))
* bridge URL resolution + room-list parse/subscribe race ([f70f9e3](https://github.com/mlnl221/nicotineHub/commit/f70f9e3041c2d4c7b3a7851e73abf5fbae638a96))
* bridge URL resolution + room-list parse/subscribe race ([ef22c52](https://github.com/mlnl221/nicotineHub/commit/ef22c5234d2dd3b4950c7f048fd44cc421abf96b))
* **bridge+session:** keep WS open during transient Soulseek DNS failures ([d4b946f](https://github.com/mlnl221/nicotineHub/commit/d4b946fa6982256317d82a0493d1567956758535))
* **browse:** fast-fail offline/firewalled peers, clearer timeout ([5661894](https://github.com/mlnl221/nicotineHub/commit/566189445bfeaba4d2759f0bfe7fae3e431a692b))
* **buddies/browse:** phases H-J — buddies purge, even/odd rows, single dropdown ([9762d79](https://github.com/mlnl221/nicotineHub/commit/9762d79497bd845247d14188696c4d6a547a06f7))
* **chat:** nicotine-plus room list, dark brighter, system/own messages, shares ([adfcaa3](https://github.com/mlnl221/nicotineHub/commit/adfcaa328fba9b87d7fdb12dd89c55f622fac8a8))
* **demo/files:** phases A-C — demo banner hidden by default, files info hover + start /data, browse up to / ([aecb9bf](https://github.com/mlnl221/nicotineHub/commit/aecb9bfc4d58c2f33d29cce44eed2054d8dab10a))
* **diagnostics:** make PortChecker reachable via WS URL fallback and token ([99367f0](https://github.com/mlnl221/nicotineHub/commit/99367f0525cdacd647da8933e919b04340099f37))
* **downloads/chat:** phases E-G — remove uploads from downloads, throughput flush, chat dropdown sorted ([7da5ed3](https://github.com/mlnl221/nicotineHub/commit/7da5ed30348b3b0bef8764bd446eb3f41b7a0349))
* **makefile:** respect NEXT_PUBLIC_BRIDGE_URL in dev and clarify run ([38b10fa](https://github.com/mlnl221/nicotineHub/commit/38b10fa52ffb92e59cae2a45c752e1bdc5db1c1b))
* **profile:** cache loaded profiles, avoid slsk refetch on tab switch ([11dfce8](https://github.com/mlnl221/nicotineHub/commit/11dfce8e212ac3e160546caf10976d8acb13671b))
* **search/browse:** phases R-T — keep tabs alive, cache + reload, slidable ([f7f524e](https://github.com/mlnl221/nicotineHub/commit/f7f524e6e947577ed45d539c5c95a952b84f350c))
* **session:** background reconnect with subtle banner, no fullscreen spinner ([ce18031](https://github.com/mlnl221/nicotineHub/commit/ce180319312d727f5150f2c69c9bdd2d2e865aad))
* **settings/context:** phases K-M — contextmenu bottom-up, settings info hover + gap-6 ([09b3f16](https://github.com/mlnl221/nicotineHub/commit/09b3f16f14748bb730808fc88280fa9df7a0c59d))
* **settings:** phase U — gate beforeunload on unsaved, default exitdialog 0 ([cac1884](https://github.com/mlnl221/nicotineHub/commit/cac18841aa0570815fb7ade53555243dcee1552a))
* **transfers:** progress stub must never fake Finished (shipped synth sine as user files) ([c6a6572](https://github.com/mlnl221/nicotineHub/commit/c6a657220e326df3377613ed7386c3bfcf2d697d))
* **typecheck:** ponytail minimal — make typecheck pass ([295a836](https://github.com/mlnl221/nicotineHub/commit/295a83681a0fcf97490b0c6c879415b392c1e54a))
* **typecheck:** ponytail minimal — make typecheck pass ([30cad89](https://github.com/mlnl221/nicotineHub/commit/30cad893b6d37984883618dc1d5140fb805be5cb))
* **ui/demo:** phases N-P — username link, search mobile flush, demo pill floating ([5070093](https://github.com/mlnl221/nicotineHub/commit/50700939f2fe30b4a9b05b4cf2f38bf01fe83c7f))
