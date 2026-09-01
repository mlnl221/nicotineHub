# Attribution & Thanks

> SPDX-License-Identifier: GPL-3.0-or-later

This project — **Nicotine Hub** — would not exist without the
[nicotine-plus](https://github.com/nicotine-plus/nicotine-plus) community and the
decades of Soulseek reverse-engineering that preceded it.

---

## 1. License

**Nicotine Hub is licensed under the GNU General Public License v3.0 or later
(`GPL-3.0-or-later`).** See [`COPYING`](./COPYING) and
[`LICENSES/GPL-3.0-or-later.txt`](./LICENSES/GPL-3.0-or-later.txt).

```
Copyright (C) 2025-2026 Nicotine Hub Contributors
Copyright (C) 2001-2026 Nicotine+, Nicotine and PySoulSeek Contributors
```

By publishing this repository we retroactively license all prior commits under the
same `GPL-3.0-or-later`. If you received an earlier copy without a `COPYING` file,
that copy is now offered under `GPL-3.0-or-later` as well.

Other assets licensed separately:

* `LICENSES/CC0-1.0.txt` — CC0 1.0 Universal (where noted)
* `LICENSES/CC-BY-SA-4.0.txt` — CC BY-SA 4.0 (e.g. protocol illustrations, if reused)
* `LICENSES/MIT.txt` — MIT (upstream build tooling that documents MIT)

Our dependencies (`Next.js`, `Bun`, `zod`, `sharp`, `music-metadata`, `comlink`,
`Tailwind`) are MIT / Apache-2.0 / BSD — all `GPL-3.0-or-later`-compatible for a
combined work.

---

## 2. Thank You — Nicotine+

Huge thanks to the **Nicotine+ Team** and every contributor listed in
[`~/projects/nicotine-plus/AUTHORS.md`](https://github.com/nicotine-plus/nicotine-plus/blob/master/AUTHORS.md)
(and `pynicotine` SPDX headers):

* **Maintainers:** Mat (mathiascode, 2020–present), Adam Cécile (eLvErDe, 2013–2016),
  daelstorm (2004–2009), quinox (2009–2012), Michael Labouebe (gfarmerfr, 2016–2017),
  Kip Warner (2018–2020) — and the Emeritus team (Heather, Mutnick, Lene Preuss, etc.).
* **Core lineage:** [Hyriand](https://github.com/nicotine-plus/nicotine-plus) / Ingmar K. Steen
  (Nicotine 2003–2004), **Alexander Kanavin** (PySoulSeek 2001–2003, the original
  Soulseek protocol implementation in Python), and `pynicotine/slskmessages.py`
  contributors `quinox`, `daelstorm`, `Hyriand`.
* **Community:** testers, translators (Weblate), packagers, IRC `#nicotine+` on
  Libera.Chat, and everyone who documented the protocol in
  [`doc/SLSKPROTOCOL.md`](https://github.com/nicotine-plus/nicotine-plus/blob/master/doc/SLSKPROTOCOL.md).

If Nicotine+ helped you, please consider
[contributingupstream](https://github.com/nicotine-plus/nicotine-plus/blob/master/CONTRIBUTING.md),
testing a release candidate, or translating the client.

We commit to **coordination**: this client uses experimental major version
`177/1` (`apps/bridge/src/soulseek.ts:191`) and will never reuse a reserved
major version. We do not extend the Soulseek protocol without Soulseek
administrators’ approval (see `SLSKPROTOCOL.md` preamble).

Repo pinned at `nicotine-plus@8d81e66` (2026-08-28). Source:
`https://github.com/nicotine-plus/nicotine-plus` — `COPYING` (GPL-3.0-or-later).

---

## 3. Soulseek

Soulseek is a proprietary peer-to-peer network and server at
`server.slsknet.org:2242` operated by Soulseek volunteers — **not affiliated**
with Nicotine Hub or Nicotine+. Trademark “Soulseek” belongs to its owners;
use here is nominative fair use (“Soulseek-compatible client for the Soulseek
network”).

* Rules: <https://www.slsknet.org/news/node/681>
* Terms of Service: <https://www.slsknet.org/news/node/682>
* Protocol docs: `doc/SLSKPROTOCOL.md` (GPL-3.0-or-later, compiled by years of
  reverse engineering — thanks to nicotine-plus authors).

**Security notice:** Soulseek is an **unencrypted, plaintext-password** protocol
(see `README.md` Security). We never store passwords; use credentials you trust.

---

## 4. What We Reused From Nicotine+

We built the bridge as a **1:1 TypeScript port** of nicotine-plus semantics so
behavior stays compatible. Where we ported code, we kept nicotine-plus copyright
and added our own (dual `SPDX-FileCopyrightText` headers). Where we only reused
ideas/spec, we still credit the source.

| Nicotine Hub file | nicotine-plus source(s) | Kind |
|---|---|---|
| `apps/bridge/src/soulseek.ts` | `pynicotine/slskmessages.py` + `pynicotine/slskproto.py` + `doc/SLSKPROTOCOL.md` | **Full port** — codes, framing `[len][code][payload]`, packing LE, zlib caps (16M/128M), `>2GiB` sentinel, obfuscation |
| `apps/bridge/src/session.ts` | `pynicotine/slskproto.py`, `pynicotine/transfers.py`, `pynicotine/shares.py` | **Heavily derived** — socket state machine, `PeerInit`/`PierceFireWall`, `GetPeerAddress` cache, distrib leaf |
| `apps/bridge/src/transfers.ts` | `pynicotine/downloads.py`, `pynicotine/transfers.py`, `pynicotine/slskmessages.py` | **Port** — queue, `INCOMPLETE<md5>`, throttling, `SendUploadSpeed 121`, `downloads.json` |
| `apps/bridge/src/shares.ts` | `pynicotine/shares.py` | **Port** — scan, `ShareDB`, `SharedFileListResponse 5` / `FolderContents 37` |
| `apps/bridge/src/networkfilter.ts` | `pynicotine/networkfilter.py` | **Port** |
| `apps/bridge/src/statistics.ts` | `pynicotine/transfers.py:Statistics` | **Port** |
| `apps/bridge/src/plugins/types.ts` | `pynicotine/pluginsystem.py:31` `BasePlugin` / `returncode` | **Full port** |
| `apps/bridge/src/plugins/manager.ts` | `pynicotine/pluginsystem.py` | **Heavily derived** |
| `apps/bridge/src/plugins/builtin/spamfilter.ts` | `pynicotine/plugins/spamfilter/__init__.py` | **Full port** |
| `apps/bridge/src/plugins/builtin/core_commands.ts` | `pynicotine/plugins/core_commands/__init__.py` | **Derived** (minimal `/help`+`/plugin`) |
| `docs/settings-mapping.md` + `apps/web/src/lib/config/defaults.ts` | `pynicotine/config.py:156` defaults, `gtkgui/dialogs/preferences.py:3764`, `ui/settings/*.ui` | **Derived mapping** |
| `apps/bridge/src/spectrum.ts` | `smokin-salmon/smoked-salmon` `src/salmon/uploader/spectrals.py` (Apache-2.0) — sox spectrogram `2000×513` + `500×1025` Kaiser `-z 120` + `oxipng -o 2` | **Port** — sox Full/Zoom + oxipng, `/tmp` ephemeral cache |
| `docs/architecture.md` + `docs/plugins.md` | `doc/SLSKPROTOCOL.md`, `pynicotine/*` | **Documentation** derived |

All other web UI (`apps/web/src/app`, `components`) is original but, as part of the
combined `compose.yaml` distribution, is also offered under `GPL-3.0-or-later`.

---

## 5. How to Comply If You Fork/Distribute

1. Keep `COPYING` + `LICENSES/GPL-3.0-or-later.txt` and SPDX headers.
2. Keep this `ATTRIBUTION.md` (or equivalent credit to Nicotine+).
3. Provide source (link to your GitHub fork is enough; Docker images should `COPY COPYING`).
4. License your derivative under `GPL-3.0-or-later` (or a later GPL version, per `GPL §14`).
5. Do not claim endorsement by Nicotine+ or Soulseek.

No separate agreement is needed — GPL is the agreement.

---

## 6. Contact

* Nicotine Hub: <https://github.com/mlnl221/nicotineHub> (issues / PRs)
* Nicotine+: <https://github.com/nicotine-plus/nicotine-plus> — `AUTHORS.md`, `#nicotine+` IRC
* Soulseek: <https://www.slsknet.org/>

Thank you to every contributor who made Soulseek interop possible.
