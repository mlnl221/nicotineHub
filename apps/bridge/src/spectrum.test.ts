import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, writeFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { calculateZoomStartpoint, getSpectrumHash, getSpectrumPaths, SPECTRUM_DIR, spectrumManager } from "./spectrum.ts";

describe("spectrum", () => {
  test("calculateZoomStartpoint", () => {
    expect(calculateZoomStartpoint(undefined)).toBe(0);
    expect(calculateZoomStartpoint(0)).toBe(0);
    expect(calculateZoomStartpoint(5)).toBe(0);
    expect(calculateZoomStartpoint(5.1)).toBe(2);
    expect(calculateZoomStartpoint(10)).toBe(5);
    expect(calculateZoomStartpoint(100)).toBe(50);
  });

  test("getSpectrumHash is deterministic and hex 16", () => {
    const h1 = getSpectrumHash(123, 1000, 999);
    const h2 = getSpectrumHash(123, 1000, 999);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{16}$/);
    expect(getSpectrumHash(124, 1000, 999)).not.toBe(h1);
  });

  test("getSpectrumPaths uses /tmp and token-hash", () => {
    const { full, zoom, meta } = getSpectrumPaths(42, "abcd1234abcd1234");
    expect(full).toBe(join(SPECTRUM_DIR, "42-abcd1234abcd1234-Full.png"));
    expect(zoom).toBe(join(SPECTRUM_DIR, "42-abcd1234abcd1234-Zoom.png"));
    expect(meta).toBe(join(SPECTRUM_DIR, "42-abcd1234abcd1234.json"));
    expect(SPECTRUM_DIR).toBe("/tmp/hub-spectrum");
  });

  test("SPECTRUM_DIR exists after import", () => {
    expect(existsSync(SPECTRUM_DIR)).toBe(true);
  });

  // Integration test: if sox available, generate Full+Zoom for a tiny wav via sox synth
  test("sox generates Full+Zoom if sox present", async () => {
    // Check sox exists
    try {
      const proc = Bun.spawn(["sox", "--version"], { stdout: "pipe" });
      await proc.exited;
      if (proc.exitCode !== 0) {
        console.warn("sox not installed, skipping integration");
        return;
      }
    } catch {
      console.warn("sox not installed, skipping integration");
      return;
    }

    const tmpDir = "/tmp/hub-spectrum-test";
    try { mkdirSync(tmpDir, { recursive: true }); } catch {}
    const wav = join(tmpDir, "test-tone.wav");
    // Generate 1 sec 440Hz tone via sox synth
    const synth = Bun.spawn(["sox", "-n", wav, "synth", "1", "sine", "440"], { stdout: "pipe", stderr: "pipe" });
    await synth.exited;
    if (!existsSync(wav)) {
      console.warn("sox synth failed, skipping");
      return;
    }
    const st = statSync(wav);
    const token = 99999;
    const res = await spectrumManager.ensureSpectrum({ token, filePath: wav, mtimeMs: st.mtimeMs, size: st.size, duration: 1 });
    expect(existsSync(res.fullPath)).toBe(true);
    expect(existsSync(res.zoomPath)).toBe(true);
    expect(res.etag).toMatch(/^"[0-9a-f]{16}"$/);
    // second call should be fromCache
    const res2 = await spectrumManager.ensureSpectrum({ token, filePath: wav, mtimeMs: st.mtimeMs, size: st.size, duration: 1 });
    expect(res2.fromCache).toBe(true);
    expect(res2.fullPath).toBe(res.fullPath);
    // cleanup
    try { spectrumManager.deleteForToken(token); } catch {}
    try { rmSync(wav); } catch {}
  }, 30_000);
});
