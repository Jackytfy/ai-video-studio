import puppeteer from "puppeteer-core";
import { execFile } from "child_process";
import { promisify } from "util";
import { writeFile, unlink, access, readFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { randomUUID } from "crypto";

const execFileAsync = promisify(execFile);

const CHROME_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
];

async function findChrome(): Promise<string | null> {
  for (const p of CHROME_PATHS) {
    try {
      await access(p);
      return p;
    } catch { }
  }
  return null;
}

export async function fallbackMaterial(
  query: string,
  outputPath: string,
  config: { width: number; height: number; fps: number }
): Promise<void> {
  const chromePath = await findChrome();
  if (!chromePath) throw new Error("No Chrome/Edge/Chromium found for fallback material search");

  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
      "--disable-dev-shm-usage",
    ],
  });

  let tmpImage: string | null = null;
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    await page.goto(
      `https://www.bing.com/images/search?q=${encodeURIComponent(query)}&form=HDRSC2&first=1`,
      { waitUntil: "networkidle2", timeout: 20000 }
    );

    await page.waitForSelector("img.mimg", { timeout: 15000 }).catch(() => { });
    await new Promise((r) => setTimeout(r, 2000));

    const imageUrl = await page.evaluate(() => {
      const imgs = document.querySelectorAll<HTMLImageElement>("img.mimg");
      for (const img of imgs) {
        const src = img.src || img.getAttribute("data-src") || "";
        if (src.startsWith("http") && !src.includes("bing") && !src.includes("th?id=")) {
          return src;
        }
      }
      return null;
    });

    if (!imageUrl) throw new Error("No image found via Bing search");

    const res = await fetch(imageUrl, { signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`Failed to download image: ${res.status}`);
    const imageBuffer = Buffer.from(await res.arrayBuffer());

    tmpImage = join(tmpdir(), `fallback-${randomUUID()}.jpg`);
    await writeFile(tmpImage, imageBuffer);

    // Watermark removal: crop 2% from each edge to remove potential watermarks
    const croppedImage = join(tmpdir(), `fallback-crop-${randomUUID()}.jpg`);
    try {
      await execFileAsync("ffmpeg", [
        "-y", "-i", tmpImage,
        "-vf", "crop=iw*0.96:ih*0.96:iw*0.02:ih*0.02",
        "-q:v", "2", croppedImage,
      ], { timeout: 10000 });
      // Use cropped image if successful
      await unlink(tmpImage).catch(() => {});
      tmpImage = croppedImage;
    } catch {
      // If crop fails, use original
      await unlink(croppedImage).catch(() => {});
    }

    await execFileAsync("ffmpeg", [
      "-y",
      "-loop", "1",
      "-i", tmpImage,
      "-c:v", "libx264",
      "-t", "5",
      "-pix_fmt", "yuv420p",
      "-vf", [
        `scale=${config.width}:${config.height}:force_original_aspect_ratio=decrease`,
        `pad=${config.width}:${config.height}:(ow-iw)/2:(oh-ih)/2`,
        `zoompan=z='if(eq(on,1),1.0,min(zoom+0.003,1.15))':d=${config.fps * 5}:fps=${config.fps}`,
      ].join(","),
      "-an",
      outputPath,
    ], { timeout: 60000 });
  } finally {
    await browser.close().catch(() => { });
    if (tmpImage) await unlink(tmpImage).catch(() => { });
  }
}
