"use client";

import Image from "next/image";
import { useConfig } from "@/lib/config/provider";
import { SectionCard, SectionSaveButton, TextFieldControl, ToggleControl } from "@/components/settings/controls";
import { useSession } from "@/lib/session";
import { convertAvatarViaWorker } from "@/lib/worker";

async function resizeAvatar(file: File, max = 512, quality = 0.8): Promise<string> {
  // Rasterize via bitmap (handles SVG too) and encode JPEG/PNG only:
  // remote nicotine+ clients use stock gdk-pixbuf, which cannot decode WebP
  // (needs webp-pixbuf-loader) or SVG (needs librsvg) — those pictures fail
  // to load on their side with "Unrecognized image file format".
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
  // PNG keeps transparency for PNG sources, JPEG otherwise; retry smaller on overflow
  const wantPng = file.type === "image/png" || file.name.toLowerCase().endsWith(".png");
  let dataUrl = canvas.toDataURL(wantPng ? "image/png" : "image/jpeg", quality);
  if (dataUrl.length > 700_000) dataUrl = canvas.toDataURL("image/jpeg", 0.6);
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
        description="Shown on your profile. Supports plain text and URLs."
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
          accept="image/jpeg,image/png,image/gif,image/webp,image/svg+xml"
          className="mt-2 block w-full text-sm"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            if (f.size > 5_000_000) {
              alert("Image too large (max 5MB)");
              return;
            }
            // Worker (ffmpeg) first so any format becomes JPEG; canvas fallback
            // covers worker-down/timeout/undecodable. SVG goes canvas-first:
            // browsers rasterize it natively, worker ffmpeg may not.
            const isSvg = f.type === "image/svg+xml" || f.name.toLowerCase().endsWith(".svg");
            const attempts: Array<() => Promise<string>> = isSvg
              ? [() => resizeAvatar(f, 512, 0.8)]
              : [() => convertAvatarViaWorker(f), () => resizeAvatar(f, 512, 0.8)];
            let dataUrl: string | null = null;
            for (const attempt of attempts) {
              try {
                dataUrl = await attempt();
                break;
              } catch (err) {
                const msg = err instanceof Error ? err.message : String(err);
                // Auth misconfiguration must surface, never silently fall back.
                if (/bad token|unauthorized|401/i.test(msg)) {
                  alert("Worker auth failed — check the Worker token, picture not updated.");
                  return;
                }
              }
            }
            if (!dataUrl) {
              // Canvas path failed too: accept the raw file only if it is
              // already JPEG/PNG/GIF, else it would break remote clients.
              if (!/image\/(jpeg|png|gif)/.test(f.type)) {
                alert("Could not process that image — please use a JPEG or PNG file.");
                return;
              }
              const reader = new FileReader();
              reader.onload = () => setOption("userinfo", "pic", String(reader.result ?? ""));
              reader.readAsDataURL(f);
              return;
            }
            // ensure still under ~600KB base64
            if (dataUrl.length > 800_000) {
              alert("Compressed image still too large, try a smaller file.");
              return;
            }
            setOption("userinfo", "pic", dataUrl);
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
