"use client";

import { useEffect, useState } from "react";
import { useConfig } from "@/lib/config/provider";
import { SectionCard, TextFieldControl, ToggleControl } from "@/components/settings/controls";
import { useSession } from "@/lib/session";

function extractBase64(dataUrl: string): string | undefined {
  if (!dataUrl) return undefined;
  if (dataUrl.startsWith("data:")) {
    const comma = dataUrl.indexOf(",");
    if (comma !== -1) return dataUrl.slice(comma + 1);
    return undefined;
  }
  // If it's already raw base64 or path, try to detect
  if (dataUrl.length > 5000000) return undefined;
  // If it looks like base64 (no slash prefix), return as is if it decodes?
  // For file path like /path/to.jpg, we cannot send - return undefined
  if (dataUrl.startsWith("/") || dataUrl.startsWith("C:")) return undefined;
  // Otherwise assume raw base64
  return dataUrl;
}

export function UserProfileSection() {
  const { settings, setOption } = useConfig();
  const { send, state } = useSession();
  const u = settings.userinfo;
  const [publishStatus, setPublishStatus] = useState<string | null>(null);

  // Push local profile to bridge when descr/pic changes and connected
  useEffect(() => {
    if (state.status !== "connected") return;
    const rawDescr = u.descr === "''" ? "" : u.descr.replace(/^'|'$/g, "").replace(/^"|"$/g, "");
    if (rawDescr.length > 10000) return;
    const picB64 = extractBase64(u.pic);
    if (picB64 && picB64.length > 5_000_000) return;
    // Debounce publish
    const t = setTimeout(() => {
      try {
        send({
          type: "userinfo",
          action: "setProfile",
          profile: {
            descr: rawDescr,
            pic: picB64,
            totalupl: 0,
            queuesize: 0,
            slotsavail: true,
            uploadallowed: 1,
          },
        });
        setPublishStatus("Published to network");
        setTimeout(() => setPublishStatus(null), 2000);
      } catch {}
    }, 800);
    return () => clearTimeout(t);
  }, [u.descr, u.pic, state.status, send]);

  return (
    <SectionCard
      title="User profile"
      description="Description and picture shown to other Soulseek users. Picture upload is a browser file picker (local preview) — bridge will publish it via UserInfo (preferences.py:1254 userinfo.ui). Auto-publishes to network when connected."
    >
      <TextFieldControl
        label="Description"
        description="Shown on your profile. Stored as repr() like Nicotine+ (pynicotine/config.py:244). Supports plain text and URLs."
        value={u.descr === "''" ? "" : u.descr.replace(/^'|'$/g, "").replace(/^"|"$/g, "")}
        multiline
        placeholder="Tell others about your music..."
        onChange={(v) => setOption("userinfo", "descr", v ? `'${v}'` : "''")}
      />
      <TextFieldControl
        label="Picture path"
        description="In the browser, pick an image file to preview. File path is stored locally."
        value={u.pic}
        placeholder="/path/to/image.jpg or data URL"
        onChange={(v) => setOption("userinfo", "pic", v)}
      />
      <div className="py-2">
        <label className="font-label text-xs uppercase tracking-widest text-on-surface-variant">Pick image</label>
        <input
          type="file"
          accept="image/*"
          className="mt-2 block w-full text-sm"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            if (f.size > 5_000_000) {
              alert("Image too large (max 5MB)");
              return;
            }
            const reader = new FileReader();
            reader.onload = () => setOption("userinfo", "pic", String(reader.result ?? ""));
            reader.readAsDataURL(f);
          }}
        />
        {u.pic ? (
          <div className="mt-3 flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={u.pic} alt="Profile preview" className="h-16 w-16 rounded-xl object-cover ghost-border" />
            <button
              type="button"
              onClick={() => setOption("userinfo", "pic", "")}
              className="font-label text-xs uppercase tracking-widest text-error hover:underline"
            >
              Remove picture
            </button>
          </div>
        ) : null}
      </div>
      <ToggleControl
        label="Picture visible"
        checked={u.picture_visible}
        onChange={(v) => setOption("userinfo", "picture_visible", v)}
      />
      {publishStatus ? (
        <div className="rounded-lg bg-primary-container/20 px-3 py-2 font-label text-xs text-primary">
          {publishStatus}
        </div>
      ) : null}
      {state.status !== "connected" ? (
        <p className="font-body text-xs text-outline">Connect to publish changes to the network.</p>
      ) : null}
    </SectionCard>
  );
}
