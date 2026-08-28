# Search — Filters

The web client mirrors nicotine's filter syntax exactly (`apps/web/src/lib/filter.ts`,
`applyFilters`). Filters are per-tab and applied client-side over the streamed rows.

## Filter fields (`FilterState`)
| Field | Maps to nicotine | Syntax |
|-------|------------------|--------|
| `include` | "Include text" | JS regex (case-insensitive). Row kept only if filename matches. |
| `exclude` | "Exclude text" | JS regex. Row dropped if filename matches. |
| `fileType` | "File type" | space-separated tokens, `\|` separates alternatives, `!` negates. `any` matches all. |
| `size` | "File size" | `<`/`>`/`<=`/`>=` + number + unit (`b k m g t`). e.g. `>10.5m <1g`. |
| `bitrate` | "Bitrate" | same operators, number + `kbps` optional. e.g. `256 <1412`. |
| `length` | "Duration" | `<`/`>`/`<=`/`>=` + `M:SS`. e.g. `>6:00 <12:00`. |
| `country` | "Country code" | 2-letter codes, `\|` alternatives, `!` negates. (Bridge does not yet supply country; filter is wired but inert.) |
| `freeSlot` | "Free slot only" | boolean. Drops rows where `slotFree` is false. |
| `publicOnly` | "Public files only" | boolean. Drops rows where `private` is true. |

## fileType tokens
`audio video image document archive exe any` — matched against the file extension
(`mp3 flac wav …`, `mp4 mkv …`, etc.). Defaults to `any` when empty.

## Examples
- FLAC only, >50 MB, free slot: `fileType=flac`, `size=>50m`, `freeSlot=true`
- Live recordings, exclude "studio": `include=live`, `exclude=studio`
- 44.1 kHz 16-bit CD audio: `bitrate=1411` (or `bitrate=1411kbps`)
- Long videos under 2 GB: `fileType=video`, `size=<2g`, `length=<180:00`

## Notes
- `include`/`exclude` are treated as regular expressions; invalid regex falls back to "no
  constraint" (safe) rather than throwing.
- Size/bitrate/length comparisons accept `>`, `>=`, `<`, `<=`; bare numbers mean exact
  equality (rarely useful).
- `country` requires the bridge to attach a country code to each row; until that is added
  the filter is accepted but never filters anything out.
