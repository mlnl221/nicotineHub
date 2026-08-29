"use client";

import { useConfig } from "@/lib/config/provider";
import { SectionCard, TextFieldControl, ToggleControl } from "@/components/settings/controls";

export function UserProfileSection() {
  const { settings, setOption } = useConfig();
  const u = settings.userinfo;

  return (
    <SectionCard
      title="User profile"
      description="Description and picture shown to other Soulseek users. Picture upload is a browser file picker (local preview) — bridge will publish it via UserInfo (preferences.py:1254 userinfo.ui)."
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
    </SectionCard>
  );
}
