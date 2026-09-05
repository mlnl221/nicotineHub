"use client";

import { useConfig } from "@/lib/config/provider";
import { SectionCard, SectionSaveButton, TextFieldControl, ToggleControl } from "@/components/settings/controls";
import { useSession } from "@/lib/session";

async function resizeToWebp(file: File, max = 512, quality = 0.8): Promise<string> {
  // SVG: return raw data URL (no rasterize) but guard size
  if (file.type === "image/svg+xml" || file.name.toLowerCase().endsWith(".svg")) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result ?? ""));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
  }
  const bitmap = await createImageBitmap(file);
  let { width, height } = bitmap;
  if (width > max || height > max) {
    const scale = Math.min(max / width, max / height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas unsupported");
  ctx.drawImage(bitmap, 0, 0, width, height);
  // try webp first, fallback to jpeg
  let dataUrl: string;
  try {
    dataUrl = canvas.toDataURL("image/webp", quality);
    // if webp not supported, it falls back to png — detect huge size
    if (dataUrl.length > 700_000) dataUrl = canvas.toDataURL("image/jpeg", quality);
  } catch {
    dataUrl = canvas.toDataURL("image/jpeg", quality);
  }
  bitmap.close();
  return dataUrl;
}

export function UserProfileSection() {
  const { settings, setOption } = useConfig();
  const { state } = useSession();
  const u = settings.userinfo;

  return (
    <SectionCard
      title="User profile"
      description="Description and picture shown to other Soulseek users. Picture upload is a browser file picker (local preview) — bridge will publish it via UserInfo (preferences.py:1254 userinfo.ui). Publishes to the network on Save when connected."
      actions={<SectionSaveButton section="userinfo" />}
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
            try {
              const dataUrl = await resizeToWebp(f, 512, 0.8);
              // ensure still under ~600KB base64
              if (dataUrl.length > 800_000) {
                alert("Compressed image still too large, try a smaller file.");
                return;
              }
              setOption("userinfo", "pic", dataUrl);
            } catch {
              const reader = new FileReader();
              reader.onload = () => setOption("userinfo", "pic", String(reader.result ?? ""));
              reader.readAsDataURL(f);
            }
          }}
        />
        {u.pic ? (
          <div className="mt-3 flex items-center gap-3">
            <Image src={u.pic} alt="Profile preview" width={64} height={64} unoptimized className="h-16 w-16 rounded-xl object-cover ghost-border" />
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
      {state.status !== "connected" ? (
        <p className="font-body text-xs text-outline">Connect to publish changes to the network (saves locally otherwise).</p>
      ) : null}
    </SectionCard>
  );
}
