/**
 * Douyin (抖音) video search.
 *
 * Uses Douyin's web search to find videos.
 * Requires Puppeteer for JavaScript rendering.
 * All Douyin videos have watermarks — watermark removal handled by caller.
 */

export interface DouyinVideo {
  id: string;
  title: string;
  coverUrl: string;
  videoUrl: string;
  duration: number; // seconds
  author: string;
  playCount: number;
}

/**
 * Search Douyin for videos using web scraping.
 * Falls back to empty results if Puppeteer is unavailable.
 */
export async function searchDouyinVideos(
  query: string,
  count: number = 3
): Promise<DouyinVideo[]> {
  // Try Puppeteer-based search
  try {
    const puppeteer = require("puppeteer-core");
    const { access } = require("fs/promises");

    // Find Chrome/Edge
    const chromePaths = [
      "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
      "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
      "/usr/bin/google-chrome",
      "/usr/bin/chromium-browser",
    ];

    let chromePath: string | null = null;
    for (const p of chromePaths) {
      try { await access(p); chromePath = p; break; } catch {}
    }
    if (!chromePath) return [];

    const browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
    });

    try {
      const page = await browser.newPage();
      await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
      await page.setViewport({ width: 1920, height: 1080 });

      // Navigate to Douyin search
      await page.goto(`https://www.douyin.com/search/${encodeURIComponent(query)}?type=video`, {
        waitUntil: "networkidle2",
        timeout: 20000,
      });

      // Wait for video cards to load
      await page.waitForSelector('[class*="video-card"], [class*="search-result"]', { timeout: 10000 }).catch(() => {});
      await new Promise(r => setTimeout(r, 3000));

      // Extract video info from search results
      const videos = await page.evaluate((maxCount: number) => {
        const items: any[] = [];
        // Try multiple selectors for Douyin's changing DOM
        const cards = document.querySelectorAll('[class*="video-card"], [class*="search-result-card"], a[href*="/video/"]');

        for (const card of cards) {
          if (items.length >= maxCount) break;

          const link = card.querySelector('a[href*="/video/"]') || card.closest('a[href*="/video/"]');
          const href = link?.getAttribute("href") || "";
          const videoId = href.match(/\/video\/(\d+)/)?.[1];
          if (!videoId) continue;

          const img = card.querySelector("img");
          const title = card.querySelector('[class*="title"], [class*="desc"]')?.textContent?.trim() || "";

          items.push({
            id: videoId,
            title: title.substring(0, 100),
            coverUrl: img?.src || "",
            videoUrl: `https://www.douyin.com/video/${videoId}`,
          });
        }
        return items;
      }, count);

      return videos.map((v: any) => ({
        ...v,
        duration: 15, // Default estimate
        author: "",
        playCount: 0,
      }));
    } finally {
      await browser.close().catch(() => {});
    }
  } catch {
    return [];
  }
}

/**
 * Search Douyin and return results in MaterialResult format.
 */
export async function searchDouyinMaterials(
  query: string,
  count: number = 3
): Promise<Array<{
  externalId: string;
  type: "VIDEO";
  source: "STOCK_FOOTAGE";
  fileUrl: string;
  thumbnailUrl: string;
  width: number;
  height: number;
  duration: number;
  matchScore: number;
  searchQuery: string;
  platform: "douyin";
  needsWatermarkRemoval: true;
}>> {
  const videos = await searchDouyinVideos(query, count);

  return videos.map((video) => ({
    externalId: `douyin-${video.id}`,
    type: "VIDEO" as const,
    source: "STOCK_FOOTAGE" as const,
    fileUrl: video.videoUrl, // Page URL — actual download needs further processing
    thumbnailUrl: video.coverUrl,
    width: 1080, // Douyin is typically vertical 1080x1920
    height: 1920,
    duration: video.duration,
    matchScore: 0.5, // Lower score — watermarked, copyright risk
    searchQuery: query,
    platform: "douyin" as const,
    needsWatermarkRemoval: true as const,
  }));
}
