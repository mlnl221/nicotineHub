# Search — Wire Protocol

Reference: nicotine-plus `doc/SLSKPROTOCOL.md`. All multi-byte integers are
little-endian. The bidirectional stream is framed as `[uint32 len][uint32 code][payload]`.

## Search-related server message codes
| Code | Name | Dir | Notes |
|------|------|-----|-------|
| 1 | `FileSearch` | C→S | `uint32 token`, `string query` (utf-8, no terminator) |
| 2 | `SetWaitPort` | C→S | `uint32 port` — advertise inbound peer port |
| 9 | `FileSearchResponse` | S→C / peer | `string user`, `uint32 ticket`, `FileList` |
| 18 | `ConnectToPeer` | S→C | `uint32 token`, `string user`, `ip`, `uint32 port`, `byte type` |
| 0 | `PierceFireWall` | peer | `uint32 token` (first thing sent by the connecting side) |

## Search request
`FileSearch` (1) is sent to the server with a fresh random `token`. The server turns
that token into a distributed ticket and broadcasts it. Replies use the same ticket as
their `SearchRequest`/`ticket` field so the bridge can route by `searchId`.

## FileSearchResponse (9) payload
```
string  username
uint32  ticket
uint32  file_count          (number of files in the list)
repeat file_count:
  string  filename           (full path, e.g. "shared/Music/album/track.flac")
  uint64  size
  uint32  ext_count
  repeat ext_count:
    uint32  attribute_type
    uint32  attribute_value
uint32  locked_file_count    (nicotine extension; may be 0 or absent)
... locked entries ...
uint8   result_type          (0 = file results, 1 = folder counts, 2 = ...)
uint32  avg_bitrate          (optional)
```
The bridge parses this, maps each filename to a `SearchRow` (`fileType` = extension),
reads attributes (bitrate=0, length=1, vbr=2, sample_rate=4, bit_depth=5), and groups by
`username`. A `result_type` indicating private/filtered shares marks rows `private`.

## PeerInit framing (critical)
When a peer connects to our inbound listener, the **first** message is `PeerInit`:
```
uint32  len            // length of the rest
uint8   code           // 1 = PeerInit
uint32  protocol_len
string  protocol       // "Soulseek"
uint32  min_version
uint32  version
string  username
```
Note the code is a **single uint8**, not uint32 — this differs from normal peer messages,
which use `[uint32 len][uint32 code]`. The bridge's `frameInitMessage` writes this; the
session reads the init frame (uint8 code) then switches to the standard uint32-code
framing for subsequent peer messages.

## ConnectToPeer relay (18)
When another peer wants to send us a result but cannot reach our listener, it asks the
server to relay. The server sends us `ConnectToPeer` (18) with a `token`, the peer's
`user`, `ip`, `port`, and `type` (`'F'` for file search). If **we** are the target, we
open a socket to that `ip:port` and send `PierceFireWall` (0) with the same `token`. The
peer then sends `FileSearchResponse` (9) over that connection. The bridge handles both
directions (inbound listener + outbound `PierceFireWall`).

## Compression
Large `FileSearchResponse` payloads are zlib-compressed (`0x78` magic). The bridge
inflates before parsing.
