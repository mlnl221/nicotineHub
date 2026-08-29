"use client";

// Tiny SVG avatar generator — returns base64-encoded SVG (profile.tsx will detect "<svg" prefix)
export function avatarBase64(username: string): string {
  const hue = Math.abs(hash(username)) % 360;
  const bg = `hsl(${hue} 70% 45%)`;
  const initials = username.slice(0, 2).toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect width="128" height="128" rx="64" fill="${bg}"/><text x="64" y="74" text-anchor="middle" font-family="Inter, sans-serif" font-size="42" font-weight="700" fill="white">${initials}</text></svg>`;
  // btoa works in browser; for Node fallback use Buffer
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
      },
    });
  }
  return rows;
}

export function mockBrowseFolders(username: string): import("@/lib/protocol").BrowseFolder[] {
  const seed = Math.abs(hash(username.toLowerCase()));
  const rnd = seededRand(seed);
  const folderNames = [
    `C:\\Users\\${username}\\Music\\Jazz`,
    `C:\\Users\\${username}\\Music\\Electronic`,
    `C:\\Users\\${username}\\Music\\Hip-Hop`,
    `C:\\Users\\${username}\\Music\\Soul`,
  ];
  return folderNames.map((name) => {
    const fileCount = 6 + Math.floor(rnd() * 8);
    const files: import("@/lib/protocol").BrowseFile[] = [];
    for (let i = 0; i < fileCount; i++) {
      const title = SAMPLE_TITLES[Math.floor(rnd() * SAMPLE_TITLES.length)];
      const ext = FILE_TYPES[Math.floor(rnd() * FILE_TYPES.length)];
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
  ];
}

export interface DemoPrivateMessage {
  id: string;
  username: string;
  message: string;
  timestamp: number;
  isSelf: boolean;
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
