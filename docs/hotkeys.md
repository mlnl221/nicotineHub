# Keyboard shortcuts

Global Gmail-style hotkeys for the web UI. Press `?` anywhere to show the same list in-app.

Keys are ignored while typing in a text field (except `Ctrl+K`). `Esc` closes the help overlay and other dialogs.

## Go to pages

| Keys | Action |
| --- | --- |
| `g` then `s` | Search |
| `g` then `d` | Downloads |
| `g` then `u` | Uploads |
| `g` then `f` | Files |
| `g` then `c` | Private Chat |
| `g` then `b` | Browse |
| `g` then `e` | Buddies |
| `g` then `r` | Chat Rooms |
| `g` then `i` | Profiles |
| `g` then `,` | Settings |
| `Alt+1…5` | Search / Downloads / Uploads / Files / Private Chat |

Press the second key within ~1s of `g`.

## Search

| Keys | Action |
| --- | --- |
| `/` or `Ctrl+K` | Focus the search field (jumps to `/search` if none on screen) |
| `s` | Stop the active search |
| `Shift+S` | Retry the active search tab |

## Transfers

| Keys | Action |
| --- | --- |
| `p` | Pause all active downloads |
| `r` | Resume / retry all paused downloads |
| `Delete` (`Backspace` works too) | Clear finished transfers (same sets as the Clear Finished toolbar buttons) |

Upload abort-all is intentionally not bound — aborting uploads is destructive, use the per-page Select + Abort toolbar.

## Lists

| Keys | Action |
| --- | --- |
| `j` / `k` | Move selection down / up in Downloads, Uploads and Files (select mode), same as `↑` / `↓`. `Shift` extends the range. |

## Help

| Keys | Action |
| --- | --- |
| `?` | Show / hide the shortcuts overlay |
| `Esc` | Close overlay |

Source: `apps/web/src/components/Hotkeys.tsx` (`HOTKEY_LIST` is the in-app list — keep this page in sync with it). List-stepping helper: `stepSelectionKey` in `apps/web/src/lib/bulkSelection.ts`.
