// Migration: copy legacy nicotine.* keys to nicotineHub.* on first load
// This preserves user data after the rename (localStorage, sessionStorage, cookies)

const LOCAL_STORAGE_KEYS: Array<[string, string]> = [
  ["nicotine.settings", "nicotineHub.settings"],
  ["nicotine.buddies", "nicotineHub.buddies"],
  ["nicotine.likes", "nicotineHub.likes"],
  ["nicotine.hates", "nicotineHub.hates"],
  ["nicotine.transfers.mock", "nicotineHub.transfers.mock"],
  ["nicotine.privatechats", "nicotineHub.privatechats"],
  ["nicotine.pendingPrivate", "nicotineHub.pendingPrivate"],
  ["nicotine.profileTabs", "nicotineHub.profileTabs"],
  ["nicotine.recentProfiles", "nicotineHub.recentProfiles"],
  ["nicotine.browseTabs", "nicotineHub.browseTabs"],
  ["nicotine.recentBrowse", "nicotineHub.recentBrowse"],
  ["nicotine.browse.sort", "nicotineHub.browse.sort"],
  ["nicotine.showPictures", "nicotineHub.showPictures"],
  ["nicotine.wishlist", "nicotineHub.wishlist"],
  ["nicotine.theme", "nicotineHub.theme"],
  ["nicotine.bridgeUrl", "nicotineHub.bridgeUrl"],
  ["nicotine.bridgeToken", "nicotineHub.bridgeToken"],
  ["nicotine.demoSeeded", "nicotineHub.demoSeeded"],
  ["nicotine.rememberedCreds", "nicotineHub.rememberedCreds"],
];

const SESSION_STORAGE_KEYS: Array<[string, string]> = [
  ["nicotine.activeRoom", "nicotineHub.activeRoom"],
  ["nicotine.ephemeralCreds", "nicotineHub.ephemeralCreds"],
];

function migrateStorage(
  storage: Storage,
  keys: Array<[string, string]>,
) {
  for (const [oldKey, newKey] of keys) {
    try {
      const oldVal = storage.getItem(oldKey);
      const newVal = storage.getItem(newKey);
      if (oldVal !== null && newVal === null) {
        storage.setItem(newKey, oldVal);
      }
    } catch {}
  }
}

function migrateCookie(oldName: string, newName: string) {
  try {
    const cookies = document.cookie.split(";").map((s) => s.trim());
    const oldEntry = cookies.find((s) => s.startsWith(oldName + "="));
    const newEntry = cookies.find((s) => s.startsWith(newName + "="));
    if (oldEntry && !newEntry) {
      const b64 = oldEntry.split("=").slice(1).join("=");
      const isSecure = typeof window !== "undefined" && window.location.protocol === "https:";
      document.cookie = `${newName}=${b64}; Path=/; SameSite=Lax; Max-Age=2592000${isSecure ? "; Secure" : ""}`;
    }
  } catch {}
}

export function runStorageMigration() {
  if (typeof window === "undefined") return;
  try {
    migrateStorage(window.localStorage, LOCAL_STORAGE_KEYS);
  } catch {}
  try {
    migrateStorage(window.sessionStorage, SESSION_STORAGE_KEYS);
  } catch {}
  try {
    migrateCookie("nicotine_creds", "nicotineHub_creds");
  } catch {}
  // Also migrate theme cookie? no
}

// Auto-run on import in browser
if (typeof window !== "undefined") {
  try {
    runStorageMigration();
  } catch {}
}
