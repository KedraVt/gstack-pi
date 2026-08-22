import { existsSync, mkdirSync, createWriteStream } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";

const here = fileURLToPath(new URL(".", import.meta.url));
const RUNTIME_DIR = resolve(here, "..", "runtime", "browse", "dist");

const RELEASE_BASE = "https://github.com/KedraVt/gstack-pi/releases/download/v2.0.0";

const ASSETS: Record<string, string> = {
  win32: "browse.exe",
  darwin: "browse-macos",
  linux: "browse-linux",
};

export function getBinaryPath(): string {
  const name = process.platform === "win32" ? "browse.exe" : "browse";
  return join(RUNTIME_DIR, name);
}

export function isBinaryInstalled(): boolean {
  return existsSync(getBinaryPath());
}

export async function downloadBinary(
  onProgress?: (msg: string) => void,
): Promise<{ path: string } | { error: string }> {
  const asset = ASSETS[process.platform];
  if (!asset) {
    return { error: `Unsupported platform: ${process.platform}` };
  }

  const url = `${RELEASE_BASE}/${asset}`;
  const dest = getBinaryPath();

  mkdirSync(RUNTIME_DIR, { recursive: true });
  onProgress?.(`Downloading browse binary from GitHub Releases...`);

  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok || !res.body) {
      return { error: `Download failed: HTTP ${res.status}` };
    }

    const total = Number(res.headers.get("content-length") || 0);
    let received = 0;
    const fileStream = createWriteStream(dest);

    const reader = res.body.getReader();
    const readable = new Readable({
      async read() {
        const { done, value } = await reader.read();
        if (done) {
          this.push(null);
          return;
        }
        received += value.length;
        if (total && onProgress) {
          const pct = Math.round((received / total) * 100);
          onProgress(`Downloading... ${pct}%`);
        }
        this.push(value);
      },
    });

    await pipeline(readable, fileStream);
    onProgress?.("Download complete.");
    return { path: dest };
  } catch (err: any) {
    return { error: `Download failed: ${err.message}` };
  }
}
