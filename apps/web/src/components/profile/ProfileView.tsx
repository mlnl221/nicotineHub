"use client";

import { useEffect, useState, useMemo } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useSession } from "@/lib/session";
import { humanSpeed } from "@/lib/format";
import { useBuddies } from "@/lib/buddies";
import { useConfig } from "@/lib/config/provider";
import { useProfileTabs } from "@/lib/profile-tabs";
import type { ProfileTab } from "@/lib/profile-tabs";

function profilePicSrc(pic: string): string {
  const isSvg = pic.trimStart().startsWith("<svg");
  const mime = isSvg ? "image/svg+xml" : "image/png";
  return `data:${mime};base64,${pic}`;
}

function guessMime(pic: string): string {
  const t = pic.trimStart();
  if (t.startsWith("<svg")) return "image/svg+xml";
  if (t.startsWith("iVBOR")) return "image/png";
  if (t.startsWith("/9j/")) return "image/jpeg";
  return "image/png";
}

function base64ToBlob(b64: string, mime: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function linkify(text: string) {
  const urlRegex = /(https?:\/\/[^\s]+)/g;
  const parts = text.split(urlRegex);
  return parts.map((part, i) => {
    if (urlRegex.test(part)) {
      urlRegex.lastIndex = 0;
      return (
        <a key={i} href={part} target="_blank" rel="noopener noreferrer" className="text-primary underline hover:text-primary-container">
          {part}
        </a>
      );
    }
    return part;
  });
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface-container-low dark:bg-surface-container-high rounded-xl p-5 flex flex-col gap-2 ghost-border">
      <span className="font-label text-xs uppercase tracking-widest text-on-surface-variant dark:text-outline">
        {label}
      </span>
      <span className="font-headline text-2xl font-semibold text-on-surface dark:text-on-surface">
        {value}
      </span>
    </div>
  );
}

export function ProfileView({ tab }: { tab: ProfileTab }) {
  const username = tab.username;
  const profile = tab.profile;
  const loading = tab.loading;
  const error = tab.error;
  const router = useRouter();
  const { state, send, subscribe } = useSession();
  const { refresh } = useProfileTabs();
  const { allBuddies, addBuddy, removeBuddy } = useBuddies();
  const { settings, setOption } = useConfig();
  const [toast, setToast] = useState<string | null>(null);
  const [showPic, setShowPic] = useState<boolean>(() => {
    if (typeof window === "undefined") return true;
    try {
      const v = (localStorage.getItem("nicotineHub.showPictures") ?? localStorage.getItem("nicotine.showPictures"));
      if (v !== null) return v !== "false";
      const cfg = (localStorage.getItem("nicotineHub.settings") ?? localStorage.getItem("nicotine.settings"));
      if (cfg) {
        const parsed = JSON.parse(cfg);
        if (typeof parsed?.userinfo?.picture_visible === "boolean") return parsed.userinfo.picture_visible;
      }
      return true;
    } catch {
      return true;
    }
  });
  const [giftOpen, setGiftOpen] = useState(false);
  const [giftDays, setGiftDays] = useState("30");
  const [privilegesLeft, setPrivilegesLeft] = useState<number | null>(null);
  const [ipInfo, setIpInfo] = useState<{ ip: string; port: number; country?: string } | null>(null);
  const [loadingIp, setLoadingIp] = useState(false);
  const [showIp, setShowIp] = useState(false);

  const picObjectUrl = useMemo(() => {
    if (!profile.info?.pic || !showPic) return null;
    try {
      const mime = guessMime(profile.info.pic);
      const blob = base64ToBlob(profile.info.pic, mime);
      return URL.createObjectURL(blob);
    } catch { return null; }
  }, [profile.info?.pic, showPic]);

  useEffect(() => {
    return () => { if (picObjectUrl) URL.revokeObjectURL(picObjectUrl); };
  }, [picObjectUrl]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2600);
  };

  useEffect(() => {
    try {
      localStorage.setItem("nicotineHub.showPictures", String(showPic));
    } catch {}
  }, [showPic]);

  useEffect(() => {
    try {
      const raw = (localStorage.getItem("nicotineHub.settings") ?? localStorage.getItem("nicotine.settings"));
      if (raw) {
        const cfg = JSON.parse(raw);
        if (cfg?.userinfo?.picture_visible !== showPic) {
          cfg.userinfo = { ...(cfg.userinfo || {}), picture_visible: showPic };
          localStorage.setItem("nicotineHub.settings", JSON.stringify(cfg));
        }
      }
    } catch {}
  }, [showPic]);

  useEffect(() => {
    if (state.status !== "connected") return;
    send({ type: "userinfo", action: "checkPrivileges" });
    const unsub = subscribe((msg) => {
      if (msg.type !== "userinfo:event") return;
      const ev = msg.event as unknown as { type: string; checkPrivileges?: number; peerAddress?: { ip: string; port: number }; username?: string };
      if (ev.type === "check-privileges" && typeof ev.checkPrivileges === "number") {
        setPrivilegesLeft(ev.checkPrivileges);
      }
      if (ev.type === "peer-address" && ev.username === username && ev.peerAddress) {
        const pa = ev.peerAddress as unknown as { ip: string; port: number };
        if (pa.ip === "0.0.0.0" || pa.port === 0) {
          flash("User offline or IP unavailable");
          setIpInfo(null);
        } else {
          setIpInfo({ ip: pa.ip, port: pa.port });
          flash(`IP: ${pa.ip}:${pa.port}`);
        }
        setLoadingIp(false);
      }
    });
    return unsub;
  }, [state.status, send, subscribe, username]);

  const statusLabel =
    profile.status?.status === 2 ? "Online" : profile.status?.status === 1 ? "Away" : "Offline";
  const statusColor = profile.status?.status === 2 ? "text-green-600" : profile.status?.status === 1 ? "text-yellow-600" : "text-outline";

  const isOwn = state.user !== undefined && state.user === username;
  const isBuddy = allBuddies.some((b) => b.username.toLowerCase() === username.toLowerCase());
  const bannedList: string[] = (settings.server as unknown as { banlist: string[] }).banlist || [];
  const isBanned = bannedList.includes(username);
  const ignoredList: string[] = (settings.server as unknown as { ignorelist?: string[] }).ignorelist || [];
  const isIgnored = ignoredList.includes(username);
  const country = profile.country || profile.watchUser?.country;

  const handleCopyPic = async () => {
    if (!profile.info?.pic) return;
    try {
      const mime = guessMime(profile.info.pic);
      const blob = base64ToBlob(profile.info.pic, mime);
      // @ts-ignore ClipboardItem may not be typed
      const item = new ClipboardItem({ [mime]: blob });
      // @ts-ignore
      await navigator.clipboard.write([item]);
      flash("Picture copied");
    } catch {
      flash("Copy not supported in this browser");
    }
  };
  const handleSavePic = () => {
    if (!profile.info?.pic) return;
    const mime = guessMime(profile.info.pic);
    const blob = base64ToBlob(profile.info.pic, mime);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const ext = mime === "image/svg+xml" ? "svg" : mime === "image/jpeg" ? "jpg" : "png";
    const ts = new Date().toISOString().slice(0,19).replace(/[:T]/g,"-");
    a.download = `${username}_${ts}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    flash("Picture saved");
  };
  const handleSharePic = async () => {
    if (!profile.info?.pic) return;
    const mime = guessMime(profile.info.pic);
    const blob = base64ToBlob(profile.info.pic, mime);
    const ext = mime === "image/svg+xml" ? "svg" : mime === "image/jpeg" ? "jpg" : "png";
    const file = new File([blob], `${username}.${ext}`, { type: mime });
    try {
      // @ts-ignore
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        // @ts-ignore
        await navigator.share({ files: [file], title: `${username} picture` });
        flash("Shared");
      } else if ((navigator as unknown as { share?: (d:unknown)=>Promise<void> }).share) {
        // @ts-ignore
        await navigator.share({ title: username, text: "Profile picture" });
      } else {
        handleSavePic();
      }
    } catch {}
  };

  const toggleBuddy = () => {
    if (isBuddy) {
      removeBuddy(username);
      flash("Removed from buddies");
    } else {
      addBuddy(username);
      flash("Added to buddies");
    }
  };

  const handleBanToggle = () => {
    const next = isBanned ? bannedList.filter((x) => x !== username) : [...bannedList, username];
    setOption("server", "banlist", next);
    flash(isBanned ? "Unbanned" : "Banned");
  };
  const handleIgnoreToggle = () => {
    const next = isIgnored ? ignoredList.filter((x) => x !== username) : [...ignoredList, username];
    setOption("server", "ignorelist", next);
    flash(isIgnored ? "Unignored" : "Ignored");
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="sticky top-0 z-10 bg-surface-bright/80 dark:bg-surface-container-lowest/80 backdrop-blur-xl px-4 md:px-8 py-4 md:py-6 flex flex-col gap-3 md:gap-4 border-b border-outline-variant/10">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className={`flex items-center gap-4 min-w-0 flex-1 ${profile.info && !profile.info.slotsavail ? "opacity-60" : ""}`} title={profile.info && !profile.info.slotsavail ? "Slots full" : undefined}>
            {profile.info?.pic && showPic ? (
              <Image
                src={picObjectUrl ?? profilePicSrc(profile.info.pic)}
                alt={`${username} profile picture`}
                width={64}
                height={64}
                unoptimized
                loading="lazy"
                className="h-16 w-16 rounded-full object-cover bg-surface-container-highest"
              />
            ) : profile.info?.pic && !showPic ? (
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-container-high ghost-border">
                <span className="material-symbols-outlined text-outline">hide_image</span>
              </div>
            ) : (
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-container">
                <span className="font-headline text-xl font-bold text-on-primary">
                  {username.slice(0, 1).toUpperCase()}
                </span>
              </div>
            )}
            <div className="min-w-0">
              <h2 className="font-headline text-3xl font-bold text-on-surface dark:text-on-surface tracking-tight truncate">
                {username}
              </h2>
              <div className="mt-1 flex flex-wrap items-center gap-2 font-label text-xs uppercase tracking-widest text-on-surface-variant dark:text-outline">
                <span className={statusColor}>{statusLabel}</span>
                {country ? (
                  <button
                    onClick={() => {
                      setShowIp((v) => !v);
                      if (!ipInfo && !loadingIp) {
                        setLoadingIp(true);
                        send({ type: "userinfo", action: "peerAddress", username });
                      }
                    }}
                    className="inline-flex items-center gap-1 rounded-full bg-surface-container-low px-2 py-0.5 text-[11px] normal-case tracking-normal hover:bg-surface-container-high"
                    title="Click to show IP address"
                  >
                    <span className="material-symbols-outlined text-[12px]">public</span> {country}
                  </button>
                ) : null}
                {showIp && ipInfo ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-surface-container-high px-2 py-0.5 text-[11px] font-mono normal-case tracking-normal">
                    {ipInfo.ip}:{ipInfo.port} {ipInfo.country ? `(${ipInfo.country})` : ""}
                  </span>
                ) : showIp && loadingIp ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-surface-container-high px-2 py-0.5 text-[11px]">
                    <span className="material-symbols-outlined animate-spin text-[12px]">progress_activity</span> fetching IP…
                  </span>
                ) : null}
                {profile.status?.privileged ? (
                  <span className="inline-flex items-center gap-1 rounded-full bg-tertiary-container px-2 py-0.5 text-tertiary-on-container dark:bg-tertiary-fixed/30 dark:text-tertiary-fixed">
                    <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>star</span>
                    Privileged
                  </span>
                ) : null}
                {privilegesLeft !== null && privilegesLeft > 0 ? (
                  <span className="rounded-full bg-tertiary-container/50 px-2 py-0.5 text-[10px]">{Math.floor(privilegesLeft/86400)}d left</span>
                ) : null}
                {isBuddy ? <span className="rounded-full bg-primary-container/20 px-2 py-0.5 text-primary text-[10px]">Buddy</span> : null}
                {isBanned ? <span className="rounded-full bg-error-container px-2 py-0.5 text-on-error-container text-[10px]">Banned</span> : null}
                {isIgnored ? <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-[10px]">Ignored</span> : null}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0 w-full sm:w-auto">
            <button
              onClick={() => router.push(`/browse?user=${encodeURIComponent(username)}`)}
              className="flex-1 sm:flex-none rounded-xl bg-primary-container px-4 py-2.5 min-h-11 font-label text-xs font-semibold uppercase tracking-widest text-on-primary-container transition-colors hover:bg-primary hover:text-on-primary"
            >
              Browse Files
            </button>
            <button
              onClick={() => router.push(`/private-chat?user=${encodeURIComponent(username)}`)}
              className="flex-1 sm:flex-none rounded-xl bg-surface-container-low px-4 py-2.5 min-h-11 font-label text-xs font-semibold uppercase tracking-widest text-on-surface transition-colors hover:bg-surface-container-high dark:bg-surface-container-high dark:text-on-surface"
            >
              Send Message
            </button>
          </div>
        </div>
        {profile.info?.pic ? (
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => setShowPic((v) => !v)} className="inline-flex items-center gap-1 rounded-full bg-surface-container-low px-3 py-2.5 min-h-9 font-label text-xs hover:bg-surface-container-high">
              <span className="material-symbols-outlined text-[16px]">{showPic ? "visibility_off" : "visibility"}</span>
              {showPic ? "Hide" : "Show"} picture
            </button>
            <button onClick={handleCopyPic} className="inline-flex items-center gap-1 rounded-full bg-surface-container-low px-3 py-2.5 min-h-9 font-label text-xs hover:bg-surface-container-high">
              <span className="material-symbols-outlined text-[16px]">content_copy</span> Copy
            </button>
            <button onClick={handleSavePic} className="inline-flex items-center gap-1 rounded-full bg-surface-container-low px-3 py-2.5 min-h-9 font-label text-xs hover:bg-surface-container-high">
              <span className="material-symbols-outlined text-[16px]">download</span> Save
            </button>
            <button onClick={handleSharePic} className="inline-flex items-center gap-1 rounded-full bg-surface-container-low px-3 py-2.5 min-h-9 font-label text-xs hover:bg-surface-container-high">
              <span className="material-symbols-outlined text-[16px]">share</span> Share
            </button>
          </div>
        ) : null}
      </header>

      <div className="flex-1 overflow-y-auto p-4 md:p-8 space-y-6 md:space-y-8 max-w-screen-2xl mx-auto w-full">
        {error ? (
          <div className="bg-error-container/50 dark:bg-tertiary-container/20 rounded-xl p-5 flex gap-3 items-start">
            <span className="material-symbols-outlined text-error text-xl">info</span>
            <div className="flex-1">
              <p className="font-body text-sm text-on-error-container dark:text-tertiary-fixed">
                {error} The user may be offline or unreachable.
              </p>
              <button onClick={() => refresh(tab.id)} className="mt-3 inline-flex items-center gap-1 rounded-full bg-surface-container-lowest px-3 py-1.5 font-label text-xs hover:bg-surface-container-high">
                <span className="material-symbols-outlined text-[16px]">refresh</span> Retry
              </button>
            </div>
          </div>
        ) : null}

        {loading && !error ? (
          <div className="flex flex-col gap-4">
            <div className="flex items-center gap-3 font-body text-on-surface-variant">
              <span className="material-symbols-outlined animate-spin">progress_activity</span>
              Loading profile…
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-container-high">
              <div className="h-full w-1/3 animate-pulse bg-primary" style={{ animationDuration: "1s" }} />
            </div>
          </div>
        ) : null}

        {profile.stats ? (
          <section className="grid grid-cols-2 gap-4">
            <StatCard label="Files Shared" value={profile.stats.files.toLocaleString()} />
            <StatCard label="Shared Folders" value={profile.stats.dirs.toLocaleString()} />
            <StatCard label="Avg Speed" value={profile.stats.avgspeed ? humanSpeed(profile.stats.avgspeed) : "—"} />
            <div className={profile.info && !profile.info.slotsavail ? "opacity-60" : undefined} title={profile.info && !profile.info.slotsavail ? "Slots full — may not accept uploads" : undefined}>
              <StatCard label="Upload Slots" value={profile.info ? `${profile.info.totalupl} total / ${profile.info.slotsavail ? "Open" : "Full"}` : "—"} />
            </div>
            {profile.info && profile.info.queuesize > 0 ? <StatCard label="Queued Uploads" value={profile.info.queuesize.toString()} /> : null}
            {profile.info && profile.info.uploadallowed !== undefined ? <StatCard label="Queue Slots" value={profile.info.uploadallowed.toString()} /> : null}
          </section>
        ) : null}

        {profile.info?.descr ? (
          <section className="bg-surface dark:bg-surface-container-low rounded-xl p-6 ghost-border">
            <h3 className="font-label text-sm uppercase tracking-widest text-on-surface-variant dark:text-outline mb-3">Description</h3>
            <p className="font-body text-sm text-on-surface dark:text-on-surface whitespace-pre-wrap break-words">{linkify(profile.info.descr)}</p>
          </section>
        ) : null}

        {profile.interests ? (
          <section className="bg-surface dark:bg-surface-container-low rounded-xl p-6 ghost-border">
            <h3 className="font-label text-sm uppercase tracking-widest text-on-surface-variant dark:text-outline mb-3">Interests</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <p className="font-label text-xs text-tertiary mb-2">Likes</p>
                {profile.interests.likes.length ? (
                  <ul className="flex flex-wrap gap-2">
                    {profile.interests.likes.map((like) => (
                      <li key={like} className="rounded-full bg-primary-container/30 px-3 py-1 font-label text-xs text-primary dark:text-primary-fixed">{like}</li>
                    ))}
                  </ul>
                ) : <p className="font-body text-sm text-on-surface-variant">None listed</p>}
              </div>
              <div>
                <p className="font-label text-xs text-outline mb-2">Dislikes</p>
                {profile.interests.hates.length ? (
                  <ul className="flex flex-wrap gap-2">
                    {profile.interests.hates.map((hate) => (
                      <li key={hate} className="rounded-full bg-surface-container-high px-3 py-1 font-label text-xs text-on-surface-variant">{hate}</li>
                    ))}
                  </ul>
                ) : <p className="font-body text-sm text-on-surface-variant">None listed</p>}
              </div>
            </div>
          </section>
        ) : null}

        <section className="bg-surface dark:bg-surface-container-low rounded-xl p-6 ghost-border">
          <h3 className="font-label text-sm uppercase tracking-widest text-on-surface-variant dark:text-outline mb-4">Actions</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <button onClick={toggleBuddy} className={`rounded-xl px-4 py-3 font-label text-xs font-semibold uppercase tracking-widest ${isBuddy ? "bg-surface-container-high text-on-surface" : "bg-primary-container text-on-primary-container hover:bg-primary"}`}>
              {isBuddy ? "Remove Buddy" : "Add Buddy"}
            </button>
            {!isOwn ? (
              <>
                <button onClick={handleBanToggle} className={`rounded-xl px-4 py-3 font-label text-xs font-semibold uppercase tracking-widest ${isBanned ? "bg-error-container text-on-error-container" : "bg-surface-container-low hover:bg-surface-container-high"}`}>
                  {isBanned ? "Unban" : "Ban"}
                </button>
                <button onClick={handleIgnoreToggle} className={`rounded-xl px-4 py-3 font-label text-xs font-semibold uppercase tracking-widest ${isIgnored ? "bg-surface-container-high text-outline" : "bg-surface-container-low hover:bg-surface-container-high"}`}>
                  {isIgnored ? "Unignore" : "Ignore"}
                </button>
                <button onClick={() => setGiftOpen(true)} disabled={privilegesLeft !== null && privilegesLeft <= 0} className="rounded-xl bg-tertiary-container px-4 py-3 font-label text-xs font-semibold uppercase tracking-widest text-on-tertiary-container hover:bg-tertiary disabled:opacity-50">
                  Gift Privileges
                </button>
              </>
            ) : (
              <button onClick={() => router.push("/settings?tab=user-profile")} className="rounded-xl bg-surface-container-low px-4 py-3 font-label text-xs font-semibold uppercase tracking-widest hover:bg-surface-container-high">Edit Profile</button>
            )}
            <button onClick={() => refresh(tab.id)} className="rounded-xl bg-surface-container-low px-4 py-3 font-label text-xs font-semibold uppercase tracking-widest hover:bg-surface-container-high">Refresh</button>
            <button onClick={() => router.push(`/interests`)} className="rounded-xl bg-tertiary-container px-4 py-3 font-label text-xs font-semibold uppercase tracking-widest text-on-tertiary-container hover:bg-tertiary">Similar Users</button>
          </div>
          {giftOpen ? (
            <div className="mt-6 rounded-xl bg-surface-container-high p-4">
              <h4 className="font-label text-xs uppercase tracking-widest mb-2">Gift privileges {privilegesLeft !== null ? `(${Math.floor(privilegesLeft/86400)} days left)` : ""}</h4>
              <div className="flex gap-2">
                <input type="number" min={1} max={3650} value={giftDays} onChange={(e) => setGiftDays(e.target.value)} className="w-24 rounded-lg bg-surface-container-lowest px-3 py-2 text-sm" />
                <span className="py-2 font-body text-sm">days</span>
                <button
                  onClick={() => {
                    const d = parseInt(giftDays, 10);
                    if (!d || d < 1 || d > 3650) return flash("Days 1-3650");
                    send({ type: "userinfo", action: "givePrivileges", username, days: d });
                    flash(`Gifting ${d} days to ${username}`);
                    setGiftOpen(false);
                  }}
                  className="rounded-lg bg-primary px-4 py-2.5 min-h-9 font-label text-xs text-on-primary"
                >
                  Give
                </button>
                <button onClick={() => setGiftOpen(false)} className="rounded-lg bg-surface-container-lowest px-4 py-2 font-label text-xs">Cancel</button>
              </div>
            </div>
          ) : null}
        </section>
      </div>

      {toast ? (
        <div className="fixed bottom-6 left-1/2 z-40 -translate-x-1/2 rounded-full bg-inverse-surface px-4 py-2 font-label text-xs text-inverse-on-surface shadow-lg">{toast}</div>
      ) : null}
    </div>
  );
}
