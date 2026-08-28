# Search Filters — Full Parity Reference

nicotine filters results **client-side** with a set of free-text expression filters (not
separate min/max number fields). This is the exact behavior to replicate. The web app
applies these after ingesting a `search:result` batch.

Filter state is a dict with keys:
`filterin, filterout, filtersize, filterbr, filterlength, filtercc, filtertype, filterslot, filterpublic`.

There are **no Apply/Reset buttons** — filtering is **live** on every keystroke / combobox
selection. A single "Clear Filters / Restore Filters" toggle swaps between empty and the
previous set. Invalid regex paints the field with an error style.

---

## 1. Include / Exclude text — `filterin` / `filterout`

- Case-insensitive **regex**. Multiple alternatives joined by `|`, `&`, or space
  (`FILTER_SPLIT_TEXT_PATTERN`).
- Matched against the **file path** (and, as a full-match fallback, the **username**).
- `filterin` passes only if the regex matches the path (or username).
- `filterout` fails if the regex matches the path (or username).
- **Distinct from the search-box `-word` syntax:** the `-word` exclusion happens at the
  *query* level (stripped before transmit, reapplied to rows). The filter bar uses full
  regex on already-returned rows.
- Examples: `long trail\|till we meet again`, `live`.

## 2. File size — `filtersize`

- Operators: `<`, `<=`, `==`, `!=`, `>=`, `>`; bare `=`/`!` map to `==`/`!=`; bare value
  defaults to `>=`. Multiple conditions split by `| & space` and combined (AND/OR).
- Units via `factorize`: `k/m/g` = binary KiB/MiB/GiB by default; trailing `i` forces
  binary, trailing `B` forces decimal (e.g. `>50MiB`, `<1g`). Approximate tolerance
  (±0.1 MiB, or ±1 MiB above 100 MiB).
- Examples: `>10.5m <1g`, `>50MiB`.

## 3. Bitrate — `filterbr` (Kb/s)

- Same operator syntax as size. Integer.
- Examples: `256 <1412`, `>192 <320`, `=320`, `>320`, `!0` (non-zero).

## 4. Duration / Length — `filterlength`

- Same operator syntax. Value is seconds, **or** `HH:MM:SS` / `MM:SS` (converted to
  seconds). `!MM:SS` excludes that exact length.
- Examples: `>6:00 <12:00 !6:54`, `>15:00`.

## 5. File type — `filtertype`

- Space/`|`/`&`-separated extensions or **generic** names; `!ext` excludes.
- Generic names expand via `FILTER_GENERIC_FILE_TYPES`:
  `audio`, `image`, `video`, `document`, `text`, `archive`, `executable`.
  (There is **no** "any / software / other / folders" option — absence of a filter = all
  types.)
- Examples: `flac wav`, `!mp3 !m4a`, `audio image text`.

## 6. Country — `filtercc`

- Space/`|`/`&`/`,`/`;`-separated ISO codes; `!XX` excludes that country.
- Examples: `US ES`, `!DE !GB`.

## 7. Free slot — `filterslot` (toggle)

- If enabled, hide rows where `in_queue > 0` (i.e. keep only peers with a free upload
  slot).

## 8. Public only — `filterpublic` (toggle)

- If enabled, hide rows from private shares (`private == false`).

---

## Filter presets (`FILTER_PRESETS`)

Offered as the first combobox items:

- **Bitrate:** `("!0", "128 <=192", ">192 <320", "=320", ">320")`
- **Size:** `(">50MiB", ">20MiB <=50MiB", ">10MiB <=20MiB", ">5MiB <=10MiB", "<=5MiB")`
- **File type:** `("audio", "image", "video", "document", "text", "archive", "!executable", "audio image text")`
- **Length:** `(">15:00", ">8:00 <=15:00", ">5:00 <=8:00", ">2:00 <=5:00", "<=2:00")`

---

## Defaults (`config.sections["searches"]` in nicotine)

| Key | Default | Meaning |
|-----|---------|---------|
| `enablefilters` | False | apply default filter set on new searches |
| `defilter` | `[]` | default filter values |
| `filtercc` / `filterin` / `filterout` / `filtersize` / `filterbr` / `filtertype` / `filterlength` | `[]` | per-filter defaults |
| `private_search_results` | False | whether to show private shares (gates the public-only toggle) |
| `max_displayed_results` | 2500 | display cap per search |
| `maxresults` | 300 | (only relevant if we *answer* searches) |
| `min_search_chars` | 3 | (relevant if we answer searches) |
| `enable_history` | True | persist search history |
| `history` | `[]` | recent terms (cap 200) |

`RESULT_FILTER_HISTORY_LIMIT = 50` — per-filter combobox history.
