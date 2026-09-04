"use client";

// Anime cat avatars — small 128x128 PNGs for demo users (jazzcat/vinyl_hunter)

// ponytail: SVG initials for all (PNG bloat removed, use /avatars/*.png if needed)
export function avatarBase64(username: string): string {
  const hue = Math.abs(hash(username)) % 360;
  const bg = `hsl(${hue} 70% 45%)`;
  const initials = username.slice(0, 2).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="64" fill="${bg}"/><text x="64" y="74" text-anchor="middle" font-family="Inter, sans-serif" font-size="42" font-weight="700" fill="white">${initials}</text></svg>`;
  if (typeof window !== "undefined" && window.btoa) return window.btoa(svg);
  return Buffer.from(svg).toString("base64");
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

function seededRand(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

// Demo usernames pool
export const DEMO_USERS = [
  "jazzcat",
  "vinyl_hunter",
  "beat_miner",
  "soulseeker99",
  "crate_digger",
  "analog_dreams",
  "mixtape_queen",
  "deepgroove",
  "echo_collector",
  "neon_vinyl",
];

export const DEMO_ROOMS = [
  { name: "Jazz", users: 842 },
  { name: "Electronic", users: 1203 },
  { name: "Hip-Hop", users: 954 },
  { name: "Rock", users: 678 },
  { name: "Classical", users: 321 },
  { name: "Soulseek", users: 2104 },
];

const SAMPLE_TITLES = [
  "Midnight Groove - Blue Note Session [FLAC]",
  "Dusty Fingers - Crate Diggers Vol.4",
  "Neon Horizons - Analog Dreams LP",
  "Summer Rain - Lo-Fi Beats To Study To",
  "Cosmic Dust - Stellar Voyage 320kbps",
  "Quiet Storm - Late Night Jazz Mix",
  "Golden Era - 90s Hip-Hop Essentials",
  "Crystal Clear - Ambient Textures",
  "Street Lights - Urban Soul Collection",
  "Velvet Morning - Acoustic Sessions",
  "Lost Tapes - Underground Archives",
  "Future Funk - Daft Side Of The Moon",
];

const FILE_TYPES = ["mp3", "flac", "wav", "ogg", "aac"];

export function mockSearchRows(query: string, _mode?: string): import("@/lib/protocol").SearchRow[] {
  const seed = Math.abs(hash(query.toLowerCase().trim() || "demo"));
  const rnd = seededRand(seed);
  const count = 12 + Math.floor(rnd() * 18); // 12-30 rows
  const qWords = query ? query.toLowerCase() : "music";
  const rows: import("@/lib/protocol").SearchRow[] = [];
  for (let i = 0; i < count; i++) {
    const user = DEMO_USERS[Math.floor(rnd() * DEMO_USERS.length)];
    const title = SAMPLE_TITLES[Math.floor(rnd() * SAMPLE_TITLES.length)];
    // Inject query into some titles
    const filename =
      rnd() < 0.6 ? `${qWords} - ${title}` : title;
    const ext = FILE_TYPES[Math.floor(rnd() * FILE_TYPES.length)];
    const fullName = `${filename}.${ext}`;
    const folder = `C:\\Users\\${user}\\Music\\${query ? query : "Collection"}`;
    const path = `${folder}\\${fullName}`;
    const size = Math.floor(5_000_000 + rnd() * 150_000_000);
    const bitrate = ext === "flac" || ext === "wav" ? 0 : [128, 192, 256, 320][Math.floor(rnd() * 4)];
    const length = Math.floor(90 + rnd() * 400);
    const isLossless = ext === "flac" || ext === "wav";
    rows.push({
      user,
      folder,
      filename: fullName,
      path,
      size,
      fileType: ext,
      slotFree: rnd() > 0.35,
      speed: Math.floor(50_000 + rnd() * 2_000_000),
      inQueue: Math.floor(rnd() * 20),
      quality: bitrate,
      length,
      private: false,
      attributes: {
        bitrate: bitrate || undefined,
        length,
        vbr: rnd() > 0.7 ? 1 : 0,
        sampleRate: isLossless ? (rnd() > 0.5 ? 44100 : 96000) : undefined,
        bitDepth: isLossless ? (rnd() > 0.5 ? 16 : 24) : undefined,
      },
    });
  }
  return rows;
}

export function mockBrowseFolders(username: string): import("@/lib/protocol").BrowseFolder[] {
  const seed = Math.abs(hash(username.toLowerCase()));
  const rnd = seededRand(seed);
  // include nested sub-directories to demonstrate tree handling (jazzcat has Blue Note + Live, Electronic has Acid)
  // Added Live Bootlegs/2023 as requested — 2023 contains the bootleg files
  const folderNames = [
    `C:\\Users\\${username}\\Music\\Jazz`,
    `C:\\Users\\${username}\\Music\\Jazz\\Blue Note`,
    `C:\\Users\\${username}\\Music\\Jazz\\Live Bootlegs`,
    `C:\\Users\\${username}\\Music\\Jazz\\Live Bootlegs\\2023`,
    `C:\\Users\\${username}\\Music\\Electronic`,
    `C:\\Users\\${username}\\Music\\Electronic\\Acid`,
    `C:\\Users\\${username}\\Music\\Hip-Hop`,
    `C:\\Users\\${username}\\Music\\Soul`,
  ];
  return folderNames.map((name) => {
    const isLiveBootlegs = name.endsWith("\\Live Bootlegs");
    const is2023 = name.endsWith("\\Live Bootlegs\\2023");
    // Live Bootlegs parent is a container — keep minimal, files live in 2023
    const fileCount = isLiveBootlegs ? 0 : is2023 ? 6 + Math.floor(rnd() * 4) : 6 + Math.floor(rnd() * 8);
    const files: import("@/lib/protocol").BrowseFile[] = [];
    for (let i = 0; i < fileCount; i++) {
      let title: string;
      let ext: string;
      if (is2023) {
        // 2023 bootleg-specific titles
        const bootlegTitles = [
          `2023-05-15 - Live at Blue Note - Set ${i + 1}`,
          `2023-08-22 - Village Vanguard Night ${i + 1}`,
          `2023-11-03 - Jazz Festival Bootleg ${i + 1}`,
          `2023-03-10 - Late Night Session ${i + 1}`,
        ];
        title = bootlegTitles[i % bootlegTitles.length];
        ext = rnd() > 0.3 ? "flac" : "mp3";
      } else {
        title = SAMPLE_TITLES[Math.floor(rnd() * SAMPLE_TITLES.length)];
        ext = FILE_TYPES[Math.floor(rnd() * FILE_TYPES.length)];
      }
      const fileName = `${title}.${ext}`;
      const fullPath = `${name}\\${fileName}`;
      const size = Math.floor(3_000_000 + rnd() * 120_000_000);
      const bitrate = ext === "flac" ? 0 : 320;
      const length = Math.floor(120 + rnd() * 300);
      const attrs: Array<[number, number]> = [];
      if (bitrate) attrs.push([0, bitrate]);
      attrs.push([1, length]);
      if (rnd() > 0.5) attrs.push([4, 44100]);
      if (ext === "flac" && rnd() > 0.5) attrs.push([5, 16]);
      files.push({ name: fullPath, size, ext, attrs });
    }
    return { name, files };
  });
}

export interface MockProfileBundle {
  info: import("@/lib/protocol").UserInfoProfile;
  status: import("@/lib/protocol").UserInfoStatus;
  stats: import("@/lib/protocol").UserInfoStats;
  interests: import("@/lib/protocol").UserInfoInterests;
  country: string;
  watchUser: { exists: boolean; status: number; avgspeed: number; files: number; dirs: number; country: string };
}

const DESCRIPTIONS: Record<string, string> = {
  jazzcat: "Jazz collector since '98. Blue Note, Impulse, ECM. Trade lists welcome. https://example.com/jazzcat",
  vinyl_hunter: "Digging vinyl worldwide. FLAC preferred, 320 at least. Soul, funk, hip-hop.",
  default: "Soulseek veteran. Love sharing music. Feel free to browse my files!",
};

const COUNTRIES = ["US", "DE", "UK", "FR", "JP", "BR", "SE", "NL", "CA", "AU"];

export function mockProfile(username: string): MockProfileBundle {
  const seed = Math.abs(hash(username.toLowerCase()));
  const rnd = seededRand(seed);
  const country = COUNTRIES[Math.floor(rnd() * COUNTRIES.length)];
  const files = Math.floor(2000 + rnd() * 8000);
  const dirs = Math.floor(120 + rnd() * 400);
  const avgspeed = Math.floor(100_000 + rnd() * 2_500_000);
  const descr = DESCRIPTIONS[username.toLowerCase()] || DESCRIPTIONS.default + ` — ${username}'s shares: ${files} files.`;
  const likesPool = ["jazz", "hip-hop", "soul", "funk", "electronic", "ambient", "rock", "classical", "vinyl", "lo-fi", "blues", "house"];
  const likes = [...new Set(Array.from({ length: 3 + Math.floor(rnd() * 4) }, () => likesPool[Math.floor(rnd() * likesPool.length)]))];
  const hates = ["top40", "edm"].slice(0, rnd() > 0.7 ? 1 : 0);

  return {
    info: {
      username,
      descr,
      pic: avatarBase64(username),
      totalupl: Math.floor(rnd() * 500),
      queuesize: Math.floor(rnd() * 80),
      slotsavail: rnd() > 0.3,
      uploadallowed: Math.floor(rnd() * 3),
    },
    status: { username, status: [2, 2, 2, 1, 0][Math.floor(rnd() * 5)], privileged: rnd() > 0.8 },
    stats: { username, avgspeed, uploadnum: Math.floor(rnd() * 200), files, dirs },
    interests: { username, likes, hates },
    country,
    watchUser: {
      exists: true,
      status: rnd() > 0.2 ? 2 : rnd() > 0.5 ? 1 : 0,
      avgspeed,
      files,
      dirs,
      country,
    },
  };
}

export function mockRecommendations(): import("@/lib/protocol").Recommendation[] {
  return [
    { thing: "jazz", rating: 240 },
    { thing: "soul", rating: 198 },
    { thing: "hip-hop", rating: 176 },
    { thing: "ambient", rating: 154 },
    { thing: "funk", rating: 132 },
    { thing: "electronic", rating: 120 },
    { thing: "blues", rating: 98 },
  ];
}

export function mockSimilarUsers(): import("@/lib/protocol").SimilarUser[] {
  return DEMO_USERS.slice(0, 6).map((u, i) => ({ username: u, rating: 100 - i * 12 }));
}

// ------------------------------------------------------------------
// Demo seed constants — single source of truth for all demo fixtures
// ------------------------------------------------------------------
export const DEMO_SEARCH_QUERIES: readonly string[] = ["linux iso", "tails 5.2 iso"] as const;
export const DEMO_BROWSE_USERS: readonly string[] = ["jazzcat", "vinyl_hunter"] as const;
export const DEMO_PROFILE_USERS: readonly string[] = ["jazzcat", "vinyl_hunter"] as const;
export const DEMO_PRIVATE_CHAT_USERS: readonly string[] = ["jazzcat", "vinyl_hunter"] as const;
export const DEMO_BUDDY_USERS: readonly string[] = ["jazzcat", "vinyl_hunter"] as const;

export function mockBuddies(): import("@/lib/buddies").Buddy[] {
  // Two curated demo buddies — online, trusted, with notes
  const b = mockProfile("jazzcat");
  const v = mockProfile("vinyl_hunter");
  return [
    {
      username: "jazzcat",
      note: "Jazz archivist — great shares",
      trusted: true,
      notify: true,
      status: 2,
      privileged: b.status.privileged,
      country: b.country,
      avgspeed: b.stats.avgspeed,
      files: b.stats.files,
      dirs: b.stats.dirs,
    },
    {
      username: "vinyl_hunter",
      note: "Vinyl ripper — soul & hip-hop",
      trusted: true,
      notify: true,
      status: 2,
      privileged: v.status.privileged,
      country: v.country,
      avgspeed: v.stats.avgspeed,
      files: v.stats.files,
      dirs: v.stats.dirs,
    },
  ];
}

export const DEMO_SPECTRUM_TRANSFER_ID = "KernkraftDemo::Music\\12 Kernkraft 400 (DJ Gius Video Cut).flac";

export function mockDemoTransfers(): import("@/lib/protocol").Transfer[] {
  // One downloading, one uploading — both Transferring with animated progress
  const dlSize = 85_000_000; // ~85 MB
  const dlCurrent = Math.floor(dlSize * 0.44); // 44%
  const dlSpeed = 1_180_000; // ~1.1 MB/s
  const ulSize = 46_500_000; // ~46 MB
  const ulCurrent = Math.floor(ulSize * 0.68); // 68%
  const ulSpeed = 620_000;
  return [
    {
      id: "jazzcat::C:\\Users\\jazzcat\\Music\\Jazz\\linux iso - Midnight Groove - Blue Note Session [FLAC].flac",
      username: "jazzcat",
      virtualPath: "C:\\Users\\jazzcat\\Music\\Jazz\\linux iso - Midnight Groove - Blue Note Session [FLAC].flac",
      fileName: "linux iso - Midnight Groove - Blue Note Session [FLAC].flac",
      size: dlSize,
      current: dlCurrent,
      speed: dlSpeed,
      avgSpeed: 980_000,
      timeLeft: Math.ceil((dlSize - dlCurrent) / dlSpeed),
      status: "Transferring",
      queuePosition: null,
      isUpload: false,
    },
    {
      id: "vinyl_hunter::C:\\Users\\demo\\Shares\\Summer Rain - Lo-Fi Beats To Study To.mp3",
      username: "vinyl_hunter",
      virtualPath: "C:\\Users\\demo\\Shares\\Summer Rain - Lo-Fi Beats To Study To.mp3",
      fileName: "Summer Rain - Lo-Fi Beats To Study To.mp3",
      size: ulSize,
      current: ulCurrent,
      speed: ulSpeed,
      avgSpeed: 540_000,
      timeLeft: Math.ceil((ulSize - ulCurrent) / ulSpeed),
      status: "Transferring",
      queuePosition: null,
      isUpload: true,
    },
    {
      // VERCEL DEMO ONLY — fake completed FLAC for spectrum demo (no real .flac in repo, only pngs in public/demo-spectra)
      id: DEMO_SPECTRUM_TRANSFER_ID,
      username: "KernkraftDemo",
      virtualPath: "Music\\12 Kernkraft 400 (DJ Gius Video Cut).flac",
      fileName: "12 Kernkraft 400 (DJ Gius Video Cut).flac",
      size: 19630960,
      current: 19630960,
      speed: 0,
      avgSpeed: 0,
      timeLeft: null,
      status: "Finished",
      queuePosition: null,
      isUpload: false,
    },
  ];
}

export interface DemoPrivateMessage {
  id: string;
  username: string;
  message: string;
  timestamp: number;
  isSelf: boolean;
}

export function mockStats(): import("@/lib/statistics").StatsData {
  const nowSec = Math.floor(Date.now() / 1000);
  // Deterministic demo stats — mirrors pynicotine/transfers.py:Statistics shape
  return {
    since_timestamp: nowSec - 86400 * 17, // ~17 days ago
    started_downloads: 142,
    completed_downloads: 128,
    downloaded_size: 12_842_000_000, // ~12 GB
    started_uploads: 89,
    completed_uploads: 84,
    uploaded_size: 7_310_000_000, // ~7.3 GB
  };
}

export function mockSessionStats(): import("@/lib/statistics").StatsData {
  const nowSec = Math.floor(Date.now() / 1000);
  return {
    since_timestamp: nowSec - 3600 * 3, // session ~3h
    started_downloads: 7,
    completed_downloads: 6,
    downloaded_size: 842_000_000, // ~842 MB
    started_uploads: 3,
    completed_uploads: 3,
    uploaded_size: 310_000_000,
  };
}

export function mockDiagnosticsEntries(): import("@/lib/protocol").DiagEntry[] {
  const now = Date.now();
  const iso = (offMs: number) => new Date(now - offMs).toISOString();
  return [
    { ts: iso(1000 * 60 * 2), level: "info", scope: "server", msg: "Connected to server.slsknet.org:2242", meta: { user: "demo" } },
    { ts: iso(1000 * 60 * 1 + 500), level: "info", scope: "system", msg: "Demo session started", meta: { mode: "demo", user: "demo" } },
    { ts: iso(1000 * 45), level: "debug", scope: "search", msg: "Search finished", meta: { query: "linux iso", results: 24 } },
    { ts: iso(1000 * 30), level: "info", scope: "chat", msg: "Joined room", meta: { room: "Jazz" } },
    { ts: iso(1000 * 18), level: "debug", scope: "transfer", msg: "Download queued", meta: { user: "jazzcat", file: "Midnight Groove - Blue Note Session [FLAC].flac" } },
    { ts: iso(1000 * 12), level: "info", scope: "transfer", msg: "Transfer progress", meta: { id: "jazzcat::...", progress: "44%", speed: "1.1 MB/s" } },
    { ts: iso(1000 * 6), level: "warn", scope: "peer", msg: "Peer connection retry", meta: { user: "vinyl_hunter", attempt: 2 } },
    { ts: iso(1000 * 2), level: "info", scope: "bridge", msg: "Diagnostics — demo logs (offline, no bridge)", meta: { entries: 8 } },
  ];
}

export function mockDiagnosticsHealth(): import("@/lib/protocol").DiagnosticsHealth {
  return {
    ts: new Date().toISOString(),
    uptime: 3600 * 3 + 42, // 3h +42s
    port: 8787,
    listenPort: 60754,
    dataDir: "/data (demo — ephemeral)",
    tokenAuth: false,
    version: process.env.NEXT_PUBLIC_BUILD_TAG || process.env.NEXT_PUBLIC_APP_VERSION || "0.1.0",
    commitSha: (process.env.NEXT_PUBLIC_COMMIT_SHA || process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || "demo").slice(0, 7),
    buildDate: new Date().toISOString().split("T")[0],
  };
}

// ------------------------------------------------------------------
// Demo Files Explorer — fake /data tree for Vercel demo (no bridge)
// ------------------------------------------------------------------
type BridgeFileEntry = import("@/lib/bridgeHttp").BridgeFileEntry;

function demoFile(path: string, name: string, type: BridgeFileEntry["type"], size: number, mtimeOffDays: number): BridgeFileEntry {
  const mtime = Date.now() - mtimeOffDays * 86400000;
  return { name, type, size, mtime, path };
}

// Static tree — keys are normalized host paths; "/data" is the /data root, "/" is host root (can navigate up)
const DEMO_FILE_TREE: Record<string, BridgeFileEntry[]> = {
  "/": [
    demoFile("/data", "data", "directory", 0, 2),
    demoFile("/home", "home", "directory", 0, 5),
    demoFile("/tmp", "tmp", "directory", 0, 6),
    demoFile("/etc", "etc", "directory", 0, 10),
  ],
  "/data": [
    demoFile("/data/Music", "Music", "directory", 0, 2),
    demoFile("/data/Downloads", "Downloads", "directory", 0, 5),
    demoFile("/data/Shares", "Shares", "directory", 0, 10),
    demoFile("/data/Incoming", "Incoming", "directory", 0, 12),
    demoFile("/data/README.md", "README.md", "file", 2_400, 30),
    demoFile("/data/WELCOME.txt", "WELCOME.txt", "file", 890, 1),
  ],
  "/data/Music": [
    demoFile("/data/Music/Jazz", "Jazz", "directory", 0, 3),
    demoFile("/data/Music/Electronic", "Electronic", "directory", 0, 4),
    demoFile("/data/Music/Hip-Hop", "Hip-Hop", "directory", 0, 6),
    demoFile("/data/Music/Soul", "Soul", "directory", 0, 8),
    demoFile("/data/Music/Collection.nfo", "Collection.nfo", "file", 1_200, 15),
  ],
  "/data/Music/Jazz": [
    demoFile("/data/Music/Jazz/Blue Note", "Blue Note", "directory", 0, 3),
    demoFile("/data/Music/Jazz/Live Bootlegs", "Live Bootlegs", "directory", 0, 7),
    demoFile("/data/Music/Jazz/Miles Davis - Kind of Blue [FLAC].flac", "Miles Davis - Kind of Blue [FLAC].flac", "file", 320_000_000, 20),
    demoFile("/data/Music/Jazz/John Coltrane - A Love Supreme.flac", "John Coltrane - A Love Supreme.flac", "file", 280_000_000, 22),
    demoFile("/data/Music/Jazz/Chet Baker - My Funny Valentine.mp3", "Chet Baker - My Funny Valentine.mp3", "file", 9_400_000, 18),
  ],
  "/data/Music/Jazz/Blue Note": [
    demoFile("/Music/Jazz/Blue Note/Art Blakey - Moanin'.flac", "Art Blakey - Moanin'.flac", "file", 210_000_000, 25),
    demoFile("/Music/Jazz/Blue Note/Lee Morgan - The Sidewinder.flac", "Lee Morgan - The Sidewinder.flac", "file", 198_000_000, 26),
    demoFile("/Music/Jazz/Blue Note/Herbie Hancock - Maiden Voyage.flac", "Herbie Hancock - Maiden Voyage.flac", "file", 245_000_000, 27),
  ],
  "/data/Music/Jazz/Live Bootlegs": [
    demoFile("/Music/Jazz/Live Bootlegs/1965 - Village Vanguard (bootleg).mp3", "1965 - Village Vanguard (bootleg).mp3", "file", 45_000_000, 40),
  ],
  "/data/Music/Electronic": [
    demoFile("/data/Music/Electronic/Acid", "Acid", "directory", 0, 5),
    demoFile("/data/Music/Electronic/Ambient", "Ambient", "directory", 0, 9),
    demoFile("/data/Music/Electronic/Daft Punk - Discovery.flac", "Daft Punk - Discovery.flac", "file", 380_000_000, 12),
    demoFile("/data/Music/Electronic/Kraftwerk - Trans Europe Express.flac", "Kraftwerk - Trans Europe Express.flac", "file", 295_000_000, 14),
  ],
  "/data/Music/Electronic/Acid": [
    demoFile("/Music/Electronic/Acid/Acid Trax 303.mp3", "Acid Trax 303.mp3", "file", 12_300_000, 30),
    demoFile("/Music/Electronic/Acid/303 Dreams.flac", "303 Dreams.flac", "file", 110_000_000, 31),
  ],
  "/data/Music/Electronic/Ambient": [
    demoFile("/Music/Electronic/Ambient/Brian Eno - Ambient 1.flac", "Brian Eno - Ambient 1.flac", "file", 180_000_000, 33),
  ],
  "/data/Music/Hip-Hop": [
    demoFile("/data/Music/Hip-Hop/A Tribe Called Quest - Midnight Marauders.mp3", "A Tribe Called Quest - Midnight Marauders.mp3", "file", 78_000_000, 11),
    demoFile("/data/Music/Hip-Hop/Nas - Illmatic.flac", "Nas - Illmatic.flac", "file", 310_000_000, 13),
  ],
  "/data/Music/Soul": [
    demoFile("/data/Music/Soul/Aretha Franklin - Respect.flac", "Aretha Franklin - Respect.flac", "file", 95_000_000, 16),
  ],
  "/data/Downloads": [
    demoFile("/data/Downloads/complete", "complete", "directory", 0, 1),
    demoFile("/data/Downloads/incomplete", "incomplete", "directory", 0, 1),
    demoFile("/data/Downloads/linux iso - Midnight Groove.flac", "linux iso - Midnight Groove.flac", "file", 85_000_000, 2),
  ],
  "/data/Downloads/complete": [
    demoFile("/Downloads/complete/Neon Horizons - Analog Dreams LP.flac", "Neon Horizons - Analog Dreams LP.flac", "file", 420_000_000, 2),
  ],
  "/data/Downloads/incomplete": [],
  "/data/Shares": [
    demoFile("/data/Shares/Music", "Music", "directory", 0, 4),
    demoFile("/data/Shares/Documents", "Documents", "directory", 0, 6),
    demoFile("/data/Shares/share.nfo", "share.nfo", "file", 340, 9),
  ],
  "/data/Shares/Music": [
    demoFile("/Shares/Music/Jazz", "Jazz", "directory", 0, 3),
    demoFile("/Shares/Music/Electronic", "Electronic", "directory", 0, 3),
  ],
  "/data/Shares/Documents": [
    demoFile("/Shares/Documents/notes.txt", "notes.txt", "file", 2_100, 20),
  ],
  "/data/Incoming": [],
};

export function mockFileExplorerResponse(path: string): { path: string; parent: string | null; entries: BridgeFileEntry[] } {
  const normalized = !path || path === "" ? "/" : path.startsWith("/") ? path : `/${path}`;
  // collapse // and remove trailing slash (except root)
  const clean = normalized.length > 1 ? normalized.replace(/\/+$/, "") : normalized;
  const entries = DEMO_FILE_TREE[clean];
  if (entries) {
    const parent = clean === "/" ? null : clean.split("/").slice(0, -1).join("/") || "/";
    return { path: clean, parent, entries };
  }
  // Unknown path — treat as empty leaf folder (demo fallback)
  const parent = clean.split("/").slice(0, -1).join("/") || "/";
  return { path: clean, parent, entries: [] };
}

export function mockPrivateConversations(): Record<string, DemoPrivateMessage[]> {
  const now = Date.now();
  return {
    jazzcat: [
      {
        id: "demo-jazzcat-1",
        username: "jazzcat",
        message: "hey! saw you were looking for linux iso — I have a great collection. check my Jazz folder 🌱",
        timestamp: now - 1000 * 60 * 23,
        isSelf: false,
      },
      {
        id: "demo-jazzcat-2",
        username: "jazzcat",
        message: "thanks! your shares look amazing, especially the Blue Note FLACs",
        timestamp: now - 1000 * 60 * 19,
        isSelf: true,
      },
      {
        id: "demo-jazzcat-3",
        username: "jazzcat",
        message: "appreciate the taste! 🎶 lots more in my browse — demo mode, but imagine it auto-queuing at 1 MB/s",
        timestamp: now - 1000 * 60 * 18,
        isSelf: false,
      },
    ],
    vinyl_hunter: [
      {
        id: "demo-vinyl-1",
        username: "vinyl_hunter",
        message: "yo! tails 5.2 iso is in my shares under Electronic — want me to queue it?",
        timestamp: now - 1000 * 60 * 42,
        isSelf: false,
      },
      {
        id: "demo-vinyl-2",
        username: "vinyl_hunter",
        message: "yes please! trying to verify the download",
        timestamp: now - 1000 * 60 * 41,
        isSelf: true,
      },
      {
        id: "demo-vinyl-3",
        username: "vinyl_hunter",
        message: "on it — demo mode so not actually queuing, but imagine it transferring at 800 KB/s 😉",
        timestamp: now - 1000 * 60 * 40,
        isSelf: false,
      },
    ],
  };
}